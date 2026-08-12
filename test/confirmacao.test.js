'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classificarConfirmacao } = require('../lib/confirmacao');

test('confirmado: sim/confirmo/estarei/ok/pode ser', () => {
    assert.equal(classificarConfirmacao('sim, confirmo'), 'confirmado');
    assert.equal(classificarConfirmacao('Confirmado!'), 'confirmado');
    assert.equal(classificarConfirmacao('estarei lá'), 'confirmado');
    assert.equal(classificarConfirmacao('pode ser sim'), 'confirmado');
    assert.equal(classificarConfirmacao('blz, combinado'), 'confirmado');
    assert.equal(classificarConfirmacao('👍'), 'confirmado');
});

test('desmarcado: não posso / cancelar / remarcar (prioridade sobre "sim")', () => {
    assert.equal(classificarConfirmacao('não vou conseguir participar'), 'desmarcado');
    assert.equal(classificarConfirmacao('preciso remarcar'), 'desmarcado');
    assert.equal(classificarConfirmacao('infelizmente surgiu um imprevisto'), 'desmarcado');
    assert.equal(classificarConfirmacao('vamos deixar pra outro dia'), 'desmarcado');
    // "não vou conseguir, mas sim quero remarcar" — negativo ganha
    assert.equal(classificarConfirmacao('não consigo hoje, podemos ver outro horário?'), 'desmarcado');
});

test('indefinido: pergunta/assunto qualquer não vira status', () => {
    assert.equal(classificarConfirmacao('qual o endereço?'), 'indefinido');
    assert.equal(classificarConfirmacao('quanto custa?'), 'indefinido');
    assert.equal(classificarConfirmacao(''), 'indefinido');
    assert.equal(classificarConfirmacao(null), 'indefinido');
});
