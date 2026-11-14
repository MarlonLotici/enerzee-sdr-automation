'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { faseDoCiclo, blocoDaFase, tenantComCiclo } = require('../lib/cicloVenda');

const A = (content) => ({ role: 'assistant', content });
const U = (content) => ({ role: 'user', content });

// Conversa real de 2026-11-14 (Haislann): a IA ficou 8 turnos na dor.
const conversa = [
    U('Boa noite'),
    A('Oi, boa noite! Sou a Sofia da Antix, ajudamos empresas a automatizar processos comerciais com agentes de inteligência artificial. Como posso te ajudar hoje?'),
    U('Vi vcs no Instagram'),
    A('[AUDIO_TTS] Legal, vocês já têm alguma estratégia de captação de leads no Instagram ou estão começando agora?'),
    U('Já temos alguns conteúdos , mas estamos com alguns problemas internos'),
    A('Entendi, conteúdos no Instagram e aí surgiram desafios internos. Como vocês estão organizando a captação e o follow-up desses leads hoje?'),
    U('Captação via tráfego pago'),
    A('[AUDIO_TTS] Entendi, tráfego pago gera leads. Qual é a maior dor que vocês enfrentam no momento com a qualificação ou o agendamento desses leads?'),
    U('(Áudio) Nós temos um time de pré-vendas, só que eles não estão conseguindo gerar agenda suficiente. Eu queria mais volume e mais qualificação.'),
];

test('caso real: depois de 3 perguntas de descoberta respondidas, a fase é SOLUÇÃO', () => {
    const r = faseDoCiclo(conversa, { current_stage: 2 });
    assert.equal(r.fase, 'solucao');
    assert.equal(r.perguntasRespondidas, 3);
});

test('antes disso continua descoberta (não pula a exploração)', () => {
    assert.equal(faseDoCiclo(conversa.slice(0, 5), { current_stage: 1 }).fase, 'descoberta');
    assert.equal(faseDoCiclo(conversa.slice(0, 7), { current_stage: 1 }).fase, 'descoberta');
    assert.equal(faseDoCiclo([U('oi')], {}).fase, 'descoberta');
});

test('na conversa inteira do bug (8+ turnos) a fase ainda manda ir pra solução, não perguntar de novo', () => {
    const longa = [...conversa,
        A('Pera, deixa eu entender: o time de pré-vendas recebe os leads, mas não consegue transformar em agendas qualificadas, certo?'),
        U('Sim, o time trabalha a nossa base'),
        A('Quanto isso está impactando o número de oportunidades que vocês perdem por mês?'),
        U('Vamos disparar em massa'),
        A('Qual o maior desafio que vocês enfrentam hoje ao transformar esse volume em reuniões qualificadas?'),
        U('Volume e qualidade')];
    assert.equal(faseDoCiclo(longa, { current_stage: 2 }).fase, 'solucao');
});

test('solução apresentada (estágio 3 ou fala da IA) leva ao CONVITE', () => {
    assert.equal(faseDoCiclo(conversa, { current_stage: 3 }).fase, 'convite');
    const comSolucao = [...conversa,
        A('Então quando o volume sobe a qualidade cai. A gente resolve isso com um agente que conversa com cada lead e qualifica antes de passar pro time. Isso resolveria o que vocês vivem?'),
        U('Resolveria sim')];
    assert.equal(faseDoCiclo(comSolucao, { current_stage: 2 }).fase, 'convite');
});

test('convite feito, agenda em curso ou lead agendado → fase agendamento (o sistema cuida)', () => {
    const comConvite = [...conversa, A('Faz sentido agendar um papo de 30 minutos com nosso especialista?'), U('faz')];
    assert.equal(faseDoCiclo(comConvite, { current_stage: 4 }).fase, 'agendamento');
    assert.equal(faseDoCiclo(conversa, { slots_propostos: [{ label: 'seg às 11h' }] }).fase, 'agendamento');
    assert.equal(faseDoCiclo(conversa, { status: 'booked' }).fase, 'agendamento');
});

test('a fala de abertura e perguntas sem resposta não contam', () => {
    // 3 perguntas seguidas sem o lead responder (mesmo turno) contam como 1 turno
    const h = [U('oi'), A('Oi! Tudo bem?'), A('Como posso ajudar?'), U('quero saber da empresa')];
    assert.equal(faseDoCiclo(h, {}).perguntasRespondidas, 0);
});

test('o bloco da fase manda a solução e proíbe nova pergunta de descoberta e horário', () => {
    const b = blocoDaFase({ fase: 'solucao', perguntasRespondidas: 3 });
    assert.match(b, /APRESENTAR A SOLUÇÃO/);
    assert.match(b, /PROIBIDO: perguntar de novo/);
    assert.match(b, /NÃO convide pra reunião ainda/);
    assert.match(blocoDaFase({ fase: 'convite' }), /faz sentido agendar/);
    assert.equal(blocoDaFase({ fase: 'descoberta' }), '');
    assert.equal(blocoDaFase({ fase: 'agendamento' }), '');
});

test('só a Antix usa o ciclo rígido por padrão; env sobrescreve', () => {
    assert.equal(tenantComCiclo('f437f090-5fa0-4a94-b4aa-8c22998c9cf6', {}), true);
    assert.equal(tenantComCiclo('cfa8f1e9-0000-0000-0000-000000000000', {}), false);
    assert.equal(tenantComCiclo('abc', { CICLO_SOLUCAO_USER_IDS: 'abc, def' }), true);
});

const { respostaCumpreFase, estagioDaFase, forcarEstagio, textoFixoDaFase, leadRecusou } = require('../lib/cicloVenda');

test('respostas REAIS que ficaram presas na dor NÃO cumprem a fase solução', () => {
    assert.equal(respostaCumpreFase('solucao', 'Entendi, você sente que está faltando tanto volume quanto qualidade nas agendas. Qual o maior obstáculo que vocês enfrentam hoje ao transformar esse volume em reuniões qualificadas?'), false);
    assert.equal(respostaCumpreFase('solucao', 'Qual o maior desafio que vocês enfrentam hoje ao transformar esse volume em reuniões realmente qualificadas?'), false);
    // pitch genérico + pergunta de descoberta (o que ela mandou às 02:01) também não vale
    assert.equal(respostaCumpreFase('solucao', 'A Antix cria agentes de inteligência artificial sob medida para cada ponto do funil comercial, desde a qualificação de leads no WhatsApp até o follow-up pós-venda. Qual seria a meta de volume de agendas qualificadas que vocês gostariam de alcançar por mês?'), false);
});

test('respostas boas (espelha a dor, mostra a solução, valida) cumprem a fase solução', () => {
    assert.equal(respostaCumpreFase('solucao', 'Então o que pega é que, mesmo com volume, a qualidade das agendas não está atendendo ao padrão que vocês precisam. Nosso agente de IA qualifica cada lead antes de passar ao time, garantindo critérios definidos e mantendo a consistência mesmo com alta demanda. Isso faria sentido para melhorar a agenda de vocês?'), true);
    assert.equal(respostaCumpreFase('solucao', textoFixoDaFase('solucao')), true);
});

test('solução com horário ou convite junto NÃO cumpre (convite é outra fase)', () => {
    assert.equal(respostaCumpreFase('solucao', 'Nosso agente de IA qualifica cada lead antes de passar pro time e mantém o padrão com volume alto. Posso te mandar os horários dessa semana?'), false);
});

test('fase convite: convida sem horário; texto fixo também vale', () => {
    assert.equal(respostaCumpreFase('convite', 'Faz sentido agendar uma conversa de 30 minutos com nosso especialista para detalharmos a solução?'), true);
    assert.equal(respostaCumpreFase('convite', textoFixoDaFase('convite', 0)), true);
    assert.equal(respostaCumpreFase('convite', textoFixoDaFase('convite', 1)), true);
    assert.equal(respostaCumpreFase('convite', 'Qual o maior desafio de vocês hoje?'), false);
    assert.equal(respostaCumpreFase('convite', 'Faz sentido agendar um papo? Tenho amanhã às 10h.'), false);
});

test('o código é dono do estágio: força a etiqueta e mapeia fase → estágio', () => {
    assert.equal(estagioDaFase('solucao'), 3);
    assert.equal(estagioDaFase('convite'), 4);
    assert.equal(estagioDaFase('descoberta'), null);
    assert.equal(forcarEstagio('Texto da IA [ESTAGIO:2] [CLIMA:Neutro]', 3), 'Texto da IA  [CLIMA:Neutro] [ESTAGIO:3]'.replace('  ', ' '));
    assert.match(forcarEstagio('Sem etiqueta', 4), /\[ESTAGIO:4\]$/);
    assert.doesNotMatch(forcarEstagio('A [ESTAGIO: 2] b [estágio:5]', 3), /ESTAGIO:2|estágio:5/i);
});

test('lead que recusa não é forçado a avançar no ciclo', () => {
    assert.equal(leadRecusou('não tenho interesse, obrigado'), true);
    assert.equal(leadRecusou('agora não'), true);
    assert.equal(leadRecusou('Volume e qualidade'), false);
    assert.equal(leadRecusou('faz sentido sim'), false);
});
