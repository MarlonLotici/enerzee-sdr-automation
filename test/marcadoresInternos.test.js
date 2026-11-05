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
