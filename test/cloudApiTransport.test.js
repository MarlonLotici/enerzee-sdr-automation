'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const transport = require('../transports/cloudApiTransport');

const CFG = {
    apiKey: 'META_TOKEN_XYZ',
    baseUrl: 'https://graph.facebook.com/v20.0/123456789012345',
};

// Captura a última chamada de fetch pra inspecionar URL/headers/body sem rede.
function mockFetch(respOk = true, respBody = { messages: [{ id: 'wamid.ABC' }] }) {
    const calls = [];
    global.fetch = async (url, opts) => {
        calls.push({ url, opts });
        return {
            ok: respOk,
            status: respOk ? 200 : 400,
            statusText: respOk ? 'OK' : 'Bad Request',
            json: async () => respBody,
        };
    };
    return calls;
}

test('enviarTexto: monta POST /messages na graph API da Meta com Bearer', async () => {
    const calls = mockFetch();
    const out = await transport.enviarTexto(CFG, '5511999998888@s.whatsapp.net', 'olá');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://graph.facebook.com/v20.0/123456789012345/messages');
    assert.equal(calls[0].opts.headers['Authorization'], 'Bearer META_TOKEN_XYZ');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');

    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.type, 'text');
    assert.equal(body.to, '5511999998888');          // só dígitos, sem @s.whatsapp.net
    assert.equal(body.text.body, 'olá');
    assert.equal(out.id, 'wamid.ABC');
});

test('enviarTexto: erro da Meta vira Error com a mensagem da API', async () => {
    mockFetch(false, { error: { message: 'Invalid OAuth access token', code: 190 } });
    await assert.rejects(
        () => transport.enviarTexto(CFG, '5511999998888', 'oi'),
        /Invalid OAuth access token/,
    );
});

test('enviarTexto: sem access token → erro claro (não tenta a rede)', async () => {
    mockFetch();
    await assert.rejects(
        () => transport.enviarTexto({ baseUrl: CFG.baseUrl }, '5511999998888', 'oi'),
        /access token/i,
    );
});

test('normalizarInbound: webhook de mensagem de texto vira objeto padrão do motor', () => {
    const body = {
        entry: [{
            changes: [{
                value: {
                    contacts: [{ profile: { name: 'Fulano' }, wa_id: '5511999998888' }],
                    messages: [{ from: '5511999998888', id: 'wamid.IN1', type: 'text', text: { body: 'quero saber o preço' } }],
                },
            }],
        }],
    };
    const norm = transport.normalizarInbound(body);
    assert.equal(norm.remoteJid, '5511999998888@s.whatsapp.net');
    assert.equal(norm.fromMe, false);
    assert.equal(norm.msgId, 'wamid.IN1');
    assert.equal(norm.pushName, 'Fulano');
    assert.equal(norm.tipo, 'conversation');          // 'text' da Meta → 'conversation' (Baileys)
    assert.equal(norm.texto, 'quero saber o preço');
});

test('normalizarInbound: evento de status (sent/delivered) → null (não é mensagem)', () => {
    const statusBody = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] };
    assert.equal(transport.normalizarInbound(statusBody), null);
    assert.equal(transport.normalizarInbound({}), null);
    assert.equal(transport.normalizarInbound(null), null);
});
