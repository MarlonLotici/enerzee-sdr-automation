'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { emailPareceConfiavel, _normalizarCelularReceita } = require('../3_enrich');

test('emailPareceConfiavel: aceita domínio que casa com o nome do negócio', () => {
    assert.equal(emailPareceConfiavel('contato@taveski.com', 'Taveski Distribuidora', null), true);
});

test('emailPareceConfiavel: rejeita domínio de terceiro / que não casa', () => {
    assert.equal(emailPareceConfiavel('contato@grubbio.com', 'Padaria São José', null), false);
    assert.equal(emailPareceConfiavel('joaosilva123@gmail.com', 'Padaria São José', null), false);
});

test('_normalizarCelularReceita: normaliza celular BR válido para 55+DDD+9dígitos', () => {
    assert.equal(_normalizarCelularReceita('48991234567'), '5548991234567'); // 11 díg → prefixa 55
    assert.equal(_normalizarCelularReceita('5548991234567'), '5548991234567'); // já com 55
});

test('_normalizarCelularReceita: rejeita fixo/curto/nulo', () => {
    assert.equal(_normalizarCelularReceita('4833334444'), null); // 10 díg (fixo, sem 9)
    assert.equal(_normalizarCelularReceita('123'), null);
    assert.equal(_normalizarCelularReceita(''), null);
    assert.equal(_normalizarCelularReceita(null), null);
});
