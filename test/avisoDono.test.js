'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../lib/avisoDono');

test('normaliza o número do aviso (pedido: 46999201690)', () => {
    assert.equal(a.normalizarNumeroAviso('46999201690'), '5546999201690');
    assert.equal(a.normalizarNumeroAviso('+55 (46) 99920-1690'), '5546999201690');
    assert.equal(a.normalizarNumeroAviso('5546999201690'), '5546999201690');
    assert.equal(a.normalizarNumeroAviso(''), null);
    assert.equal(a.normalizarNumeroAviso('123'), null);
});

test('reconhece o próprio dono com ou sem o 9º dígito (não avisa sobre os testes dele)', () => {
    assert.equal(a.ehNumeroDoDono('554699201690@s.whatsapp.net', '5546999201690'), true);
    assert.equal(a.ehNumeroDoDono('5546999201690@s.whatsapp.net', '46999201690'), true);
    assert.equal(a.ehNumeroDoDono('554891952094@s.whatsapp.net', '5546999201690'), false);
    assert.equal(a.ehNumeroDoDono(null, '5546999201690'), false);
});

test('janela de 24h', () => {
    const agora = Date.parse('2026-11-05T20:00:00Z');
    assert.equal(a.dentroDaJanela24h('2026-11-05T10:00:00Z', agora), true);
    assert.equal(a.dentroDaJanela24h('2026-11-04T19:00:00Z', agora), false);
    assert.equal(a.dentroDaJanela24h(null, agora), false);
});

test('aviso de lead novo: texto legível + 2 parâmetros de template sem quebra de linha', () => {
    const av = a.montarAvisoNovoLead({ nome: 'Andreia freitas', jid: '554891952094@s.whatsapp.net', origem: 'anúncio "Antix"', primeiraMsg: 'Olá!\nPosso ter mais informações sobre isso?' });
    assert.match(av.texto, /Lead novo: Andreia freitas/);
    assert.match(av.texto, /\+554891952094/);
    assert.match(av.texto, /anúncio "Antix"/);
    assert.equal(av.params.length, 2);
    for (const p of av.params) assert.ok(!/\n|\t| {4,}/.test(p), p);
});

test('aviso de reunião', () => {
    const av = a.montarAvisoReuniao({ nome: 'Gilberto', jid: '554699201690@s.whatsapp.net', quando: 'amanhã às 11h30' });
    assert.match(av.texto, /Reunião agendada: Gilberto/);
    assert.match(av.params[1], /amanhã às 11h30/);
});
