'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../lib/reengajamento');

// 05/11/2026 (quinta) 15:00 em Brasília = 18:00 UTC
const AGORA = Date.parse('2026-11-05T18:00:00Z');
const H = 3600e3, MIN = 60e3;
const atras = (ms) => new Date(AGORA - ms).toISOString();

const instancia = { reengajamento_ativo: true };
const lead = { status: 'contact', is_paused: false, manual_pause: false };
// conversa típica: lead escreveu primeiro, Sofia respondeu
const conversa = (minDesdeResposta, minDesdeLead = minDesdeResposta + 1) => [
    { role: 'assistant', content: 'Oi, tudo bem? Sou a Sofia…', created_at: atras(minDesdeResposta * MIN) },
    { role: 'user', content: 'Olá! Posso ter mais informações sobre isso?', created_at: atras(minDesdeLead * MIN) },
];
const decide = (extra = {}) => r.decidirReengajamento({ lead, instancia, mensagens: conversa(50), flags: {}, agora: AGORA, ...extra });

test('lembrete: lead não respondeu 45 min depois da Sofia', () => {
    const d = decide({ mensagens: conversa(46) });
    assert.equal(d.acao, 'lembrete');
    assert.equal(d.inboundEm, AGORA - 47 * MIN);
});

test('ainda não deu 45 min: aguarda', () => {
    const d = decide({ mensagens: conversa(30) });
    assert.equal(d.acao, 'nenhuma');
    assert.equal(d.motivo, 'aguardando');
});

test('lembrete só uma vez por silêncio (flag)', () => {
    assert.equal(decide({ mensagens: conversa(60), flags: { lembrete: true } }).acao, 'nenhuma');
});

test('despedida: ~22h depois da última mensagem do LEAD', () => {
    const msgs = [
        { role: 'assistant', content: 'Estou aqui pra te ajudar…', created_at: atras(21 * H) },
        { role: 'assistant', content: 'Oi, tudo bem?', created_at: atras(22.1 * H) },
        { role: 'user', content: 'Olá!', created_at: atras(22.2 * H) },
    ];
    const d = decide({ mensagens: msgs, flags: { lembrete: true } });
    assert.equal(d.acao, 'despedida');
});

test('despedida sai mesmo se o lembrete nunca saiu (ex.: caiu na madrugada)', () => {
    const msgs = [
        { role: 'assistant', content: 'Oi!', created_at: atras(22.1 * H) },
        { role: 'user', content: 'Olá!', created_at: atras(22.2 * H) },
    ];
    assert.equal(decide({ mensagens: msgs, flags: {} }).acao, 'despedida');
});

test('depois de 20h o lembrete perde o sentido (espera a despedida)', () => {
    const msgs = [
        { role: 'assistant', content: 'Oi!', created_at: atras(20.5 * H) },
        { role: 'user', content: 'Olá!', created_at: atras(20.6 * H) },
    ];
    const d = decide({ mensagens: msgs });
    assert.equal(d.acao, 'nenhuma');
});

test('JANELA DA META: passou de 23,5h do lead → NÃO manda nada (só template entregaria)', () => {
    const msgs = [
        { role: 'assistant', content: 'Oi!', created_at: atras(23.6 * H) },
        { role: 'user', content: 'Olá!', created_at: atras(23.7 * H) },
    ];
    const d = decide({ mensagens: msgs });
    assert.equal(d.acao, 'nenhuma');
    assert.equal(d.motivo, 'janela_fechada');
});

test('despedida só uma vez (flag)', () => {
    const msgs = [{ role: 'assistant', content: 'x', created_at: atras(22.1 * H) }, { role: 'user', content: 'y', created_at: atras(22.2 * H) }];
    assert.equal(decide({ mensagens: msgs, flags: { lembrete: true, despedida: true } }).acao, 'nenhuma');
});

test('se o lead respondeu, não cutuca', () => {
    const d = decide({ mensagens: [{ role: 'user', content: 'Pode ser', created_at: atras(5 * MIN) }, ...conversa(60)] });
    assert.equal(d.motivo, 'lead_respondeu');
});

test('reação (👍) conta como resposta', () => {
    const d = decide({ mensagens: [{ role: 'user', content: '(o lead reagiu com 👍)', created_at: atras(2 * MIN) }, ...conversa(60)] });
    assert.equal(d.acao, 'nenhuma');
});

test('uma pessoa da equipe falou por último → é dela', () => {
    const d = decide({ mensagens: [{ role: 'human_operator', content: 'Oi!', created_at: atras(50 * MIN) }, ...conversa(120)] });
    assert.equal(d.motivo, 'humano_falou');
});

test('uma pessoa da equipe falou nas últimas 24h (e a IA falou depois) → não cutuca', () => {
    const msgs = [
        { role: 'assistant', content: 'Voltei', created_at: atras(60 * MIN) },
        { role: 'human_operator', content: 'Marlon aqui', created_at: atras(3 * H) },
        { role: 'user', content: 'oi', created_at: atras(4 * H) },
    ];
    assert.equal(decide({ mensagens: msgs }).motivo, 'humano_na_conversa');
});

test('autoresposta nunca é cutucada', () => {
    const msgs = [{ role: 'assistant', content: 'Show!', created_at: atras(60 * MIN) }, { role: 'user', content: '[AUTORESPOSTA] Obrigado pelo contato', created_at: atras(61 * MIN) }];
    assert.equal(decide({ mensagens: msgs }).motivo, 'autoresposta');
});

test('quem pediu pra sair não recebe nada', () => {
    const msgs = [{ role: 'assistant', content: 'ok', created_at: atras(60 * MIN) }, { role: 'user', content: 'não me mande mais mensagem', created_at: atras(61 * MIN) }];
    assert.equal(decide({ mensagens: msgs, optOutRegex: /n[ãa]o\s+me\s+(mande|envie)/i }).motivo, 'optout');
});

test('conversa aberta por nós (sem mensagem do lead): fora desta regra', () => {
    assert.equal(decide({ mensagens: [{ role: 'assistant', content: 'oi', created_at: atras(60 * MIN) }] }).motivo, 'sem_inbound');
});

test('lead pausado / agendado / descartado / instância desligada: nada', () => {
    assert.equal(decide({ lead: { ...lead, is_paused: true }, mensagens: conversa(60) }).motivo, 'pausado');
    assert.equal(decide({ lead: { ...lead, manual_pause: true }, mensagens: conversa(60) }).motivo, 'pausado');
    assert.equal(decide({ lead: { ...lead, status: 'booked' }, mensagens: conversa(60) }).motivo, 'status');
    assert.equal(decide({ lead: { ...lead, status: 'dead' }, mensagens: conversa(60) }).motivo, 'status');
    assert.equal(decide({ instancia: { reengajamento_ativo: false }, mensagens: conversa(60) }).motivo, 'desligado');
});

test('horário: nunca cutuca de madrugada (adia pro próximo ciclo)', () => {
    const madrugada = Date.parse('2026-11-05T06:00:00Z'); // 03:00 em Brasília
    const msgs = [{ role: 'assistant', content: 'oi', created_at: new Date(madrugada - 60 * MIN).toISOString() }, { role: 'user', content: 'x', created_at: new Date(madrugada - 61 * MIN).toISOString() }];
    const d = r.decidirReengajamento({ lead, instancia, mensagens: msgs, flags: {}, agora: madrugada });
    assert.equal(d.motivo, 'fora_do_horario');
    const manha = madrugada + 5.5 * H; // 08:30
    const msgs2 = [{ role: 'assistant', content: 'oi', created_at: new Date(madrugada - 60 * MIN).toISOString() }, { role: 'user', content: 'x', created_at: new Date(madrugada - 61 * MIN).toISOString() }];
    assert.equal(r.decidirReengajamento({ lead, instancia, mensagens: msgs2, flags: {}, agora: manha }).acao, 'lembrete');
});

test('limites do horário (08:00 entra, 21:00 não)', () => {
    assert.equal(r.dentroDoHorario(Date.parse('2026-11-05T11:00:00Z')), true);  // 08:00
    assert.equal(r.dentroDoHorario(Date.parse('2026-11-05T10:59:00Z')), false); // 07:59
    assert.equal(r.dentroDoHorario(Date.parse('2026-11-05T23:59:00Z')), true);  // 20:59
    assert.equal(r.dentroDoHorario(Date.parse('2026-11-06T00:00:00Z')), false); // 21:00
});

test('textos com e sem nome (os do pedido do Marlon)', () => {
    assert.equal(r.montarTexto('lembrete', { nome: 'Andreia' }), 'Andreia, estou aqui pra te ajudar... consegue falar agora e testar como funciono?');
    assert.equal(r.montarTexto('lembrete', { nome: '' }), 'Oi! Estou aqui pra te ajudar... consegue falar agora e testar como funciono?');
    assert.equal(r.montarTexto('despedida', { nome: 'Andreia', agora: AGORA }), 'Andreia, respeito seu tempo e decisão, mas saiba que estou aqui se quiser conversar! Desejo uma ótima semana!');
    assert.equal(r.montarTexto('despedida', { nome: '', agora: AGORA }), 'Respeito seu tempo e decisão, mas saiba que estou aqui se quiser conversar! Desejo uma ótima semana!');
});

test('despedida na sexta/sábado deseja bom fim de semana; domingo, boa semana', () => {
    const sexta = Date.parse('2026-11-06T18:00:00Z'), sabado = Date.parse('2026-11-07T18:00:00Z'), domingo = Date.parse('2026-11-08T18:00:00Z');
    assert.match(r.montarTexto('despedida', { nome: 'Ana', agora: sexta }), /ótimo fim de semana/);
    assert.match(r.montarTexto('despedida', { nome: 'Ana', agora: sabado }), /ótimo fim de semana/);
    assert.match(r.montarTexto('despedida', { nome: 'Ana', agora: domingo }), /ótima semana/);
});

test('texto personalizado do cliente: {nome} entra, e some sem deixar vírgula solta', () => {
    assert.equal(r.montarTexto('lembrete', { nome: 'Ana', override: '{nome}, posso te ajudar?' }), 'Ana, posso te ajudar?');
    assert.equal(r.montarTexto('lembrete', { nome: '', override: '{nome}, posso te ajudar?' }), 'Posso te ajudar?');
});
