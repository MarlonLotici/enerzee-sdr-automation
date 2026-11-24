'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// supervisorAgent importa lib/llm (cliente com chave no import): troca por um substituto, aqui só se testa a função pura.
const llmPath = require.resolve('../lib/llm.js');
require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: { chamarLLM: async () => '', MODELOS: { rapido: 'x', cerebro: 'x', conversa: 'x', visao: 'x' } } };
const { filtrarProblemas } = require('../agents/supervisorAgent');

const TODOS = ['contexto_incoerente', 'nao_explora_necessidade', 'pulou_etapa', 'agendou_cedo', 'pulou_acolhida', 'nao_pediu_nome',
    'empilhou_perguntas', 'textao', 'inventou', 'agendamento_fake', 'inconsistente', 'robotico'];

test('fora do chip autônomo (Sofia): lista intacta', () => {
    assert.deepEqual(filtrarProblemas(TODOS, {}), TODOS);
    assert.deepEqual(filtrarProblemas(TODOS, { chipAutonomo: false }), TODOS);
});

test('chip autônomo: descarta os problemas de funil e mantém os de segurança/qualidade', () => {
    assert.deepEqual(filtrarProblemas(TODOS, { chipAutonomo: true }),
        ['empilhou_perguntas', 'textao', 'inventou', 'agendamento_fake', 'inconsistente']);
    assert.deepEqual(filtrarProblemas(['nao_explora_necessidade', 'pulou_etapa', 'nao_pediu_nome'], { chipAutonomo: true }), []);
});

test('entrada inválida não quebra', () => {
    assert.deepEqual(filtrarProblemas(undefined, { chipAutonomo: true }), []);
    assert.deepEqual(filtrarProblemas(null, {}), []);
});
