'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Env dummy pra o require do adaptador não estourar ao instanciar o client Anthropic.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy';
const { normalizarMensagens, extrairTexto, MODELOS } = require('../lib/llm');

test('normalizarMensagens: vazio vira 1 turno user', () => {
    assert.deepEqual(normalizarMensagens([]), [{ role: 'user', content: 'ok' }]);
    assert.deepEqual(normalizarMensagens(null), [{ role: 'user', content: 'ok' }]);
});

test('normalizarMensagens: se começa em assistant, prefixa um user', () => {
    const out = normalizarMensagens([{ role: 'assistant', content: 'oi' }, { role: 'user', content: 'quanto?' }]);
    assert.equal(out[0].role, 'user');
    assert.equal(out[1].role, 'assistant');
    assert.equal(out[2].content, 'quanto?');
});

test('normalizarMensagens: funde consecutivos do mesmo role e tira vazios', () => {
    const out = normalizarMensagens([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: '  ' },   // vazio → descartado
        { role: 'system', content: 'x' },        // role inválido → descartado
        { role: 'assistant', content: 'c' },
    ]);
    assert.deepEqual(out, [
        { role: 'user', content: 'a\nb' },
        { role: 'assistant', content: 'c' },
    ]);
});

test('extrairTexto: concatena blocos text, ignora thinking, trata refusal/vazio', () => {
    assert.equal(extrairTexto({ stop_reason: 'end_turn', content: [{ type: 'text', text: ' oi ' }, { type: 'thinking', thinking: 'x' }] }), 'oi');
    assert.equal(extrairTexto({ stop_reason: 'refusal', content: [] }), '');
    assert.equal(extrairTexto(null), '');
    assert.equal(extrairTexto({ content: 'nao-array' }), '');
});

test('MODELOS: mapa central tem os 3 papéis', () => {
    assert.ok(MODELOS.rapido && MODELOS.cerebro && MODELOS.visao);
});
