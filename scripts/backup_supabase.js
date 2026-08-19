'use strict';
/**
 * BACKUP LÓGICO DO SUPABASE (plano Free, sem PITR) — export em JS, sem binário externo.
 *
 * Por quê JS e não pg_dump: o pg_dump exige o client do Postgres instalado na imagem
 * (o Railway/nixpacks não traz por padrão). Este script usa só o @supabase/supabase-js
 * (já é dependência) → roda em qualquer lugar que rode Node. Ele exporta as LINHAS das
 * tabelas críticas (o que dói perder: leads, conversas, configs) num JSON gzipado e sobe
 * pra um bucket PRIVADO do Supabase Storage, com retenção por idade.
 *
 * ⚠️ Limitações honestas:
 *  - É snapshot de DADOS (não de schema/índices/policies). Pra fidelidade total (schema+dados)
 *    rode o pg_dump manualmente — ver docs/BACKUP.md.
 *  - O bucket vive no MESMO projeto Supabase. Se o projeto inteiro morrer, perde os dois.
 *    Pra DR de verdade, aponte pra um storage externo (S3/B2) ou baixe os dumps periodicamente
 *    (ver docs/BACKUP.md). Pro dia a dia (erro de DELETE/drop de tabela), este backup já salva.
 *
 * Uso:  node scripts/backup_supabase.js
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY),
 *       BACKUP_BUCKET (default 'backups'), BACKUP_RETENTION_DAYS (default 14),
 *       BACKUP_TABLES (CSV opcional pra sobrescrever a lista padrão).
 */

const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const BUCKET = process.env.BACKUP_BUCKET || 'backups';
const RETENCAO_DIAS = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 14;

// Tabelas críticas (dados de negócio). whatsapp_sessions/keys ficam de fora: são credenciais
// Baileys efêmeras que se auto-recuperam (re-QR) — não vale o peso no backup.
const TABELAS_PADRAO = [
    'profiles', 'instances', 'tenant_prompts', 'leads', 'messages', 'conversations',
    'client_briefings', 'calls', 'calendar_connections', 'blacklist',
    'email_suppression', 'niche_intelligence',
];
const TABELAS = (process.env.BACKUP_TABLES
    ? process.env.BACKUP_TABLES.split(',').map(s => s.trim()).filter(Boolean)
    : TABELAS_PADRAO);

const PAGINA = 1000; // limite padrão do supabase-js por select

function _carimbo(d = new Date()) {
    return d.toISOString().replace(/[:T]/g, '-').replace(/\..+/, ''); // 2026-08-18-03-00-00
}

async function _exportarTabela(supabase, tabela) {
    const linhas = [];
    let de = 0;
    // Paginação por range: puxa em blocos de PAGINA até acabar.
    for (;;) {
        const { data, error } = await supabase.from(tabela).select('*').range(de, de + PAGINA - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        linhas.push(...data);
        if (data.length < PAGINA) break;
        de += PAGINA;
    }
    return linhas;
}

async function _aplicarRetencao(supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
    if (error) { console.warn(`[BACKUP] Não consegui listar p/ retenção: ${error.message}`); return; }
    const limite = Date.now() - RETENCAO_DIAS * 24 * 3600 * 1000;
    const velhos = (data || [])
        .filter(o => o.name.endsWith('.json.gz'))
        .filter(o => {
            const t = o.created_at ? new Date(o.created_at).getTime() : NaN;
            return Number.isFinite(t) && t < limite;
        })
        .map(o => o.name);
    if (velhos.length) {
        const { error: delErr } = await supabase.storage.from(BUCKET).remove(velhos);
        if (delErr) console.warn(`[BACKUP] Falha ao remover antigos: ${delErr.message}`);
        else console.log(`🧹 [BACKUP] Retenção: removidos ${velhos.length} backup(s) > ${RETENCAO_DIAS} dias.`);
    }
}

async function main() {
    if (!SUPABASE_URL || !SERVICE_KEY) {
        console.error('❌ [BACKUP] Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY).');
        process.exit(1);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Garante o bucket privado (idempotente).
    const { error: bErr } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (bErr && !/already exists/i.test(bErr.message)) {
        console.warn(`[BACKUP] createBucket avisou: ${bErr.message}`);
    }

    const dump = { geradoEm: new Date().toISOString(), tabelas: {} };
    const resumo = [];
    for (const t of TABELAS) {
        try {
            const linhas = await _exportarTabela(supabase, t);
            dump.tabelas[t] = linhas;
            resumo.push(`${t}=${linhas.length}`);
        } catch (e) {
            // Tabela ausente/erro não aborta o backup das demais — registra e segue.
            console.warn(`[BACKUP] Pulei '${t}': ${e.message}`);
            dump.tabelas[t] = { _erro: e.message };
        }
    }

    const comprimido = await gzip(Buffer.from(JSON.stringify(dump)));
    const nome = `backup-${_carimbo()}.json.gz`;
    const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(nome, comprimido, { contentType: 'application/gzip', upsert: false });
    if (upErr) {
        console.error(`❌ [BACKUP] Falha no upload de ${nome}: ${upErr.message}`);
        process.exit(1);
    }

    const kb = (comprimido.length / 1024).toFixed(1);
    console.log(`✅ [BACKUP] ${BUCKET}/${nome} (${kb} KB) — ${resumo.join(', ')}`);

    await _aplicarRetencao(supabase);
}

main().catch((e) => {
    console.error('❌ [BACKUP] Erro fatal:', e.message);
    process.exit(1);
});
