'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../lib/recuperarSenha');

test('valida e-mail (inclusive os com a letra "s", que a regex antiga do login rejeitava)', () => {
    assert.equal(r.normalizarEmail(' Contato@Sistemas.COM '), 'contato@sistemas.com');
    assert.equal(r.normalizarEmail('atx@antix-colony.com'), 'atx@antix-colony.com');
    assert.equal(r.normalizarEmail('marlonlotici2@gmail.com'), 'marlonlotici2@gmail.com');
    assert.equal(r.normalizarEmail('sem-arroba'), null);
    assert.equal(r.normalizarEmail('a@b'), null);
    assert.equal(r.normalizarEmail(''), null);
    assert.equal(r.normalizarEmail(null), null);
});

test('link de recuperação aponta pro painel com o token codificado', () => {
    assert.equal(r.montarLinkRecuperacao('https://antix.up.railway.app/', 'abc123'), 'https://antix.up.railway.app/?recuperar=abc123');
    assert.equal(r.montarLinkRecuperacao('https://x.com', 'a b&c'), 'https://x.com/?recuperar=a%20b%26c');
});

test('e-mail traz o link no botão e em texto puro', () => {
    const { assunto, html, texto } = r.montarEmailRecuperacao({ link: 'https://x.com/?recuperar=t' });
    assert.match(assunto, /Redefinir/);
    assert.ok(html.includes('href="https://x.com/?recuperar=t"'));
    assert.ok(texto.includes('https://x.com/?recuperar=t'));
});

test('fluxo feliz: gera o link com a service key e envia pelo Resend', async () => {
    const enviados = [];
    const supabase = { auth: { admin: { generateLink: async (p) => { assert.equal(p.type, 'recovery'); return { data: { properties: { hashed_token: 'TOK' } }, error: null }; } } } };
    const res = await r.solicitarRecuperacao({ email: 'Marlon@Antix.com', baseUrl: 'https://p.app', supabase, enviarEmail: async (m) => { enviados.push(m); } });
    assert.deepEqual(res, { ok: true, enviado: true });
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].to, 'marlon@antix.com');
    assert.ok(enviados[0].html.includes('https://p.app/?recuperar=TOK'));
});

test('e-mail sem conta: mesma resposta ok, nada é enviado (não revela quem tem conta)', async () => {
    const enviados = [];
    const supabase = { auth: { admin: { generateLink: async () => ({ data: null, error: { message: 'User not found' } }) } } };
    const res = await r.solicitarRecuperacao({ email: 'ninguem@x.com', baseUrl: 'https://p.app', supabase, enviarEmail: async (m) => enviados.push(m) });
    assert.equal(res.ok, true);
    assert.equal(res.enviado, false);
    assert.equal(enviados.length, 0);
});

test('falha no envio nunca lança e continua respondendo ok', async () => {
    const supabase = { auth: { admin: { generateLink: async () => ({ data: { properties: { hashed_token: 'T' } }, error: null }) } } };
    const res = await r.solicitarRecuperacao({ email: 'a@b.com', baseUrl: 'https://p', supabase, enviarEmail: async () => { throw new Error('resend fora'); }, log: { error() {} } });
    assert.deepEqual(res, { ok: true, enviado: false, motivo: 'falha_envio' });
});

test('e-mail inválido: ok genérico, sem chamar o Supabase', async () => {
    let chamou = false;
    const supabase = { auth: { admin: { generateLink: async () => { chamou = true; return {}; } } } };
    const res = await r.solicitarRecuperacao({ email: 'nao-e-email', baseUrl: 'https://p', supabase, enviarEmail: async () => {} });
    assert.equal(res.ok, true);
    assert.equal(chamou, false);
});
