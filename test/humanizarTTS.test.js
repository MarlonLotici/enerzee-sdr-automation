'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { humanizarParaTTS, expandirParaFala } = require('../lib/humanizarTTS');

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

// Bug 2026-11-13: "30 min" saiu como "30 mienei" no ElevenLabs.
test('caso real: "conversa de 30 min" vira "30 minutos"', () => {
    assert.equal(humanizarParaTTS('Legal, os horários para a sua conversa de 30 min com o especialista.'),
        'Legal, os horários para a sua conversa de 30 minutos com o especialista.');
});
test('duração e horário por extenso', () => {
    assert.equal(expandirParaFala('papo de 15min'), 'papo de 15 minutos');
    assert.equal(expandirParaFala('em 1 min.'), 'em 1 minuto');
    assert.equal(expandirParaFala('responde em 15s'), 'responde em 15 segundos');
    assert.equal(expandirParaFala('amanhã às 14h'), 'amanhã às 14 horas');
    assert.equal(expandirParaFala('às 14h30'), 'às 14 horas e 30');
    assert.equal(expandirParaFala('às 9:30 ou 15:00'), 'às 9 e 30 ou 15 horas');
    assert.equal(expandirParaFala('em 1h'), 'em 1 hora');
    assert.equal(expandirParaFala('atende 24h'), 'atende 24 horas');
    assert.equal(expandirParaFala('atendimento 24/7'), 'atendimento 24 horas por dia, todos os dias');
});
test('dinheiro, porcentagem, data e parcelas', () => {
    assert.equal(expandirParaFala('R$ 597 por mês'), '597 reais por mês');
    assert.equal(expandirParaFala('R$1,00'), '1 real');
    assert.equal(expandirParaFala('R$ 1.500,50'), '1.500 reais e 50 centavos');
    assert.equal(expandirParaFala('de 30 a 40%'), 'de 30 a 40 por cento');
    assert.equal(expandirParaFala('dia 16/11'), 'dia 16 de novembro');
    assert.equal(expandirParaFala('3x de R$750'), '3 vezes de 750 reais');
});
test('abreviações de chat viram palavra (sem estragar palavras que contêm as letras)', () => {
    assert.equal(expandirParaFala('vc tb pode, pq hj é melhor'), 'você também pode, porque hoje é melhor');
    assert.equal(expandirParaFala('Vcs mandam msg?'), 'vocês mandam mensagem?');
    assert.equal(expandirParaFala('o que você quer'), 'o que você quer');
    assert.equal(expandirParaFala('ex: clínicas'), 'por exemplo, clínicas');
    assert.equal(expandirParaFala('fala c/ a dra. Ana'), 'fala com a doutora Ana');
});
test('sigla IA soletrada; verbo "ia" e palavras com "ia" intactos', () => {
    assert.equal(expandirParaFala('uma IA que responde'), 'uma I A que responde');
    assert.equal(expandirParaFala('eu ia te falar da agência'), 'eu ia te falar da agência');
});
test('emoji e link não vão pra voz', () => {
    assert.equal(humanizarParaTTS('Perfeito 🚀 veja https://antix-ia.com agora'), 'Perfeito veja o link agora.');
});
