'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ehEncerramento, jaSeDespediu, montarDespedida, agradeceu, repeteUltimaDaIA } = require('../lib/posAgendamento');

test('bug 2026-11-05: "Obrigado" e "Tá tudo certo" são encerramento', () => {
    for (const t of ['Obrigado', 'Tá tudo certo', 'ok, valeu!', 'Beleza, até amanhã', 'sem dúvidas', '👍', '🙏🏻', 'Fechado então', 'Tudo certo, obrigada Sofia', 'Obrigadaaa'])
        assert.equal(ehEncerramento(t), true, t);
});

test('dúvida, pedido ou saudação NÃO são encerramento', () => {
    for (const t of ['oi', 'Bom dia', 'e o link?', 'Tudo certo?', 'Qual o valor', 'Vou levar meu sócio', 'Posso remarcar', 'obrigado, mas quanto custa', 'tudo bem', 'sim'])
        assert.equal(ehEncerramento(t), false, t);
});

test('despedida é curta, sem pergunta, com nome e horário', () => {
    const d = montarDespedida({ nome: 'Marlon', quando: 'amanhã às 11h30', agradeceu: true, sortear: a => a[0] });
    assert.equal(d, 'Por nada, Marlon! Até amanhã às 11h30 😊');
    assert.ok(!d.includes('?'));
    assert.equal(montarDespedida({ sortear: a => a[0] }), 'Combinado! Até lá 🙌');
});

test('jaSeDespediu: só quando a última fala da IA foi nossa despedida', () => {
    assert.equal(jaSeDespediu([{ role: 'assistant', content: 'Combinado, Marlon! Até amanhã às 11h30 🙌' }, { role: 'user', content: 'ok' }]), true);
    assert.equal(jaSeDespediu([{ role: 'assistant', content: 'Segue o link: https://meet.google.com/x' }]), false);
    assert.equal(jaSeDespediu([{ role: 'assistant', content: 'Perfeito! Tem alguma dúvida?' }]), false);
});

test('agradeceu', () => {
    assert.equal(agradeceu('Obrigadaaa'), true);
    assert.equal(agradeceu('valeu'), true);
    assert.equal(agradeceu('Tá tudo certo'), false);
});

test('repeteUltimaDaIA pega o eco exato (inclusive com [AUDIO_TTS] no histórico)', () => {
    const msg = 'Oi Marlon! 😊 Tá tudo certo pra nossa conversa amanhã às 11h30. Tem alguma dúvida?';
    const h = [{ role: 'assistant', content: msg }, { role: 'user', content: 'Tá tudo certo' }];
    assert.equal(repeteUltimaDaIA(msg, h), true);
    assert.equal(repeteUltimaDaIA('Combinado! Até amanhã 🙌', h), false);
    const hAudio = [{ role: 'assistant', content: '[AUDIO_TTS] Legal, Gilberto. Os leads chegam pelo WhatsApp?' }];
    assert.equal(repeteUltimaDaIA('Legal, Gilberto. Os leads chegam pelo WhatsApp?', hAudio), true);
    assert.equal(repeteUltimaDaIA('Legal!', hAudio), false);
});
