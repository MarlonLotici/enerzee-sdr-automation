'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cortarPerguntasEmpilhadas, ehCumprimento } = require('../lib/umaPergunta');

test('bug 2026-11-02: cumprimento + apresentação + pergunta NÃO vira só "Oi, tudo bem?"', () => {
    const t = 'Oi, tudo bem? 😊 Eu sou a Sofia da Antix, a gente cria agentes de IA pro comercial. Como posso te chamar?';
    const r = cortarPerguntasEmpilhadas(t);
    assert.equal(r.cortado, false);
    assert.equal(r.texto, t);
});

test('cumprimento com nome também não conta como pergunta', () => {
    const t = 'Oi Vini, tudo bem? Me conta, quantas mensagens vocês recebem por dia?';
    assert.equal(cortarPerguntasEmpilhadas(t).cortado, false);
});

test('continua cortando perguntas de verdade empilhadas', () => {
    const r = cortarPerguntasEmpilhadas('Vocês recebem leads pelo Instagram? Quem responde hoje? Perdem oportunidade?');
    assert.equal(r.cortado, true);
    assert.equal(r.texto, 'Vocês recebem leads pelo Instagram?');
});

test('cumprimento + 2 perguntas reais: mantém o cumprimento e a 1ª real', () => {
    const r = cortarPerguntasEmpilhadas('Oi, tudo bem? Vocês têm site? E quem cuida do WhatsApp?');
    assert.equal(r.cortado, true);
    assert.equal(r.texto, 'Oi, tudo bem? Vocês têm site?');
});

test('com link de agendamento não corta (é o CTA)', () => {
    const t = 'Fechado? Aqui o link: https://meet.google.com/abc Te vejo lá?';
    assert.equal(cortarPerguntasEmpilhadas(t).cortado, false);
});

test('ehCumprimento: só frases curtas de cumprimento', () => {
    assert.equal(ehCumprimento('Oi, tudo bem'), true);
    assert.equal(ehCumprimento(' Boa tarde! Como vai'), true);
    assert.equal(ehCumprimento('Como vai'), true);
    assert.equal(ehCumprimento('Como vai o atendimento de vocês hoje'), false);
    assert.equal(ehCumprimento('Tudo certo com a agenda de amanhã'), false);
});
