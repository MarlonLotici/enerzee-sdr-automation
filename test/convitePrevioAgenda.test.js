'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../lib/agendaDecisao');

const CONVITE = 'Legal, pra te ajudar eu consigo agendar pra você um papo de 30 minutos com nosso especialista, pode ser?';

test('o convite em 2 passos é reconhecido como convite (o "pode ser" seguinte vira aceite)', () => {
    assert.equal(d.convidouReuniaoAntes([{ role: 'assistant', content: CONVITE }]), true);
    assert.equal(d.aceitouConviteDeReuniao([{ role: 'assistant', content: CONVITE }], 'pode ser'), true);
    assert.equal(d.aceitouConviteDeReuniao([{ role: 'assistant', content: CONVITE }], 'Sim'), true);
});
test('"não" ao convite não é aceite', () => {
    assert.equal(d.aceitouConviteDeReuniao([{ role: 'assistant', content: CONVITE }], 'agora não'), false);
});
test('"Agendar mais, e mais rápido" é resposta de qualificação, NÃO pedido de horário (passa pelo convite)', () => {
    assert.equal(d.pediuHorarioDireto('Agendar mais, e mais rápido'), false);
});
test('pedido direto de horário pula o convite', () => {
    for (const t of ['me manda os horários', 'tem horário amanhã?', 'quero marcar uma conversa', 'pode ser às 10h?', 'que dia vocês têm?']) {
        assert.equal(d.pediuHorarioDireto(t), true, t);
    }
});
