'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { querAgendar, ehSaudacaoPura, deveProporAgendamento, aceitouConviteDeReuniao, ehAfirmativo, ehDuvidaSobreReuniao } = require('../lib/agendaDecisao');

// ── ehSaudacaoPura ─────────────────────────────────────────────────────────────
test('ehSaudacaoPura: reconhece cumprimentos puros', () => {
    for (const s of ['oi', 'Oi!', 'olá', 'ola', 'opa', 'e aí', 'bom dia', 'boa tarde', 'boa noite', 'menu', '  oii  ']) {
        assert.ok(ehSaudacaoPura(s), `"${s}" deveria ser saudação pura`);
    }
});
test('ehSaudacaoPura: NÃO marca frase com conteúdo real', () => {
    for (const s of ['oi, quero agendar', 'bom dia, quanto custa?', 'olá tudo bem me chamo joão']) {
        assert.ok(!ehSaudacaoPura(s), `"${s}" NÃO é saudação pura`);
    }
});

// ── querAgendar ────────────────────────────────────────────────────────────────
test('querAgendar: pega intenção de marcar (verbos, dias, relativos)', () => {
    for (const s of ['quero agendar', 'podemos marcar uma reunião', 'pode ser amanhã', 'que horas você tem',
        'tem horário na quinta?', 'vamos marcar', 'que dia fica bom', 'semana que vem']) {
        assert.ok(querAgendar(s), `"${s}" deveria disparar querAgendar`);
    }
});
test('querAgendar: NÃO dispara em conversa comum', () => {
    for (const s of ['quanto custa o serviço?', 'como funciona a IA?', 'oi tudo bem']) {
        assert.ok(!querAgendar(s), `"${s}" NÃO deveria disparar`);
    }
});

// ── deveProporAgendamento (o coração da trava) ─────────────────────────────────
test('NÃO agenda com um "oi" (bug clássico do estágio herdado)', () => {
    // Mesmo que o lead esteja em estágio alto (herdado de outro chip), "oi" não pode propor horário.
    assert.equal(deveProporAgendamento({ texto: 'oi', intencao: 'DUVIDA', currentStage: 5, temSlots: false }), false);
    assert.equal(deveProporAgendamento({ texto: 'bom dia', intencao: 'DUVIDA', currentStage: 4, temSlots: false }), false);
});

test('NÃO agenda em conversa inicial comum (estágio 0, sem pedir)', () => {
    assert.equal(deveProporAgendamento({ texto: 'quanto custa?', intencao: 'DUVIDA', currentStage: 0, temSlots: false }), false);
});

test('AGENDA quando o lead pede explicitamente', () => {
    assert.equal(deveProporAgendamento({ texto: 'pode ser amanhã às 10h', intencao: 'DUVIDA', currentStage: 1, temSlots: false }), true);
});

test('AGENDA quando intenção é COMPRA (aceite) JÁ qualificado (estágio>=3)', () => {
    assert.equal(deveProporAgendamento({ texto: 'fechado, quero sim', intencao: 'COMPRA', currentStage: 3, temSlots: false }), true);
});

test('NÃO agenda (afoita): COMPRA cedo, antes de qualificar (estágio<3)', () => {
    // "às vezes sim" confirmando uma dor no início NÃO pode disparar horário.
    assert.equal(deveProporAgendamento({ texto: 'às vezes sim', intencao: 'COMPRA', currentStage: 2, temSlots: false }), false);
});

test('AGENDA quando já há slots propostos (conversa de agenda em curso)', () => {
    assert.equal(deveProporAgendamento({ texto: 'o primeiro', intencao: 'DUVIDA', currentStage: 4, temSlots: true }), true);
});

test('AGENDA no estágio>=4 com mensagem real (não-saudação) — mata "vou verificar e retorno"', () => {
    assert.equal(deveProporAgendamento({ texto: 'consegue essa semana?', intencao: 'DUVIDA', currentStage: 4, temSlots: false }), true);
});

test('defaults seguros: sem argumentos → não agenda', () => {
    assert.equal(deveProporAgendamento(), false);
    assert.equal(deveProporAgendamento({}), false);
});

// ── BACKBONE: não propor horário quando o lead só respondeu uma qualificação ────
test('NÃO agenda quando o lead só responde uma pergunta de qualificação (bug "30 minutos")', () => {
    // Estágio alto NÃO basta: sem sinal real de agendar, não propõe.
    assert.equal(deveProporAgendamento({ texto: '30 minutos', intencao: 'DUVIDA', currentStage: 4, temSlots: false }), false);
    assert.equal(deveProporAgendamento({ texto: 'eu já recebo clientes', intencao: 'CONTINUAR', currentStage: 4, temSlots: false }), false);
    assert.equal(deveProporAgendamento({ texto: 'por wpp', intencao: 'DUVIDA', currentStage: 5, temSlots: false }), false);
});

test('AGENDA quando a IA convidou pra reunião e o lead topou (aceitouConvite + afirmativo)', () => {
    assert.equal(deveProporAgendamento({ texto: 'sim, faz sentido', intencao: 'DUVIDA', currentStage: 3, temSlots: false, aceitouConvite: true }), true);
    assert.equal(deveProporAgendamento({ texto: 'bora', intencao: 'CONTINUAR', currentStage: 3, temSlots: false, aceitouConvite: true }), true);
});

test('NÃO agenda com "sim" se a IA NÃO tinha convidado pra reunião', () => {
    assert.equal(deveProporAgendamento({ texto: 'sim', intencao: 'DUVIDA', currentStage: 3, temSlots: false, aceitouConvite: false }), false);
});

test('aceitouConviteDeReuniao: detecta convite anterior + aceite', () => {
    const histComConvite = [
        { role: 'user', content: 'to vendo sim' },
        { role: 'assistant', content: 'faz sentido a gente marcar uma call rápida de 15 min pra te mostrar?' },
    ];
    assert.equal(aceitouConviteDeReuniao(histComConvite, 'sim, bora'), true);
    assert.equal(aceitouConviteDeReuniao(histComConvite, 'ainda não sei'), false); // não é afirmativo
    const histSemConvite = [{ role: 'assistant', content: 'e quantos leads vocês recebem por mês?' }];
    assert.equal(aceitouConviteDeReuniao(histSemConvite, 'sim'), false); // não houve convite
});

// ── ehDuvidaSobreReuniao / não empurrar reunião por cima de uma pergunta ──────
test('ehDuvidaSobreReuniao: pergunta SOBRE a reunião é dúvida (não pedido de marcar)', () => {
    for (const s of [
        'E como funciona a reunião?',            // o caso do print
        'como funciona a reunião',
        'o que é essa call?',
        'quanto tempo dura a reunião?',
        'a reunião é online ou presencial?',
        'a call é paga?',
        'preciso levar algo pra reunião?',
        'me explica como funciona a reunião',
        'pra que serve essa conversa?',
    ]) assert.ok(ehDuvidaSobreReuniao(s), `"${s}" deveria ser dúvida sobre a reunião`);
});

test('ehDuvidaSobreReuniao: pedido real de marcar NÃO é dúvida', () => {
    for (const s of [
        'podemos marcar uma reunião',
        'quero agendar a reunião',
        'bora marcar essa call',
        'que dia você tem?',
        'tem horário amanhã?',
    ]) assert.ok(!ehDuvidaSobreReuniao(s), `"${s}" NÃO é dúvida (é pedido de marcar)`);
});

test('NÃO agenda quando o lead só PERGUNTA sobre a reunião (bug do print)', () => {
    // A palavra "reunião" na pergunta NÃO pode disparar a oferta de horário por cima da dúvida.
    assert.equal(deveProporAgendamento({ texto: 'E como funciona a reunião?', intencao: 'DUVIDA', currentStage: 4, temSlots: false }), false);
    assert.equal(deveProporAgendamento({ texto: 'a reunião é online?', intencao: 'DUVIDA', currentStage: 5, temSlots: false }), false);
    assert.equal(deveProporAgendamento({ texto: 'quanto tempo dura a call?', intencao: 'DUVIDA', currentStage: 4, temSlots: false }), false);
});

test('mesmo sendo dúvida, se já há slots em curso segue no fluxo de agenda (LLM responde no contexto)', () => {
    // temSlots vence: a fase de confirmação do orquestrador roteia a dúvida pro LLM, sem reofertar.
    assert.equal(deveProporAgendamento({ texto: 'como funciona a reunião?', intencao: 'DUVIDA', currentStage: 4, temSlots: true }), true);
});

test('ehAfirmativo: pega aceites curtos e ignora negativas/dúvidas', () => {
    for (const s of ['sim', 'bora', 'pode ser', 'quero', 'faz sentido', 'perfeito', 'fechado']) assert.ok(ehAfirmativo(s), `"${s}"`);
    for (const s of ['não', 'talvez', 'depois eu vejo', 'quanto custa?']) assert.ok(!ehAfirmativo(s), `"${s}"`);
});
