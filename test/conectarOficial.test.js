'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { limparCredenciais, montarBaseUrl, validarEInscrever, testarConexao } = require('../lib/conectarOficial');

const TOKEN = 'EAA' + 'x'.repeat(120);
const OK = { phoneNumberId: '1400458459825400', wabaId: '2148464835774402', token: TOKEN };

// fetch falso: cada rota "METODO caminho-sem-query" → { status, body }. Guarda as chamadas.
function fetchFalso(rotas) {
    const chamadas = [];
    const impl = async (url, opts = {}) => {
        const caminho = new URL(url).pathname.replace(/^\/v\d+\.\d+\//, '');
        const chave = `${opts.method || 'GET'} ${caminho}`;
        chamadas.push({ chave, opts });
        const r = rotas[chave] || { status: 404, body: { error: { code: 100, message: 'rota não simulada' } } };
        return { ok: r.status < 400, status: r.status, json: async () => r.body };
    };
    return { impl, chamadas };
}
const rotasOk = {
    [`GET ${OK.phoneNumberId}`]: { status: 200, body: { display_phone_number: '+55 48 8824-5113', verified_name: 'Enerzee', quality_rating: 'GREEN' } },
    [`GET ${OK.wabaId}/phone_numbers`]: { status: 200, body: { data: [{ id: OK.phoneNumberId }] } },
    [`POST ${OK.wabaId}/subscribed_apps`]: { status: 200, body: { success: true } },
};

test('limparCredenciais: tira espaços/traços dos IDs e aceita PIN vazio', () => {
    const r = limparCredenciais({ phoneNumberId: ' 1400 4584-5982 5400 ', wabaId: '2148464835774402', token: `  ${TOKEN}  `, pin: '' });
    assert.equal(r.ok, true);
    assert.equal(r.dados.phoneNumberId, '1400458459825400');
    assert.equal(r.dados.token, TOKEN);
    assert.equal(r.dados.pin, '');
});
test('limparCredenciais: recusa erros comuns com mensagem clara', () => {
    assert.match(limparCredenciais({ ...OK, phoneNumberId: '+55 48 8824-5113' }).erro, /não o telefone/);
    assert.match(limparCredenciais({ ...OK, wabaId: OK.phoneNumberId }).erro, /mesmo nos dois/);
    assert.match(limparCredenciais({ ...OK, token: 'curto' }).erro, /Token inválido/);
    assert.match(limparCredenciais({ ...OK, token: TOKEN.slice(0, 60) + ' ' + TOKEN.slice(60) }).erro, /sem espaços/);
    assert.match(limparCredenciais({ ...OK, pin: '123' }).erro, /6 dígitos/);
});
test('montarBaseUrl: inclui o phone_number_id no fim (o webhook roteia por ele)', () => {
    assert.equal(montarBaseUrl('1400458459825400'), 'https://graph.facebook.com/v25.0/1400458459825400');
});

test('validarEInscrever: caminho feliz confere número, WABA e inscreve o app', async () => {
    const f = fetchFalso(rotasOk);
    const r = await validarEInscrever(OK, { fetchImpl: f.impl });
    assert.deepEqual(r, { ok: true, numero: '+55 48 8824-5113', nome: 'Enerzee', qualidade: 'GREEN', registrado: false });
    assert.deepEqual(f.chamadas.map(c => c.chave), [`GET ${OK.phoneNumberId}`, `GET ${OK.wabaId}/phone_numbers`, `POST ${OK.wabaId}/subscribed_apps`]);
    assert.equal(f.chamadas[0].opts.headers.Authorization, `Bearer ${TOKEN}`);
});
test('validarEInscrever: com PIN registra o número antes de inscrever', async () => {
    const f = fetchFalso({ ...rotasOk, [`POST ${OK.phoneNumberId}/register`]: { status: 200, body: { success: true } } });
    const r = await validarEInscrever({ ...OK, pin: '123456' }, { fetchImpl: f.impl });
    assert.equal(r.registrado, true);
    const reg = f.chamadas.find(c => c.chave === `POST ${OK.phoneNumberId}/register`);
    assert.deepEqual(JSON.parse(reg.opts.body), { messaging_product: 'whatsapp', pin: '123456' });
});
test('validarEInscrever: token expirado para na 1ª etapa e não inscreve nada', async () => {
    const f = fetchFalso({ ...rotasOk, [`GET ${OK.phoneNumberId}`]: { status: 401, body: { error: { code: 190, message: 'expired' } } } });
    const r = await validarEInscrever(OK, { fetchImpl: f.impl });
    assert.equal(r.ok, false);
    assert.equal(r.etapa, 'numero');
    assert.match(r.erro, /PERMANENTE/);
    assert.equal(f.chamadas.length, 1);
});
test('validarEInscrever: número de outra WABA é recusado antes de inscrever', async () => {
    const f = fetchFalso({ ...rotasOk, [`GET ${OK.wabaId}/phone_numbers`]: { status: 200, body: { data: [{ id: '999999999999999' }] } } });
    const r = await validarEInscrever(OK, { fetchImpl: f.impl });
    assert.equal(r.etapa, 'waba');
    assert.match(r.erro, /não pertence/);
    assert.ok(!f.chamadas.some(c => c.chave.endsWith('subscribed_apps')));
});
test('validarEInscrever: sem permissão na WABA vira mensagem de atribuir ao usuário do sistema', async () => {
    const f = fetchFalso({ ...rotasOk, [`GET ${OK.wabaId}/phone_numbers`]: { status: 403, body: { error: { code: 200, message: 'perm' } } } });
    const r = await validarEInscrever(OK, { fetchImpl: f.impl });
    assert.match(r.erro, /usuário do sistema/);
});
test('validarEInscrever: falha na inscrição do webhook é reportada como tal', async () => {
    const f = fetchFalso({ ...rotasOk, [`POST ${OK.wabaId}/subscribed_apps`]: { status: 400, body: { error: { code: 1, message: 'x' } } } });
    const r = await validarEInscrever(OK, { fetchImpl: f.impl });
    assert.equal(r.etapa, 'webhook');
    assert.match(r.erro, /inscrição do webhook/);
});

test('testarConexao: número ok e app inscrito', async () => {
    const f = fetchFalso({ ...rotasOk, [`GET ${OK.wabaId}/subscribed_apps`]: { status: 200, body: { data: [{ whatsapp_business_api_data: { name: 'Antix' } }] } } });
    const r = await testarConexao(OK, { fetchImpl: f.impl });
    assert.equal(r.ok, true);
    assert.equal(r.inscrito, true);
    assert.equal(r.nome, 'Enerzee');
});
test('testarConexao: nenhum app inscrito avisa que as mensagens não chegam', async () => {
    const f = fetchFalso({ ...rotasOk, [`GET ${OK.wabaId}/subscribed_apps`]: { status: 200, body: { data: [] } } });
    const r = await testarConexao(OK, { fetchImpl: f.impl });
    assert.equal(r.ok, false);
    assert.match(r.erro, /não vão chegar/);
});
