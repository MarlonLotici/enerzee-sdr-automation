'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectarConfirmacaoSlot } = require('../lib/agendamento');

const SLOTS = [
    { inicioISO: '2026-08-21T13:00:00Z', fimISO: '2026-08-21T13:30:00Z', label: 'hoje às 10h' },
    { inicioISO: '2026-08-22T18:00:00Z', fimISO: '2026-08-22T18:30:00Z', label: 'amanhã às 15h' },
];

test('ordinal: "o primeiro" → slot 1; "o segundo" → slot 2', () => {
    assert.equal(detectarConfirmacaoSlot('o primeiro', SLOTS).label, 'hoje às 10h');
    assert.equal(detectarConfirmacaoSlot('pode ser o segundo', SLOTS).label, 'amanhã às 15h');
});

test('hora explícita casa com o slot certo', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser 15h', SLOTS).label, 'amanhã às 15h');
    assert.equal(detectarConfirmacaoSlot('as 10 tá bom', SLOTS).label, 'hoje às 10h');
});

test('"amanhã" quando só um slot é de amanhã', () => {
    assert.equal(detectarConfirmacaoSlot('amanhã fica melhor', SLOTS).label, 'amanhã às 15h');
});

test('recusa/ambiguidade → null', () => {
    assert.equal(detectarConfirmacaoSlot('não pode nenhum desses', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('deixa eu ver depois', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('tudo bem?', SLOTS), null);
});

test('sem slots → null', () => {
    assert.equal(detectarConfirmacaoSlot('o primeiro', []), null);
    assert.equal(detectarConfirmacaoSlot('o primeiro', null), null);
});
