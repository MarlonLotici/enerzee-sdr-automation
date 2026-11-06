'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { humanizarParaTTS } = require('../lib/humanizarTTS');

test('mantém o ponto no fim da frase (caso do áudio "sem custo de salário. Como vocês…")', () => {
    assert.equal(humanizarParaTTS('Cada agente age como um colaborador dedicado, mas sem custo de salário. Como vocês hoje geram e tratam os leads?'),
        'Cada agente age como um colaborador dedicado, mas sem custo de salário. Como vocês hoje geram e tratam os leads?');
});
test('sempre termina com pontuação final', () => {
    assert.equal(humanizarParaTTS('Entendi, vamos ajustar'), 'Entendi, vamos ajustar.');
    assert.equal(humanizarParaTTS('Perfeito,'), 'Perfeito.');
    assert.equal(humanizarParaTTS('Tudo bem?'), 'Tudo bem?');
});
test('reticências viram um ponto só e espaços são normalizados', () => {
    assert.equal(humanizarParaTTS('Olha...  consegue falar agora ?'), 'Olha. consegue falar agora?');
});
test('vazio não quebra', () => { assert.equal(humanizarParaTTS(''), ''); assert.equal(humanizarParaTTS(null), ''); });
