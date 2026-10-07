'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { querAgendar, ehSaudacaoPura, deveProporAgendamento, aceitouConviteDeReuniao, ehAfirmativo } = require('../lib/agendaDecisao');

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

test('AGENDA quando intenção é COMPRA (aceite)', () => {
    assert.equal(deveProporAgendamento({ texto: 'fechado, quero sim', intencao: 'COMPRA', currentStage: 2, temSlots: false }), true);
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

test('ehAfirmativo: pega aceites curtos e ignora negativas/dúvidas', () => {
    for (const s of ['sim', 'bora', 'pode ser', 'quero', 'faz sentido', 'perfeito', 'fechado']) assert.ok(ehAfirmativo(s), `"${s}"`);
    for (const s of ['não', 'talvez', 'depois eu vejo', 'quanto custa?']) assert.ok(!ehAfirmativo(s), `"${s}"`);
});
