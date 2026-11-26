'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Troca o LLM e o notifier por stubs: o que importa é o PROMPT que o Concierge monta.
const llmPath = require.resolve('../lib/llm.js');
let capturado = '';
let resposta = 'ok';
require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: {
    chamarLLM: async ({ system }) => { capturado = system; return resposta; },
    MODELOS: { conversa: 'x', rapido: 'x', cerebro: 'x', visao: 'x' },
} };
const notPath = require.resolve('../notifier.js');
require.cache[notPath] = { id: notPath, filename: notPath, loaded: true, exports: { alertaDegradacaoIA: async () => {} } };
const { gerarRespostaConcierge } = require(path.join('..', 'agents', 'conciergeAgent.js'));

const hist = [{ role: 'user', content: 'Oie' }];
const lead = { name: 'Teste' };

test('reunião futura: confirma o horário', async () => {
    resposta = 'ok';
    await gerarRespostaConcierge(hist, lead, 'PROMPT', { quando: 'amanhã às 9h', agora: 'quarta-feira 14:00' });
    assert.match(capturado, /está marcada para: amanhã às 9h/);
    assert.match(capturado, /CONFIRME com segurança: tá tudo certo pra amanhã às 9h/);
    assert.match(capturado, /Agora é quarta-feira 14:00/);
});

// Caso real 2026-11-26: às 14h a Carla perguntou "tá tudo certo pra nossa conversa de hoje às 9h?".
test('reunião que já passou: não confirma como futura, pergunta se aconteceu', async () => {
    resposta = 'ok';
    await gerarRespostaConcierge(hist, lead, 'PROMPT', { quando: 'hoje às 9h', jaPassou: true, agora: 'quinta-feira 14:00' });
    assert.match(capturado, /JÁ PASSOU/);
    assert.match(capturado, /NÃO trate a reunião como futura/);
    assert.doesNotMatch(capturado, /tá tudo certo pra hoje às 9h/);
});

test('fallback de reunião passada não fala do horário como futuro', async () => {
    resposta = '';
    const r = await gerarRespostaConcierge(hist, lead, 'PROMPT', { quando: 'hoje às 9h', jaPassou: true });
    assert.match(r, /Conseguiu conversar/);
    assert.doesNotMatch(r, /tá tudo certo/i);
});
