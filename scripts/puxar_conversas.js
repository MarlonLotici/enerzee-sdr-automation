'use strict';
/**
 * scripts/puxar_conversas.js — Puxa conversas REAIS do Supabase (prod) pra análise.
 *
 * Agrupa mensagens por lead (whatsapp_id + user_id), reconstrói em ordem cronológica,
 * exclui os testes (simtest_), e imprime/salva as N conversas mais recentes com pelo
 * menos uma resposta da IA. Mascara o telefone por segurança.
 *
 * Uso:
 *   node scripts/puxar_conversas.js            # 15 conversas mais recentes
 *   node scripts/puxar_conversas.js 30         # 30
 *   CONV_USER=<user_id> node scripts/puxar_conversas.js 20   # só de um tenant
 *   CONV_MIN=6 node scripts/puxar_conversas.js # só conversas com >=6 mensagens
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const N = parseInt(process.argv[2], 10) || 15;
const MIN_MSGS = parseInt(process.env.CONV_MIN, 10) || 4;
const SO_USER = process.env.CONV_USER || null;
const JANELA = parseInt(process.env.CONV_DIAS, 10) || 30; // últimos X dias

function mascara(zap) {
    const s = String(zap || '');
    if (s.startsWith('simtest') || s.includes('ANTIX') || s.length < 8) return s.slice(0, 14);
    // mantém DDI/DDD e últimos 2, mascara miolo
    return s.replace(/(\d{4})\d+(\d{2})/, '$1****$2');
}

(async function main() {
    if (!process.env.SUPABASE_URL) { console.error('❌ Falta SUPABASE_URL no .env'); process.exit(1); }
    console.log(`🔎 Puxando mensagens dos últimos ${JANELA} dias${SO_USER ? ` (user ${SO_USER.slice(0, 8)})` : ''}...`);

    const desde = new Date(Date.now() - JANELA * 864e5).toISOString();
    // pagina pra não estourar o limite de linha do Supabase
    let todas = [];
    for (let pg = 0; pg < 20; pg++) {
        let q = supabase.from('messages')
            .select('whatsapp_id, user_id, role, content, created_at, channel')
            .gte('created_at', desde)
            .order('created_at', { ascending: true })
            .range(pg * 1000, pg * 1000 + 999);
        if (SO_USER) q = q.eq('user_id', SO_USER);
        const { data, error } = await q;
        if (error) { console.error('Erro Supabase:', error.message); break; }
        if (!data || !data.length) break;
        todas = todas.concat(data);
        if (data.length < 1000) break;
    }
    console.log(`   ${todas.length} mensagens.`);

    // agrupa por conversa (whatsapp_id + user_id)
    const convs = new Map();
    for (const m of todas) {
        if (String(m.whatsapp_id || '').includes('simtest')) continue; // tira testes (web_simtest_* e simtest_*)
        const k = `${m.user_id}|${m.whatsapp_id}`;
        if (!convs.has(k)) convs.set(k, { user_id: m.user_id, zap: m.whatsapp_id, msgs: [], channel: m.channel || 'whatsapp' });
        convs.get(k).msgs.push(m);
    }

    // filtra: >=MIN_MSGS e com pelo menos 1 resposta da IA; ordena por recência
    let lista = [...convs.values()]
        .filter(c => c.msgs.length >= MIN_MSGS && c.msgs.some(m => m.role === 'assistant'))
        .sort((a, b) => new Date(b.msgs[b.msgs.length - 1].created_at) - new Date(a.msgs[a.msgs.length - 1].created_at))
        .slice(0, N);

    const linhas = [];
    linhas.push(`# ${lista.length} conversas reais (de ${convs.size} no período, últimos ${JANELA} dias)\n`);
    for (const c of lista) {
        const ini = new Date(c.msgs[0].created_at).toLocaleString('pt-BR');
        linhas.push(`\n===== ${mascara(c.zap)} | canal:${c.channel} | tenant:${String(c.user_id).slice(0, 8)} | ${c.msgs.length} msgs | início ${ini} =====`);
        for (const m of c.msgs) {
            const quem = m.role === 'assistant' ? 'IA' : m.role === 'user' ? 'LEAD' : m.role.toUpperCase();
            linhas.push(`${quem}: ${String(m.content || '').replace(/\s+/g, ' ').trim()}`);
        }
    }
    const out = linhas.join('\n');
    console.log(out);

    const outDir = path.join(process.cwd(), 'scripts', 'sim_out');
    fs.mkdirSync(outDir, { recursive: true });
    const f = path.join(outDir, `conversas_reais_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    fs.writeFileSync(f, out);
    console.log(`\n📄 Salvo: ${f}`);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
