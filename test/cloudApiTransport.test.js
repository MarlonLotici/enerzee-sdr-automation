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

test('enviarTemplate: monta type=template com nome e idioma (abertura fora da janela 24h)', async () => {
    const calls = mockFetch();
    await transport.enviarTemplate(CFG, '5511999998888@s.whatsapp.net', 'confirmacao_reuniao', 'pt_BR');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.type, 'template');
    assert.equal(body.to, '5511999998888');
    assert.equal(body.template.name, 'confirmacao_reuniao');
    assert.equal(body.template.language.code, 'pt_BR');
    assert.ok(!('components' in body.template), 'sem componentes quando não passados');
});

test('enviarTemplate: inclui components quando fornecidos', async () => {
    const calls = mockFetch();
    const comps = [{ type: 'body', parameters: [{ type: 'text', text: 'Carlos' }] }];
    await transport.enviarTemplate(CFG, '5511999998888', 'lembrete', 'pt_BR', comps);
    const body = JSON.parse(calls[0].opts.body);
    assert.deepEqual(body.template.components, comps);
});

// Mock com fila de respostas (upload → mensagem → ...), na ordem das chamadas.
function mockFetchSeq(respostas) {
    const calls = [];
    global.fetch = async (url, opts) => {
        const r = respostas[calls.length] || respostas[respostas.length - 1];
        calls.push({ url, opts });
        return { ok: r.ok, status: r.ok ? 200 : 400, statusText: r.ok ? 'OK' : 'Bad Request', json: async () => r.body };
    };
    return calls;
}

test('enviarAudio: sobe o .ogg em /media e manda type=audio com voice:true', async () => {
    const calls = mockFetchSeq([
        { ok: true, body: { id: 'MEDIA_123' } },
        { ok: true, body: { messages: [{ id: 'wamid.AUD' }] } },
    ]);
    const out = await transport.enviarAudio(CFG, '5511999998888@s.whatsapp.net', Buffer.from('OggS-fake'), 'audio/ogg');

    assert.equal(calls.length, 2);
    // 1) upload multipart no /media do phone_number_id, com Bearer e SEM Content-Type manual
    assert.equal(calls[0].url, 'https://graph.facebook.com/v20.0/123456789012345/media');
    assert.equal(calls[0].opts.headers['Authorization'], 'Bearer META_TOKEN_XYZ');
    assert.ok(!('Content-Type' in calls[0].opts.headers), 'boundary do multipart fica com o fetch');
    const form = calls[0].opts.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('messaging_product'), 'whatsapp');
    assert.equal(form.get('type'), 'audio/ogg');
    assert.equal(form.get('file').type, 'audio/ogg');
    assert.equal(form.get('file').size, Buffer.from('OggS-fake').length);
    // 2) mensagem de voz apontando pro media id
    assert.equal(calls[1].url, 'https://graph.facebook.com/v20.0/123456789012345/messages');
    const body = JSON.parse(calls[1].opts.body);
    assert.equal(body.type, 'audio');
    assert.equal(body.to, '5511999998888');
    assert.deepEqual(body.audio, { id: 'MEDIA_123', voice: true });
    assert.equal(out.id, 'wamid.AUD');
});

test('enviarAudio: Meta recusa voice → reenvia como áudio comum (sem voice)', async () => {
    const calls = mockFetchSeq([
        { ok: true, body: { id: 'MEDIA_9' } },
        { ok: false, body: { error: { message: '(#100) Invalid parameter', code: 100 } } },
        { ok: true, body: { messages: [{ id: 'wamid.FALLBACK' }] } },
    ]);
    const out = await transport.enviarAudio(CFG, '5511999998888', Buffer.from('x'));
    assert.equal(calls.length, 3);
    assert.deepEqual(JSON.parse(calls[2].opts.body).audio, { id: 'MEDIA_9' });
    assert.equal(out.id, 'wamid.FALLBACK');
});

test('enviarAudio: erro que não é de parâmetro (ex.: janela 24h) NÃO reenvia — propaga', async () => {
    const calls = mockFetchSeq([
        { ok: true, body: { id: 'MEDIA_1' } },
        { ok: false, body: { error: { message: '(#131047) Re-engagement message', code: 131047 } } },
    ]);
    await assert.rejects(() => transport.enviarAudio(CFG, '5511999998888', Buffer.from('x')), /131047/);
    assert.equal(calls.length, 2);
});

test('enviarAudio: upload falhou → erro claro e nenhuma mensagem é enviada', async () => {
    const calls = mockFetchSeq([{ ok: false, body: { error: { message: 'Unsupported file type' } } }]);
    await assert.rejects(() => transport.enviarAudio(CFG, '5511999998888', Buffer.from('x')), /upload.*Unsupported file type/);
    assert.equal(calls.length, 1);
});

test('enviarAudio: sem access token → erro antes de tocar a rede', async () => {
    const calls = mockFetchSeq([{ ok: true, body: {} }]);
    const tokenEnv = [process.env.WA_TOKEN, process.env.CLOUD_API_KEY];
    delete process.env.WA_TOKEN; delete process.env.CLOUD_API_KEY;
    try {
        await assert.rejects(() => transport.enviarAudio({ baseUrl: CFG.baseUrl }, '5511999998888', Buffer.from('x')), /access token/i);
        assert.equal(calls.length, 0);
    } finally {
        if (tokenEnv[0] !== undefined) process.env.WA_TOKEN = tokenEnv[0];
        if (tokenEnv[1] !== undefined) process.env.CLOUD_API_KEY = tokenEnv[1];
    }
});

test('listarTemplates: só APROVADOS, com texto do corpo, nº de variáveis e botões', async () => {
    const calls = mockFetchSeq([{ ok: true, body: { data: [
        { name: 'volta_cliente', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', components: [
            { type: 'BODY', text: 'Oi {{1}}, seu {{2}} te espera!' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Quero' }, { type: 'QUICK_REPLY', text: 'Parar' }] },
        ] },
        { name: 'rascunho', language: 'pt_BR', status: 'PENDING', components: [] },
    ] } }]);
    const t = await transport.listarTemplates(CFG, '998877');
    assert.equal(calls[0].url, 'https://graph.facebook.com/v20.0/998877/message_templates?status=APPROVED&limit=200&fields=name,language,status,category,components');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer META_TOKEN_XYZ');
    assert.deepEqual(t, [{ nome: 'volta_cliente', idioma: 'pt_BR', categoria: 'MARKETING', texto: 'Oi {{1}}, seu {{2}} te espera!', qtdVariaveis: 2, botoes: ['Quero', 'Parar'] }]);
});

test('listarTemplates: sem waba_id → erro claro', async () => {
    mockFetchSeq([{ ok: true, body: {} }]);
    await assert.rejects(() => transport.listarTemplates(CFG, ''), /waba_id/);
});

test('normalizarInbound: resposta de BOTÃO usa o título do botão como texto', () => {
    const body = { entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: 'Cliente' } }],
        messages: [{ from: '5511988887777', id: 'wamid.B', type: 'button', button: { text: 'Confirmar' } }],
    } }] }] };
    const norm = transport.normalizarInbound(body);
    assert.equal(norm.texto, 'Confirmar');
    assert.equal(norm.remoteJid, '5511988887777@s.whatsapp.net');
});

test('normalizarInbound: resposta INTERATIVA (botão da lista) vira texto', () => {
    const body = { entry: [{ changes: [{ value: {
        messages: [{ from: '5511988887777', id: 'wamid.I', type: 'interactive',
            interactive: { button_reply: { id: 'b1', title: 'Manhã' } } }],
    } }] }] };
    assert.equal(transport.normalizarInbound(body).texto, 'Manhã');
});

test('normalizarInbound: tipo não-texto (ex.: image) passa o tipo adiante', () => {
    const body = { entry: [{ changes: [{ value: {
        messages: [{ from: '5511988887777', id: 'wamid.IMG', type: 'image', image: { id: 'media123' } }],
    } }] }] };
    const norm = transport.normalizarInbound(body);
    assert.equal(norm.tipo, 'image');    // só 'text' vira 'conversation'; resto passa igual
    assert.equal(norm.texto, '');
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
