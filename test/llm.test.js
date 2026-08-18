'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Env dummy pra o require do adaptador não estourar ao instanciar o client Together.
process.env.TOGETHER_API_KEY = process.env.TOGETHER_API_KEY || 'together-dummy';
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

test('extrairTexto: lê choices[0].message.content (formato OpenAI), sempre string, nunca lança', () => {
    assert.equal(extrairTexto({ choices: [{ message: { content: ' oi ' } }] }), 'oi');
    assert.equal(extrairTexto({ choices: [] }), '');            // sem choices → ''
    assert.equal(extrairTexto({ choices: [{ message: {} }] }), ''); // message sem content → ''
    assert.equal(extrairTexto(null), '');
    assert.equal(extrairTexto({}), '');
});

test('MODELOS: mapa central tem os 3 papéis', () => {
    assert.ok(MODELOS.rapido && MODELOS.cerebro && MODELOS.visao);
});
