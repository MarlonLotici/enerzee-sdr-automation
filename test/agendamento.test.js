'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectarConfirmacaoSlot, extrairHorarioPedido } = require('../lib/agendamento');

const SLOTS = [
    { inicioISO: '2026-08-21T13:00:00Z', fimISO: '2026-08-21T13:30:00Z', label: 'hoje às 10h' },
    { inicioISO: '2026-08-22T18:00:00Z', fimISO: '2026-08-22T18:30:00Z', label: 'amanhã às 15h' },
];

test('ordinal: "o primeiro" → slot 1; "o segundo" → slot 2', () => {
    assert.equal(detectarConfirmacaoSlot('o primeiro', SLOTS).label, 'hoje às 10h');
    assert.equal(detectarConfirmacaoSlot('pode ser o segundo', SLOTS).label, 'amanhã às 15h');
});

test('hora explícita casa com o slot certo', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser 15h', SLOTS).label, 'amanhã às 15h');
    assert.equal(detectarConfirmacaoSlot('as 10 tá bom', SLOTS).label, 'hoje às 10h');
});

test('"amanhã" quando só um slot é de amanhã', () => {
    assert.equal(detectarConfirmacaoSlot('amanhã fica melhor', SLOTS).label, 'amanhã às 15h');
});

test('recusa/ambiguidade → null', () => {
    assert.equal(detectarConfirmacaoSlot('não pode nenhum desses', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('deixa eu ver depois', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('tudo bem?', SLOTS), null);
});

test('sem slots → null', () => {
    assert.equal(detectarConfirmacaoSlot('o primeiro', []), null);
    assert.equal(detectarConfirmacaoSlot('o primeiro', null), null);
});

// Dois slots na MESMA hora (9h e 9h30): o parser tem que diferenciar pelos minutos.
const SLOTS_MESMA_HORA = [
    { inicioISO: '2026-08-24T12:00:00Z', fimISO: '2026-08-24T12:30:00Z', label: 'seg às 9h' },
    { inicioISO: '2026-08-24T12:30:00Z', fimISO: '2026-08-24T13:00:00Z', label: 'seg às 9h30' },
];

test('minutos: "9:30" cai no slot 9h30 (não no 9h)', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser 9:30', SLOTS_MESMA_HORA).label, 'seg às 9h30');
    assert.equal(detectarConfirmacaoSlot('9h30 tá ótimo', SLOTS_MESMA_HORA).label, 'seg às 9h30');
});

test('minutos: "9h" (minuto 0) casa exatamente o slot 9h, não o 9h30', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser 9h', SLOTS_MESMA_HORA).label, 'seg às 9h');
});

// 🐛 BUG real (Adair 2026-10-10): pediu "as 14" e casou com o slot 14h30 (único da casa das 14h).
// Agora "14" NÃO casa 14h30 — devolve null pra o orquestrador montar 14h00 exato e conferir na agenda.
test('hora sem minuto NÃO casa um slot de minuto diferente ("14" != "14h30")', () => {
    const SLOTS_9_1430 = [
        { inicioISO: '2026-10-15T12:00:00Z', fimISO: '2026-10-15T12:30:00Z', label: 'qui às 9h' },
        { inicioISO: '2026-10-15T17:30:00Z', fimISO: '2026-10-15T18:00:00Z', label: 'qui às 14h30' },
    ];
    assert.equal(detectarConfirmacaoSlot('as 14 pode ser?', SLOTS_9_1430), null);
    assert.equal(detectarConfirmacaoSlot('pode ser 14h', SLOTS_9_1430), null);
    // mas "14h30" explícito casa o slot 14h30; e se houver um slot exatamente 14h00, "14" casa ele.
    assert.equal(detectarConfirmacaoSlot('14h30 pode ser', SLOTS_9_1430).label, 'qui às 14h30');
    const SLOTS_9_14 = [SLOTS_9_1430[0], { inicioISO: '2026-10-15T17:00:00Z', fimISO: '2026-10-15T17:30:00Z', label: 'qui às 14h' }];
    assert.equal(detectarConfirmacaoSlot('as 14', SLOTS_9_14).label, 'qui às 14h');
});

// 🐛 BUG real (2026-10-09): "pode ser segunda" (dia da semana) era lido como "2ª opção"
// (ordinal) e podia marcar o slot ERRADO se os 2 ofertados não fossem ambos segunda-feira.
test('"segunda" sozinho NÃO é tratado como ordinal "2ª opção" (ambíguo com o dia da semana)', () => {
    const SLOTS_TER_QUI = [
        { inicioISO: '2026-08-25T13:00:00Z', fimISO: '2026-08-25T13:30:00Z', label: 'terça às 10h' },
        { inicioISO: '2026-08-27T18:00:00Z', fimISO: '2026-08-27T18:30:00Z', label: 'quinta às 15h' },
    ];
    assert.equal(detectarConfirmacaoSlot('pode ser segunda', SLOTS_TER_QUI), null);
    assert.equal(detectarConfirmacaoSlot('prefiro a segunda', SLOTS_TER_QUI), null);
    // "o segundo" (ordinal explícito, sem ambiguidade de dia) continua funcionando.
    assert.equal(detectarConfirmacaoSlot('quero o segundo', SLOTS_TER_QUI).label, 'quinta às 15h');
});

// 🐛 BUG real (2026-10-09): afirmação genérica ("pode ser") sem número/ordinal voltava null,
// a IA caía em conversa livre e inventava ("deixa eu ver os horários aqui pra você") em vez
// de agendar o horário que ELA MESMA tinha acabado de citar um turno antes.
test('afirmação genérica ("pode ser"/"ok") confirma o horário que a IA citou no turno anterior', () => {
    assert.equal(
        detectarConfirmacaoSlot('Pode ser', SLOTS, 'A gente tem segunda à tarde às 15h. Funciona pra você?').label,
        'amanhã às 15h'
    );
    assert.equal(
        detectarConfirmacaoSlot('ok', SLOTS, 'Consigo às 10h amanhã, fica bom?').label,
        'hoje às 10h'
    );
});

test('afirmação genérica SEM mensagem anterior da IA (ou sem horário nela) continua ambígua → null', () => {
    assert.equal(detectarConfirmacaoSlot('pode ser', SLOTS), null);
    assert.equal(detectarConfirmacaoSlot('pode ser', SLOTS, ''), null);
    assert.equal(detectarConfirmacaoSlot('pode ser', SLOTS, 'Oi, tudo bem?'), null);
});

test('afirmação genérica dentro de frase LONGA não deve casar (evita falso positivo)', () => {
    // "sim" aparece aqui mas a frase tem mais de 4 palavras — não é uma confirmação direta.
    assert.equal(
        detectarConfirmacaoSlot('sim eu queria saber mais sobre os planos antes', SLOTS, 'Consigo às 10h, funciona?'),
        null
    );
});

test('extrairHorarioPedido: pega o horário pedido mesmo fora dos ofertados', () => {
    assert.deepEqual(extrairHorarioPedido('quero as 14 horas'), { h: 14, m: 0 });
    assert.deepEqual(extrairHorarioPedido('pode ser 9:30'), { h: 9, m: 30 });
    assert.deepEqual(extrairHorarioPedido('as 11'), { h: 11, m: 0 });
    assert.equal(extrairHorarioPedido('bom dia'), null);
});

// Bug real 2026-11-18 (Lucas/ANSI): pediu "14;30" com slots 11h30 e 14h30 e a reunião foi marcada às 14h.
const SLOTS_1130_1430 = [
    { inicioISO: '2026-11-19T14:30:00Z', fimISO: '2026-11-19T15:00:00Z', label: 'amanhã às 11h30' },
    { inicioISO: '2026-11-19T17:30:00Z', fimISO: '2026-11-19T18:00:00Z', label: 'amanhã às 14h30' },
];

test('separador ; . , entre hora e minuto casa o slot (14;30 → 14h30)', () => {
    for (const msg of ['amanha as 14;30', '14.30', '14,30', '14 30', 'as 14h30', 'pode ser 14:30', 'às 14 ; 30']) {
        assert.equal(detectarConfirmacaoSlot(msg, SLOTS_1130_1430)?.label, 'amanhã às 14h30', msg);
    }
    assert.equal(detectarConfirmacaoSlot('11;30 tá bom', SLOTS_1130_1430)?.label, 'amanhã às 11h30');
});

test('extrairHorarioPedido entende ; . , como separador de minuto', () => {
    assert.deepEqual(extrairHorarioPedido('amanha as 14;30'), { h: 14, m: 30 });
    assert.deepEqual(extrairHorarioPedido('14.30'), { h: 14, m: 30 });
    assert.deepEqual(extrairHorarioPedido('9,15'), { h: 9, m: 15 });
});

test('regressão: só hora continua hora cheia e não casa slot com minuto', () => {
    const slots = [{ inicioISO: 'x', fimISO: 'y', label: 'amanhã às 14h' }, { inicioISO: 'x', fimISO: 'y', label: 'amanhã às 16h' }];
    assert.equal(detectarConfirmacaoSlot('14h', slots)?.label, 'amanhã às 14h');
    assert.equal(detectarConfirmacaoSlot('14', SLOTS_1130_1430), null);
    assert.deepEqual(extrairHorarioPedido('as 14h'), { h: 14, m: 0 });
});

test('data e preço NÃO viram horário (19.11, 19.11.2026, R$ 10,30)', () => {
    assert.notDeepEqual(extrairHorarioPedido('dia 19.11'), { h: 19, m: 11 });
    assert.notDeepEqual(extrairHorarioPedido('19.11.2026'), { h: 19, m: 11 });
    assert.notDeepEqual(extrairHorarioPedido('custa R$ 10,30'), { h: 10, m: 30 });
    assert.equal(detectarConfirmacaoSlot('dia 19.11 pode ser', SLOTS_1130_1430), null);
});

test('rede de segurança: separador estranho só casa se bater exato com um slot ofertado', () => {
    assert.equal(detectarConfirmacaoSlot('14h-30', SLOTS_1130_1430)?.label, 'amanhã às 14h30');
    assert.equal(detectarConfirmacaoSlot('14h-45', SLOTS_1130_1430), null);
});
