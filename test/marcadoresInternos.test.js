'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { removerMarcadoresInternos } = require('../lib/marcadoresInternos');

test('bug 2026-11-05: [AUDIO_TTS] copiado do histórico não vai pro cliente', () => {
    assert.equal(
        removerMarcadoresInternos('[AUDIO_TTS] E como vocês fazem a qualificação e o agendamento desses leads hoje?'),
        'E como vocês fazem a qualificação e o agendamento desses leads hoje?');
});
test('variações do marcador e "(Áudio)" no início', () => {
    assert.equal(removerMarcadoresInternos('[audio tts] Oi!'), 'Oi!');
    assert.equal(removerMarcadoresInternos('[ÁUDIO-TTS]: Oi!'), 'Oi!');
    assert.equal(removerMarcadoresInternos('(Áudio) Oi!'), 'Oi!');
});
test('[ATENDENTE_HUMANO] (marcador da fala do gestor no histórico) também não vaza', () => {
    assert.equal(removerMarcadoresInternos('[ATENDENTE_HUMANO]: Oi Andreia, Marlon aqui!'), 'Oi Andreia, Marlon aqui!');
    assert.equal(removerMarcadoresInternos('[atendente humano] Oi!'), 'Oi!');
});
test('texto normal e nulo ficam intactos', () => {
    assert.equal(removerMarcadoresInternos('Oi, tudo bem?'), 'Oi, tudo bem?');
    assert.equal(removerMarcadoresInternos('Mandei um áudio pra você'), 'Mandei um áudio pra você');
    assert.equal(removerMarcadoresInternos(null), '');
});

// [AGENDAR] (2026-11-24): a regex desta tag já quebrou uma vez num patch (virou classe de caracteres e apagaria letras da mensagem).
const { temTagAgendar, tirarTagAgendar, regexTagsInternas: _rti } = require('../lib/marcadoresInternos');
test('temTagAgendar: só a tag exata, nunca texto comum', () => {
    assert.equal(temTagAgendar('Perfeito! Vou ver os horários do consultor. [AGENDAR]'), true);
    assert.equal(temTagAgendar('vou ver os horários [ agendar ]'), true);
    assert.equal(temTagAgendar('Sim, pode agendar a conversa'), false);
    assert.equal(temTagAgendar('Show, vamos marcar sim'), false);
    assert.equal(temTagAgendar(''), false);
});
test('tirarTagAgendar: remove só a tag e não mexe no resto do texto', () => {
    assert.equal(tirarTagAgendar('Perfeito! Vou ver os horários do consultor. [AGENDAR]'), 'Perfeito! Vou ver os horários do consultor.');
    assert.equal(tirarTagAgendar('Sem tag nenhuma, sasa'), 'Sem tag nenhuma, sasa');
});
test('regexTagsInternas também some com [AGENDAR] (nunca vaza pro cliente)', () => {
    assert.equal('Vou ver os horários [AGENDAR]'.replace(_rti(), '').trim(), 'Vou ver os horários');
});
