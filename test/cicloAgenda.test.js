'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prometeHorarios, cicloLiberaHorarios } = require('../lib/agendaDecisao');

// Conversa real de 2026-11-13 (Haislann): a IA pulou pro horário logo depois do objetivo do lead.
const historicoReal = [
    { role: 'user', content: 'Tem muita coisa , mas me fale o q vcs entregam pra eu saber onde pode me ajudar' },
    { role: 'assistant', content: 'Entregamos agentes de IA que podem: receber e qualificar leads que chegam por formulário ou anúncio.' },
    { role: 'assistant', content: '[AUDIO_TTS] Qual desses pontos parece que traria mais impacto pra sua operação agora?' },
];

test('caso real: a fala "já solicito ao sistema os horários" é promessa de horário', () => {
    assert.equal(prometeHorarios('Legal, então já solicito ao sistema os horários disponíveis para a sua conversa de 30 min com o especialista. Vou puxar as opções agora.'), true);
    assert.equal(prometeHorarios('Deixa eu ver os horários aqui pra você'), true);
    assert.equal(prometeHorarios('Vou puxar a agenda e já te mando'), true);
});

test('pitch e exploração NÃO são promessa de horário', () => {
    assert.equal(prometeHorarios('A IA atende fora do horário comercial e já marca na sua agenda.'), false);
    assert.equal(prometeHorarios('E hoje, como vocês fazem pra qualificar esses contatos?'), false);
    assert.equal(prometeHorarios('Faz sentido agendar uma conversa de 30 minutos com o especialista?'), false);
});

test('caso real: "Geração e qualificação" NÃO libera horário (ciclo ainda não aconteceu)', () => {
    assert.equal(cicloLiberaHorarios({ texto: 'Geração e qualificação', historico: historicoReal }), false);
});

test('interesse ou animação sozinhos não liberam horário', () => {
    assert.equal(cicloLiberaHorarios({ texto: 'Gostei, interessante', historico: historicoReal }), false);
    assert.equal(cicloLiberaHorarios({ texto: 'sim', historico: historicoReal }), false); // "sim" sem convite antes
});

test('libera depois do convite aceito, a pedido do lead ou com agenda em curso', () => {
    const comConvite = [...historicoReal, { role: 'assistant', content: 'Faz sentido agendar uma conversa de 30 minutos com o especialista?' }];
    assert.equal(cicloLiberaHorarios({ texto: 'faz sentido sim', historico: comConvite }), true);
    assert.equal(cicloLiberaHorarios({ texto: 'quero marcar uma conversa', historico: historicoReal }), true);
    assert.equal(cicloLiberaHorarios({ texto: 'tem horário amanhã?', historico: historicoReal }), true);
    assert.equal(cicloLiberaHorarios({ texto: 'ok', historico: historicoReal, temSlots: true }), true);
    assert.equal(cicloLiberaHorarios({ texto: 'ok', historico: historicoReal, jaAgendado: true }), true);
});
