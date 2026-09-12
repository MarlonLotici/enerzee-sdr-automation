'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularSlotsLivres, rotularSlotBRT } = require('../lib/agendaSlots');

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
