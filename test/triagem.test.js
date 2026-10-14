'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decidirAcao, _coagir } = require('../lib/triagem');

// decidirAcao é PURO (não chama LLM). Garante que a triagem vira o modo certo.
test('dúvida/pergunta aberta SEMPRE vira tira-dúvida (nunca agenda por cima)', () => {
    assert.equal(decidirAcao({ intencao_agora: 'duvida', momento: 'solucao' }), 'tira_duvida');
    // pergunta aberta mesmo classificada como "avanço" → ainda tira-dúvida
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', pergunta_aberta: true, momento: 'convite' }), 'tira_duvida');
});

test('objeção vira tratar_objecao', () => {
    assert.equal(decidirAcao({ intencao_agora: 'objecao', momento: 'validacao_valor' }), 'tratar_objecao');
});

test('pedido explícito de horário vira agendar', () => {
    assert.equal(decidirAcao({ intencao_agora: 'pedido_agendar', momento: 'convite' }), 'agendar');
});

test('sinal de avanço só propõe reunião DEPOIS de ver valor/solução', () => {
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', momento: 'solucao' }), 'propor_reuniao');
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', concordou_com_valor: true, momento: 'dor' }), 'propor_reuniao');
    // avanço cedo (ainda na descoberta, sem valor) NÃO agenda — segue qualificando
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', momento: 'descoberta', concordou_com_valor: false }), 'qualificar');
});

test('resposta de qualificação segue qualificando (não agenda)', () => {
    assert.equal(decidirAcao({ intencao_agora: 'responde_qualificacao', momento: 'dor' }), 'qualificar');
    assert.equal(decidirAcao({ intencao_agora: 'smalltalk', momento: 'rapport' }), 'qualificar');
});

test('_coagir sana lixo e respeita "?" como pergunta aberta', () => {
    const c = _coagir({ momento: 'xpto', intencao_agora: 'zzz', dor_tipo: 'nope', tem_numeros: { ticket: '120' }, concordou_com_valor: 'sim' }, 'quanto custa?');
    assert.equal(c.momento, 'descoberta');            // valor inválido → fallback
    assert.equal(c.intencao_agora, 'duvida');         // fallback por "?"
    assert.equal(c.dor_tipo, 'desconhecido');
    assert.equal(c.tem_numeros.ticket, 120);          // string "120" → número
    assert.equal(c.concordou_com_valor, false);       // só true booleano conta
    assert.equal(c.pergunta_aberta, true);            // termina em "?"
});

// 🌡️ Instinto sênior: lead ESFRIANDO não leva empurrão de reunião (recua pra re-aquecer).
test('temperatura esfriando/frio NÃO propõe reunião mesmo com sinal de avanço (recua)', () => {
    // "ta" seco pós-pitch: LLM às vezes lê como avanço — a temperatura segura o empurrão.
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', momento: 'solucao', concordou_com_valor: true, temperatura: 'esfriando' }), 'qualificar');
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', momento: 'convite', temperatura: 'frio' }), 'qualificar');
    // lead QUENTE com avanço → agenda normal (não trava à toa)
    assert.equal(decidirAcao({ intencao_agora: 'sinal_de_avanco', momento: 'solucao', concordou_com_valor: true, temperatura: 'quente' }), 'propor_reuniao');
    // pedido EXPLÍCITO vence a temperatura (quer marcar = marca)
    assert.equal(decidirAcao({ intencao_agora: 'pedido_agendar', momento: 'convite', temperatura: 'esfriando' }), 'agendar');
});
