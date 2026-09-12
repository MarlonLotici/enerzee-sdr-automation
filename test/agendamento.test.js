'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectarConfirmacaoSlot, extrairHorarioPedido } = require('../lib/agendamento');

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

// Dois slots na MESMA hora (9h e 9h30): o parser tem que diferenciar pelos minutos.
const SLOTS_MESMA_HORA = [
    { inicioISO: '2026-08-24T12:00:00Z', fimISO: '2026-08-24T12:30:00Z', label: 'seg às 9h' },
    { inicioISO: '2026-08-24T12:30:00Z', fimISO: '2026-08-24T13:00:00Z', label: 'seg às 9h30' },
];

test('minutos: "9:30" cai no slot 9h30 (não no 9h)', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser 9:30', SLOTS_MESMA_HORA).label, 'seg às 9h30');
    assert.equal(detectarConfirmacaoSlot('9h30 tá ótimo', SLOTS_MESMA_HORA).label, 'seg às 9h30');
});

test('minutos: "9h" (minuto 0) casa exatamente o slot 9h, não o 9h30', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser 9h', SLOTS_MESMA_HORA).label, 'seg às 9h');
});

test('extrairHorarioPedido: pega o horário pedido mesmo fora dos ofertados', () => {
    assert.deepEqual(extrairHorarioPedido('quero as 14 horas'), { h: 14, m: 0 });
    assert.deepEqual(extrairHorarioPedido('pode ser 9:30'), { h: 9, m: 30 });
    assert.deepEqual(extrairHorarioPedido('as 11'), { h: 11, m: 0 });
    assert.equal(extrairHorarioPedido('bom dia'), null);
});
