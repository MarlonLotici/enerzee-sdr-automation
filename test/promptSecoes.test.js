'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { secoesFixas, ROTEIRO_PADRAO, ANTI_INVENCAO_PADRAO } = require('../lib/promptSecoes');

test('padrão (Sofia/demais): textos intactos, com o roteiro SPIN e a regra de prospecção', () => {
    const { roteiro, antiInvencao } = secoesFixas({});
    assert.equal(roteiro, ROTEIRO_PADRAO);
    assert.equal(antiInvencao, ANTI_INVENCAO_PADRAO);
    assert.match(roteiro, /SPIN — DESCOBRIR A NECESSIDADE REAL/);
    assert.match(roteiro, /legal que vocês já usam o Instagram/);
    assert.match(antiInvencao, /NUNCA ofereça prospecção ativa/);
    assert.match(antiInvencao, /time na call/);
    // snapshot de tamanho: se alguém mexer no texto padrão sem querer, o teste avisa
    assert.equal(roteiro.length, 2245);
    assert.equal(antiInvencao.length, 892);
});

test('chip autônomo: sem SPIN, sem exemplos da Antix e sem a frase de prospecção; mantém as travas de segurança', () => {
    const { roteiro, antiInvencao } = secoesFixas({ chipAutonomo: true });
    assert.doesNotMatch(roteiro, /SPIN|Instagram|ESPINHA DORSAL|Não avance sem entender/);
    assert.match(roteiro, /Siga as etapas e as regras do SEU prompt/);
    assert.match(roteiro, /JOGO DE CINTURA/); // bloco neutro (dúvida, confirmar, remarcar, desmarcar) continua
    assert.doesNotMatch(antiInvencao, /prospecção|disparo em massa|time na call/);
    assert.match(antiInvencao, /NUNCA INVENTE/);
    assert.match(antiInvencao, /LINK de reunião: NUNCA invente/);
    assert.match(antiInvencao, /NUNCA use travessão/);
    assert.match(antiInvencao, /consultor confirma/);
});

test('sem argumento: padrão', () => {
    assert.equal(secoesFixas().roteiro, ROTEIRO_PADRAO);
});
