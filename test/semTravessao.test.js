'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { semTravessao } = require('../lib/semTravessao');

test('travessão cercado de espaço vira vírgula', () => {
    assert.equal(semTravessao('24h por dia — nunca mais perca um lead'), '24h por dia, nunca mais perca um lead');
});

test('en dash (–) também é removido', () => {
    assert.equal(semTravessao('seg às 10h – 11h'), 'seg às 10h, 11h');
});

test('travessão colado (sem espaço) também é removido', () => {
    assert.equal(semTravessao('oi—tudo bem?'), 'oi, tudo bem?');
});

test('múltiplos travessões na mesma frase', () => {
    assert.equal(
        semTravessao('Atendimento 24h — todo dia — sem exceção.'),
        'Atendimento 24h, todo dia, sem exceção.'
    );
});

test('não deixa vírgula dupla nem ", ." feio antes de pontuação', () => {
    assert.equal(semTravessao('Perfeito — até lá!'), 'Perfeito, até lá!');
    assert.equal(semTravessao('Combinado — .'), 'Combinado.');
});

test('texto sem travessão passa intacto', () => {
    assert.equal(semTravessao('Oi, tudo bem?'), 'Oi, tudo bem?');
});

test('entrada vazia/nula não quebra', () => {
    assert.equal(semTravessao(''), '');
    assert.equal(semTravessao(null), null);
    assert.equal(semTravessao(undefined), undefined);
});
