'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ajustarIntencao } = require('../lib/intencaoContexto');

const PERG_DESCOBERTA = 'E quando ela está ocupada, a pessoa espera muito?';
const CONVITE = 'Faz sentido a gente agendar um papo de 30 minutos com nosso especialista?';
const PERG_DECISOR = 'Quem cuida disso por aí? Com quem eu falo?';

test('conversa do teste da Sofia (23/11): descrever o negócio/a dor não é REPASSE nem OBJEÇÃO', () => {
    // o que o roteador errou na produção
    const casos = [
        ['REPASSE', 'tenho uma funcionaria'],
        ['REPASSE', 'ela faz sozinha'],
        ['REPASSE', 'a secretária responde'],
        ['OBJECAO', 'as pessoas esperam e ela atende só quando volta ficar disponivel'],
        ['OBJECAO', 'nao acontece nada, raramente alguem desmarca'],
        ['OBJECAO', 'só tenho 1 funcionaria e nao posso contratar outra'],
    ];
    for (const [i, t] of casos) assert.equal(ajustarIntencao(i, t, { ultimaIA: PERG_DESCOBERTA }), 'DUVIDA', t);
});

test('"não" seco só é recusa quando a IA tinha acabado de propor algo', () => {
    assert.equal(ajustarIntencao('OBJECAO', 'nao', { ultimaIA: PERG_DESCOBERTA }), 'DUVIDA');
    assert.equal(ajustarIntencao('OBJECAO', 'Não.', { ultimaIA: CONVITE }), 'OBJECAO');
    assert.equal(ajustarIntencao('OBJECAO', 'nao', { ultimaIA: '' }), 'DUVIDA');
});

test('objeções de verdade continuam OBJEÇÃO', () => {
    const reais = ['tá muito caro', 'não tenho interesse', 'já tenho um sistema pra isso', 'vou pensar', 'agora não',
        'não tenho verba pra isso', 'isso é golpe?', 'não preciso disso', 'sem interesse', 'não faz sentido pra mim'];
    for (const t of reais) assert.equal(ajustarIntencao('OBJECAO', t, { ultimaIA: PERG_DESCOBERTA }), 'OBJECAO', t);
});

test('"já tenho uma funcionária" é descrição, não objeção; "já tenho um sistema" é objeção', () => {
    assert.equal(ajustarIntencao('OBJECAO', 'já tenho uma funcionária que atende', { ultimaIA: PERG_DESCOBERTA }), 'DUVIDA');
    assert.equal(ajustarIntencao('OBJECAO', 'já tenho um chatbot', { ultimaIA: PERG_DESCOBERTA }), 'OBJECAO');
});

test('REPASSE de verdade continua REPASSE', () => {
    const reais = ['fala com o meu sócio', 'quem decide é a Maria', 'o responsável é o Carlos', 'meu marido cuida disso',
        'liga pra minha gerente', 'passa o contato dele'];
    for (const t of reais) assert.equal(ajustarIntencao('REPASSE', t, { ultimaIA: PERG_DESCOBERTA }), 'REPASSE', t);
});

test('se a IA perguntou quem decide, qualquer resposta é REPASSE', () => {
    assert.equal(ajustarIntencao('REPASSE', 'a Camila', { ultimaIA: PERG_DECISOR }), 'REPASSE');
    assert.equal(ajustarIntencao('REPASSE', 'sou eu mesmo', { ultimaIA: PERG_DECISOR }), 'REPASSE');
});

test('outras intenções passam intactas', () => {
    for (const i of ['COMPRA', 'DUVIDA', 'LIXO', 'ENCERRAMENTO', 'AGENDA_RETORNO', 'ROBO'])
        assert.equal(ajustarIntencao(i, 'qualquer coisa', { ultimaIA: PERG_DESCOBERTA }), i);
});

test('sem contexto nem texto não quebra', () => {
    assert.equal(ajustarIntencao('OBJECAO', undefined), 'DUVIDA');
    assert.equal(ajustarIntencao('REPASSE', null, {}), 'DUVIDA');
});
