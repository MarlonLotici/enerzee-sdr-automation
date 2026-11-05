'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { varrerReengajamentos } = require('../lib/reengajamentoLoop');

const AGORA = Date.parse('2026-11-05T18:00:00Z'); // quinta 15:00 BRT
const MIN = 60e3, H = 3600e3;
const iso = (ms) => new Date(AGORA - ms).toISOString();

// supabase de mentira (só o que o varredor usa), encadeável
function bancoFalso({ leads = [], mensagensPorWa = {}, instancias = [] }) {
    const consultas = [];
    const from = (tabela) => {
        const filtros = {};
        const q = {
            select() { return q; }, eq(c, v) { filtros[c] = v; return q; }, gte() { return q; }, lte() { return q; },
            order() { return q; }, limit() { return q; },
            then(res) {
                consultas.push(tabela);
                if (tabela === 'instances') return res({ data: instancias, error: null });
                if (tabela === 'leads') return res({ data: leads, error: null });
                if (tabela === 'messages') return res({ data: mensagensPorWa[filtros.whatsapp_id] || [], error: null });
                return res({ data: [], error: null });
            },
        };
        return q;
    };
    return { from, consultas };
}
function redisFalso() {
    const m = new Map();
    return { m, exists: async (k) => (m.has(k) ? 1 : 0), set: async (k, v, ex, ttl, nx) => { if (nx === 'NX' && m.has(k)) return null; m.set(k, v); return 'OK'; }, del: async (k) => { m.delete(k); } };
}

const inst = { id: 'i1', name: 'Chip', reengajamento_ativo: true, dry_run: false };
const lead = (id, wa, extra = {}) => ({ id, name: `Lead ${id}`, dono: 'Ana', whatsapp_id: wa, status: 'contact', is_paused: false, manual_pause: false, user_id: 'u1', instance_id: 'i1', ...extra });
const convSilenciosa = (minDesde) => [
    { role: 'assistant', content: 'Oi!', created_at: iso(minDesde * MIN) },
    { role: 'user', content: 'Olá! Posso ter mais informações?', created_at: iso((minDesde + 1) * MIN) },
];

test('envia o lembrete 1x e NÃO repete no ciclo seguinte (marca no Redis)', async () => {
    const supabase = bancoFalso({ leads: [lead('l1', 'a@w')], mensagensPorWa: { 'a@w': convSilenciosa(50) } });
    const redis = redisFalso();
    const enviados = [];
    const enviar = async (x) => enviados.push(x);
    const base = { supabase, redis, enviar, instancias: [inst], agora: AGORA, pausaEntreEnviosMs: 0, log: { log() {}, warn() {} }, nomeDe: (l) => l.dono };

    const r1 = await varrerReengajamentos(base);
    assert.equal(r1.enviados.length, 1);
    assert.equal(enviados[0].tipo, 'lembrete');
    assert.equal(enviados[0].texto, 'Ana, estou aqui pra te ajudar... consegue falar agora e testar como funciono?');

    const r2 = await varrerReengajamentos(base);
    assert.equal(r2.enviados.length, 0);
    assert.equal(enviados.length, 1, 'segunda varredura não pode reenviar');
    assert.equal(r2.ignorados.aguardando, 1);
});

test('duas varreduras ao mesmo tempo: só uma envia', async () => {
    const supabase = bancoFalso({ leads: [lead('l1', 'a@w')], mensagensPorWa: { 'a@w': convSilenciosa(50) } });
    const redis = redisFalso();
    let n = 0;
    const opts = { supabase, redis, enviar: async () => { n++; }, instancias: [inst], agora: AGORA, pausaEntreEnviosMs: 0, log: { log() {}, warn() {} } };
    await Promise.all([varrerReengajamentos(opts), varrerReengajamentos(opts)]);
    assert.equal(n, 1);
});

test('falha no envio libera a marca (tenta de novo no próximo ciclo)', async () => {
    const supabase = bancoFalso({ leads: [lead('l1', 'a@w')], mensagensPorWa: { 'a@w': convSilenciosa(50) } });
    const redis = redisFalso();
    const log = { log() {}, warn() {} };
    const r1 = await varrerReengajamentos({ supabase, redis, enviar: async () => { throw new Error('Meta recusou'); }, instancias: [inst], agora: AGORA, pausaEntreEnviosMs: 0, log });
    assert.equal(r1.enviados.length, 0);
    assert.equal(r1.ignorados.falha_no_envio, 1);
    assert.equal(redis.m.size, 0);
    let ok = 0;
    await varrerReengajamentos({ supabase, redis, enviar: async () => { ok++; }, instancias: [inst], agora: AGORA, pausaEntreEnviosMs: 0, log });
    assert.equal(ok, 1);
});

test('Redis fora do ar: NÃO envia (melhor calar do que duplicar)', async () => {
    const supabase = bancoFalso({ leads: [lead('l1', 'a@w')], mensagensPorWa: { 'a@w': convSilenciosa(50) } });
    const redisQuebrado = { exists: async () => 0, set: async () => { throw new Error('redis fora'); }, del: async () => {} };
    let n = 0;
    await varrerReengajamentos({ supabase, redis: redisQuebrado, enviar: async () => { n++; }, instancias: [inst], agora: AGORA, pausaEntreEnviosMs: 0, log: { log() {}, warn() {} } });
    assert.equal(n, 0);
});

test('simulação e dry_run: decidem e logam, mas não enviam nem reservam', async () => {
    const supabase = bancoFalso({ leads: [lead('l1', 'a@w')], mensagensPorWa: { 'a@w': convSilenciosa(50) } });
    const redis = redisFalso();
    let n = 0;
    const r = await varrerReengajamentos({ supabase, redis, enviar: async () => { n++; }, instancias: [inst], simular: true, agora: AGORA, pausaEntreEnviosMs: 0, log: { log() {}, warn() {} } });
    assert.equal(n, 0);
    assert.equal(r.enviados[0].simulado, true);
    assert.equal(redis.m.size, 0);
    const r2 = await varrerReengajamentos({ supabase, redis, enviar: async () => { n++; }, instancias: [{ ...inst, dry_run: true }], agora: AGORA, pausaEntreEnviosMs: 0, log: { log() {}, warn() {} } });
    assert.equal(n, 0);
    assert.equal(r2.enviados[0].simulado, true);
});

test('teto por ciclo: não manda rajada', async () => {
    const leads = Array.from({ length: 12 }, (_, i) => lead(`l${i}`, `w${i}@w`));
    const mensagensPorWa = Object.fromEntries(leads.map(l => [l.whatsapp_id, convSilenciosa(50)]));
    let n = 0;
    const r = await varrerReengajamentos({ supabase: bancoFalso({ leads, mensagensPorWa }), redis: redisFalso(), enviar: async () => { n++; }, instancias: [inst], agora: AGORA, maxEnvios: 5, pausaEntreEnviosMs: 0, log: { log() {}, warn() {} } });
    assert.equal(n, 5);
    assert.equal(r.ignorados.limite_do_ciclo, 7);
});

test('instância sem a coluna (SQL não rodado): ciclo vazio, sem erro e sem enviar', async () => {
    const supabase = { from: () => { const q = { select: () => q, eq: () => q, then: (res) => res({ data: null, error: { message: 'column instances.reengajamento_ativo does not exist' } }) }; return q; } };
    let n = 0;
    const r = await varrerReengajamentos({ supabase, redis: redisFalso(), enviar: async () => { n++; }, agora: AGORA, log: { log() {}, warn() {} } });
    assert.equal(n, 0);
    assert.match(r.erro, /reengajamento_ativo/);
});

test('despedida ~22h depois, com texto de despedida', async () => {
    const msgs = [
        { role: 'assistant', content: 'Estou aqui pra te ajudar…', created_at: iso(21 * H) },
        { role: 'assistant', content: 'Oi!', created_at: iso(22.1 * H) },
        { role: 'user', content: 'Olá!', created_at: iso(22.2 * H) },
    ];
    const redis = redisFalso();
    // o lembrete já tinha saído naquele silêncio
    redis.m.set(`reengaj:lembrete:l1:${AGORA - 22.2 * H}`, '1');
    const enviados = [];
    await varrerReengajamentos({ supabase: bancoFalso({ leads: [lead('l1', 'a@w')], mensagensPorWa: { 'a@w': msgs } }), redis, enviar: async (x) => enviados.push(x), instancias: [inst], agora: AGORA, pausaEntreEnviosMs: 0, nomeDe: (l) => l.dono, log: { log() {}, warn() {} } });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].tipo, 'despedida');
    assert.match(enviados[0].texto, /^Ana, respeito seu tempo e decisão/);
});
