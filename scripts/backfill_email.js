'use strict';
/**
 * scripts/backfill_email.js — Backfill de email (Camada 1) para leads já enriquecidos
 * (cnpj salvo) mas sem email — reconsulta a Receita Federal (BrasilAPI) direto pelo
 * CNPJ já conhecido, sem repetir a busca cara no Serper. Só grava a coluna `email`,
 * nunca telefone/whatsapp_id/status (ver plano em ~/.claude/plans/jiggly-toasting-lovelace.md
 * sobre o risco de duplicar linha se reusar saveLead/upsert por whatsapp_id).
 *
 * Idempotente: filtra por `email IS NULL`, então pode ser interrompido e rodado de
 * novo sem duplicar trabalho.
 *
 * Uso:
 *   node scripts/backfill_email.js                     // todas as contas
 *   node scripts/backfill_email.js --user-id=<uuid>     // só uma conta
 *   node scripts/backfill_email.js --limit=5            // teste com poucos leads
 *   node scripts/backfill_email.js --dry-run            // só loga, não grava
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { consultarDadosOficiais, buscarEmailViaSerper } = require('../3_enrich');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH_SIZE = 100;
const DELAY_MS = 1200; // cortesia com a BrasilAPI (gratuita) — sem custo de Serper aqui

const args = process.argv.slice(2);
const getArg = (nome) => {
    const achado = args.find((a) => a.startsWith(`--${nome}=`));
    return achado ? achado.split('=')[1] : null;
};
const userIdFiltro = getArg('user-id');
const limiteTotal = getArg('limit') ? parseInt(getArg('limit'), 10) : null;
const dryRun = args.includes('--dry-run');
// --serper: quando a Receita não tem email, roda a cascata Serper+site (custo de crédito Serper,
// ~lento). Sem a flag, só Receita (grátis/rápido). getBusinessProfile roda pelo endpoint, não aqui.
const usarSerper = args.includes('--serper');

// Paginação por cursor no `id` (UUID) — ordem lexicográfica é uma ordem total válida,
// então `gt(cursor)` sempre avança, mesmo em dry-run (onde `email` nunca deixa de ser null).
async function buscarProximoLote(cursorId) {
    let query = supabase
        .from('leads')
        .select('id, name, cnpj, user_id, bairro, estado, website')
        .is('email', null)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);
    // Sem Serper, só faz sentido reprocessar quem já tem CNPJ (fonte = Receita). Com Serper,
    // a busca não depende de CNPJ, então processa todos os sem-email.
    if (!usarSerper) query = query.not('cnpj', 'is', null);
    if (cursorId) query = query.gt('id', cursorId);
    if (userIdFiltro) query = query.eq('user_id', userIdFiltro);
    const { data, error } = await query;
    if (error) throw new Error(`Erro ao buscar leads: ${error.message}`);
    return data || [];
}

async function main() {
    console.log(`🚀 Backfill de email — ${usarSerper ? 'Receita + cascata Serper/site' : 'só Receita (rápido)'}`);
    console.log(`   Conta: ${userIdFiltro || 'TODAS'} | Limite: ${limiteTotal || 'sem limite'} | Dry-run: ${dryRun}\n`);

    let cursorId = null;
    let processados = 0;
    let encontrados = 0;
    let semEmail = 0;
    let comErro = 0;

    while (!limiteTotal || processados < limiteTotal) {
        const lote = await buscarProximoLote(cursorId);
        if (lote.length === 0) break;

        for (const lead of lote) {
            if (limiteTotal && processados >= limiteTotal) break;
            processados++;
            cursorId = lead.id;

            try {
                let email = null;
                let fonte = null;

                // 1) Receita (grátis) — só se tiver CNPJ válido salvo.
                const cnpjLimpo = String(lead.cnpj || '').replace(/\D/g, '');
                if (cnpjLimpo.length === 14) {
                    const dados = await consultarDadosOficiais(cnpjLimpo);
                    const emailBruto = (dados?.email || '').trim().toLowerCase();
                    if (emailBruto && REGEX_EMAIL.test(emailBruto)) { email = emailBruto; fonte = 'receita'; }
                }

                // 2) Cascata Serper+site (só com --serper e se a Receita não deu).
                if (!email && usarSerper) {
                    const achado = await buscarEmailViaSerper(lead);
                    if (achado?.email) { email = achado.email; fonte = achado.source; }
                }

                if (email) {
                    encontrados++;
                    console.log(`  📧 [${processados}] ${lead.name}: ${email} [${fonte}]${dryRun ? ' (dry-run)' : ''}`);
                    if (!dryRun) {
                        const { error: errUpdate } = await supabase
                            .from('leads')
                            .update({ email })
                            .eq('id', lead.id);
                        if (errUpdate) throw new Error(errUpdate.message);
                    }
                } else {
                    semEmail++;
                    console.log(`  ➖ [${processados}] ${lead.name}: sem email confiável.`);
                }
            } catch (err) {
                comErro++;
                console.error(`  ❌ [${processados}] ${lead.name}: erro — ${err.message}`);
            }

            await new Promise((r) => setTimeout(r, DELAY_MS + Math.random() * 400));
        }
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Concluído: ${processados} processados | ${encontrados} emails encontrados | ${semEmail} sem email | ${comErro} erros`);
    process.exit(0);
}

main().catch((err) => {
    console.error('💥 Erro fatal no backfill:', err.message);
    process.exit(1);
});
