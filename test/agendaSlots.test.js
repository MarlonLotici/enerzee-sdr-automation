'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularSlotsLivres, rotularSlotBRT, extrairDiaPedido } = require('../lib/agendaSlots');

// Helper: ISO de um horário BRT (UTC-3). ex.: brtISO(2026,7,20,10) = 2026-08-20T13:00:00Z
function brtISO(ano, mesHumano, dia, hora, min = 0) {
    return new Date(Date.UTC(ano, mesHumano - 1, dia, hora + 3, min, 0)).toISOString();
}

test('calcularSlotsLivres: propõe 2 horários ESPAÇADOS (manhã + tarde), respeitando antecedência', () => {
    // Sexta 2026-08-21 08:00 BRT como "agora". rng=0 → pega o 1º da manhã e o 1º da tarde.
    const agora = brtISO(2026, 8, 21, 8);
    const slots = calcularSlotsLivres({
        agora, ocupados: [], diasAdiante: 3, rng: () => 0,
        horaInicio: 9, horaFim: 18, duracaoMin: 60, maxSlots: 2, antecedenciaMin: 120,
    });
    assert.equal(slots.length, 2);
    // 08:00 + 120min = 10:00 → manhã começa em 10h; tarde (>=13h) começa em 13h. Espaçado, não 10h/11h.
    assert.equal(rotularSlotBRT(slots[0].inicioISO, agora), 'hoje às 10h');
    assert.equal(rotularSlotBRT(slots[1].inicioISO, agora), 'hoje às 13h');
});

test('calcularSlotsLivres: variação ("ginga") — rng diferente muda os horários ofertados', () => {
    const agora = brtISO(2026, 8, 21, 8);
    const slots = calcularSlotsLivres({
        agora, ocupados: [], diasAdiante: 3, rng: () => 0.99, // pega o último de cada período
        horaInicio: 9, horaFim: 18, duracaoMin: 60, maxSlots: 2, antecedenciaMin: 120,
    });
    // manhã: 10h,11h → último = 11h; tarde: 13..17h → último = 17h
    assert.equal(rotularSlotBRT(slots[0].inicioISO, agora), 'hoje às 11h');
    assert.equal(rotularSlotBRT(slots[1].inicioISO, agora), 'hoje às 17h');
});

test('calcularSlotsLivres: pula intervalos ocupados', () => {
    const agora = brtISO(2026, 8, 21, 8);
    const ocupados = [
        { inicio: brtISO(2026, 8, 21, 10), fim: brtISO(2026, 8, 21, 11) }, // 10-11 ocupado
    ];
    const slots = calcularSlotsLivres({
        agora, ocupados, diasAdiante: 1, rng: () => 0,
        horaInicio: 9, horaFim: 18, duracaoMin: 60, maxSlots: 2, antecedenciaMin: 120,
    });
    // 10h está ocupado → manhã livre começa em 11h; tarde em 13h.
    assert.equal(rotularSlotBRT(slots[0].inicioISO, agora), 'hoje às 11h');
    assert.equal(rotularSlotBRT(slots[1].inicioISO, agora), 'hoje às 13h');
});

test('calcularSlotsLivres: pula fim de semana por padrão', () => {
    // Sexta 2026-08-21 17:30 BRT — resto do dia acaba, próximo é segunda 2026-08-24
    const agora = brtISO(2026, 8, 21, 17, 30);
    const slots = calcularSlotsLivres({
        agora, ocupados: [], diasAdiante: 5,
        horaInicio: 9, horaFim: 18, duracaoMin: 60, maxSlots: 1, antecedenciaMin: 60,
    });
    assert.equal(slots.length, 1);
    // Sáb/Dom pulados → segunda às 9h
    assert.equal(rotularSlotBRT(slots[0].inicioISO, agora), 'seg às 9h');
});

test('rotularSlotBRT: hoje/amanhã/dia-da-semana + minutos', () => {
    const agora = brtISO(2026, 8, 21, 8);
    assert.equal(rotularSlotBRT(brtISO(2026, 8, 21, 14), agora), 'hoje às 14h');
    assert.equal(rotularSlotBRT(brtISO(2026, 8, 22, 10, 30), agora), 'amanhã às 10h30');
    assert.equal(rotularSlotBRT(brtISO(2026, 8, 24, 15), agora), 'seg às 15h');
});

test('calcularSlotsLivres: dia lotado → retorna vazio (não força slot inválido)', () => {
    const agora = brtISO(2026, 8, 21, 8);
    const ocupados = [{ inicio: brtISO(2026, 8, 21, 9), fim: brtISO(2026, 8, 21, 18) }];
    const slots = calcularSlotsLivres({
        agora, ocupados, diasAdiante: 0, // só hoje
        horaInicio: 9, horaFim: 18, duracaoMin: 60, maxSlots: 2, antecedenciaMin: 30,
    });
    assert.equal(slots.length, 0);
});

// ── extrairDiaPedido + diaAlvo (respeitar o dia que o lead pede) ─────────────────
// Âncora: sábado 10/out/2026, 12:00 BRT (= 2026-10-10T15:00:00Z).
const SAB_10 = new Date('2026-10-10T15:00:00Z').getTime();

test('extrairDiaPedido: dia da semana nomeado → próxima ocorrência futura', () => {
    assert.deepEqual(extrairDiaPedido('pode ser na quinta?', SAB_10), { ano: 2026, mes: 9, dia: 15, label: 'quinta' });
    assert.deepEqual(extrairDiaPedido('quero terça', SAB_10),        { ano: 2026, mes: 9, dia: 13, label: 'terça' });
    assert.deepEqual(extrairDiaPedido('segunda-feira', SAB_10),      { ano: 2026, mes: 9, dia: 12, label: 'segunda' });
});

test('extrairDiaPedido: relativos (hoje/amanhã/depois de amanhã)', () => {
    assert.equal(extrairDiaPedido('hoje às 14h', SAB_10).dia, 10);
    assert.equal(extrairDiaPedido('amanhã', SAB_10).dia, 11);
    assert.equal(extrairDiaPedido('depois de amanhã', SAB_10).dia, 12);
});

test('extrairDiaPedido: sem dia → null', () => {
    assert.equal(extrairDiaPedido('as 14 pode ser?', SAB_10), null);
    assert.equal(extrairDiaPedido('Hoje eles chegam por indicação', SAB_10).dia, 10); // "hoje" presente (ok)
    assert.equal(extrairDiaPedido('quanto custa?', SAB_10), null);
});

test('calcularSlotsLivres com diaAlvo: só gera slots do dia pedido', () => {
    const quinta = extrairDiaPedido('quinta', SAB_10);
    const slots = calcularSlotsLivres({ agora: SAB_10, ocupados: [], diaAlvo: quinta, maxSlots: 2 });
    assert.ok(slots.length > 0, 'deveria ter slots na quinta');
    assert.ok(slots.every((s) => /qui/.test(s.label)), 'todos os slots devem ser de quinta');
});

test('calcularSlotsLivres com diaAlvo em fim de semana → vazio (nesse dia não tenho)', () => {
    const domingo = extrairDiaPedido('amanhã', SAB_10); // amanhã de sábado = domingo (FDS)
    const slots = calcularSlotsLivres({ agora: SAB_10, ocupados: [], diaAlvo: domingo, maxSlots: 2 });
    assert.equal(slots.length, 0);
});
