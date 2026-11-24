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

// Conversa real de 2026-11-17/18 (Lucas/ANSI): só 1 pergunta de descoberta foi de fato respondida.
// A autoresposta do WhatsApp Business dele e o "OI" dois dias depois contaram como respostas e a
// Sofia caiu na SOLUCAO_FIXA ("Entendi o cenário de vocês...") sem a dor ter sido mapeada.
const conversaLucas = [
    U('Oi'),
    U('Querida'),
    A('Oi! 😊 Sou a Sofia, da Antix. A gente cria agentes de inteligência artificial sob medida pro comercial de empresas. O que te trouxe até aqui?'),
    U('Preciso melhorar o marketing da minha empresa'),
    A('Legal! Me conta rapidinho: o que a sua empresa vende e como vocês atraem clientes hoje?'),
    U('Trabalhamos com engenharia elétrica'),
    A('Bacana! E como vocês atraem clientes hoje?'),
    A('Lucas, estou aqui pra te ajudar... consegue falar agora e testar como funciono?'),
    U('[AUTORESPOSTA] Agradecemos sua mensagem. Não estamos disponíveis no momento, mas entraremos em contato assim que possível.'),
    A('[AUDIO_TTS] Sem problema! Quando você tiver um tempinho, me chama aqui que a gente continua de onde parou. 😊'),
    A('Lucas, estou aqui pra te ajudar... consegue falar agora e testar como funciono?'),
    A('Lucas, respeito seu tempo e decisão, mas saiba que estou aqui se quiser conversar! Desejo uma ótima semana!'),
    U('OI'),
];

test('caso Lucas: autoresposta e "OI" não contam como pergunta de descoberta respondida', () => {
    const r = faseDoCiclo(conversaLucas, { current_stage: 2 });
    assert.equal(r.fase, 'descoberta');
    assert.equal(r.perguntasRespondidas, 1);
});

test('autoresposta marcada nunca vira resposta, mesmo sem saudação', () => {
    const h = [
        U('Oi'), A('Oi! Sou a Sofia. O que te trouxe até aqui?'),
        U('Preciso de leads'), A('O que vocês vendem?'),
        U('[AUTORESPOSTA] Obrigado pelo contato. Nosso horário de atendimento é de seg a sex.'),
        A('E como vocês atraem clientes hoje?'), U('[SUSPEITA_BOT] Menu principal'),
    ];
    // a resposta à abertura não conta, e as 2 mensagens marcadas são ignoradas: nada de descoberta respondido
    assert.equal(faseDoCiclo(h, {}).perguntasRespondidas, 0);
    assert.equal(faseDoCiclo(h, {}).fase, 'descoberta');
});

test('resposta de gente continua contando (regressão): "sim"/"não"/frase curta', () => {
    const h = [
        U('Oi'), A('Oi! Sou a Sofia. O que te trouxe até aqui?'),
        U('Preciso de leads'), A('Vocês já usam tráfego pago?'),
        U('sim'), A('E o time comercial dá conta?'),
        U('não'),
    ];
    assert.equal(faseDoCiclo(h, {}).perguntasRespondidas, 2);
});

// ── Teste da Sofia em 23/11: a solução saiu cedo demais (já em "tenho uma clínica") e uma solução ótima foi reprovada por
//    conter a palavra "horário". Conversa real, mesmas falas do cliente.
const { respostaCumpreFase: cumpre, textoFixoDaFase: fixo } = require('../lib/cicloVenda');
const sofia = [
    U('Oie'), A('Oie! Sou a Sofia, da Antix. O que te trouxe até aqui?'),
    U('Legal, foi insta'), A('Que bom que veio do Instagram! E aí, o que te chamou atenção por lá?'),
    U('gostei do atendimento fora de horário'), A('Boa! Atendimento fora de horário faz muita diferença, né?'),
    U('ahm'), A('Me conta uma coisa: você tem um negócio próprio ou trabalha com vendas?'),
    U('eu tenho negócio proprio, uma clinica'), A('E como é o atendimento na clínica hoje?'),
    U('tenho uma funcionaria'), A('Ela cuida do atendimento sozinha ou vocês dividem?'),
    U('ela faz sozinha'), A('E quando ela está ocupada ou fora do horário, como fica o atendimento?'),
    U('as pessoas esperam e ela atende só quando volta ficar disponivel'), A('E quando a pessoa fica esperando, o que costuma acontecer?'),
    U('nao acontece nada, raramente alguem desmarca'),
];

test('só descrever o negócio não basta: sem necessidade dita continua descoberta (mesmo com 3+ respostas)', () => {
    const ateClinica = sofia.slice(0, 9);          // "eu tenho negócio proprio, uma clinica"
    assert.equal(faseDoCiclo(ateClinica, { current_stage: 2 }).perguntasRespondidas, 3);
    assert.equal(faseDoCiclo(ateClinica, { current_stage: 2 }).fase, 'descoberta');
    assert.equal(faseDoCiclo(sofia.slice(0, 13), { current_stage: 2 }).fase, 'descoberta'); // "ela faz sozinha"
});

test('quando o cliente nomeia o que o incomoda ("as pessoas esperam"), a próxima fala é a solução', () => {
    assert.equal(faseDoCiclo(sofia.slice(0, 15), { current_stage: 2 }).fase, 'solucao');
    assert.equal(faseDoCiclo(sofia, { current_stage: 2 }).fase, 'solucao');
});

test('sem nenhuma necessidade dita, a solução entra mesmo assim depois de 6 respostas (não fica preso)', () => {
    const conversaFiada = [U('oi'), A('Oi! O que te trouxe aqui?')];
    for (let i = 0; i < 6; i++) conversaFiada.push(U('uhum ' + i), A('E ' + i + '? Me conta mais, o que mais?'));
    conversaFiada.push(U('uhum final'));
    const r = faseDoCiclo(conversaFiada, { current_stage: 2 });
    assert.ok(r.perguntasRespondidas >= 6);
    assert.equal(r.fase, 'solucao');
});

test('conferidor: a palavra "horário" na descrição do produto ou na dor do cliente NÃO reprova uma boa solução', () => {
    const boa = 'Olha, faz todo sentido: experiência melhor e mais agendamentos é o que faz a clínica crescer. A Antix cria um agente de inteligência artificial sob medida pra atender no WhatsApp da clínica: ele responde na hora, 24 horas por dia, mesmo fora do horário, e já marca o horário direto na agenda. Isso resolveria o que vocês vivem hoje?';
    assert.equal(cumpre('solucao', boa), true);
    assert.equal(cumpre('solucao', fixo('solucao')), true);
});

test('conferidor: horário CONCRETO ou oferta de horários continua reprovando', () => {
    const base = 'A Antix cria um agente de inteligência artificial que atende na hora, 24 horas por dia, e deixa tudo encaminhado pro seu time. ';
    for (const cola of ['Tenho amanhã às 10h. Isso resolveria?', 'Posso ver os horários da semana? Isso resolveria?', 'Quinta-feira funciona? Isso resolveria?', 'Tenho horários disponíveis. Isso resolveria?']) {
        assert.equal(cumpre('solucao', base + cola), false, cola);
    }
});

test('texto fixo da solução não fala mais em "volume de leads" e fecha com pergunta de validação', () => {
    assert.doesNotMatch(fixo('solucao'), /volume|gargalo/i);
    assert.match(fixo('solucao'), /\?$/);
});

test('convite com outras formulações também vale ("e se a gente marcasse…")', () => {
    assert.equal(cumpre('convite', 'Perfeito! E se a gente marcasse uma conversa de 30 minutos com um especialista pra ele entender melhor seu fluxo?'), true);
    assert.equal(cumpre('convite', 'Que bom! Que tal agendarmos um papo de 30 minutos com o nosso especialista?'), true);
    assert.equal(cumpre('convite', 'Que bom! E se a gente marcasse amanhã às 10h?'), false, 'horário concreto continua reprovando');
});

test('lembreteDaFase: só solução e convite têm lembrete; anexarLembrete copia e só cola na fala do cliente', () => {
    const { lembreteDaFase, anexarLembrete } = require('../lib/cicloVenda');
    assert.equal(lembreteDaFase({ fase: 'descoberta' }), '');
    assert.equal(lembreteDaFase({ fase: 'agendamento' }), '');
    assert.match(lembreteDaFase({ fase: 'solucao' }), /SOLUÇÃO[\s\S]*ESTAGIO:3/);
    assert.match(lembreteDaFase({ fase: 'convite' }), /CONVITE[\s\S]*ESTAGIO:4/);
    const h = [U('oi'), A('olá'), U('quero melhorar')];
    const novo = anexarLembrete(h, 'LEMBRETE');
    assert.equal(novo[2].content, 'quero melhorar\n\nLEMBRETE');
    assert.equal(h[2].content, 'quero melhorar', 'não altera o histórico original');
    assert.equal(anexarLembrete([U('a'), A('b')], 'LEMBRETE')[1].content, 'b', 'última fala da IA: não cola nada');
    assert.equal(anexarLembrete(h, ''), h);
    assert.deepEqual(anexarLembrete([], 'X'), []);
});

test('esclarecimento: a IA marca [ESCLARECENDO] e o código reconhece e limpa a etiqueta (sem palavra-chave do lead)', () => {
    const { ehEsclarecimento, tirarEsclarecimento } = require('../lib/cicloVenda');
    const r = 'A gente cria um agente de IA que responde o paciente na hora, de madrugada também. Ficou claro? [ESCLARECENDO]';
    assert.equal(ehEsclarecimento(r), true);
    assert.equal(ehEsclarecimento('Faz sentido agendar um papo? [ESTAGIO:4]'), false);
    assert.equal(tirarEsclarecimento(r + ' [ESTAGIO:3]'), 'A gente cria um agente de IA que responde o paciente na hora, de madrugada também. Ficou claro?');
});

test('lembrete da fase põe o cliente primeiro: manda responder a dúvida com verdade e usar [ESCLARECENDO]', () => {
    const { lembreteDaFase, blocoDaFase } = require('../lib/cicloVenda');
    for (const fase of ['solucao', 'convite']) {
        const l = lembreteDaFase({ fase });
        assert.match(l, /ESCLARECENDO/);
        assert.match(l, /nunca invente/i);
        assert.match(l, /NO MÁXIMO 2 frases/);
        assert.match(blocoDaFase({ fase, perguntasRespondidas: 4 }), /ESCLARECENDO/);
    }
});
