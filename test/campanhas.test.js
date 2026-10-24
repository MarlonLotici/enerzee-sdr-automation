'use strict';
// Regras puras das campanhas de reaquecimento (lib/campanhas.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/campanhas');

test('normalizarTelefone: formatos BR comuns viram 55+DDD+número', () => {
    assert.equal(R.normalizarTelefone('(11) 99999-8888'), '5511999998888');
    assert.equal(R.normalizarTelefone('+55 11 99999-8888'), '5511999998888');
    assert.equal(R.normalizarTelefone('011 3333-4444'), '551133334444');
    assert.equal(R.normalizarTelefone('5511999998888'), '5511999998888');
    assert.equal(R.normalizarTelefone('123'), null);
    assert.equal(R.normalizarTelefone(''), null);
    assert.equal(R.normalizarTelefone('55119999988881'), null); // 14 dígitos com 55 = inválido BR
});

test('variantesJidBR: celular com e sem o 9º dígito', () => {
    assert.deepEqual(R.variantesJidBR('5511999998888@s.whatsapp.net').sort(),
        ['551199998888@s.whatsapp.net', '5511999998888@s.whatsapp.net'].sort());
    assert.deepEqual(R.variantesJidBR('551199998888').sort(),
        ['551199998888@s.whatsapp.net', '5511999998888@s.whatsapp.net'].sort());
    // fixo (começa com 2-5) não ganha 9
    assert.deepEqual(R.variantesJidBR('551133334444'), ['551133334444@s.whatsapp.net']);
});

test('montarParametros: preenche {{n}} com campos do lead, dados importados e padrão', () => {
    const lead = { dono: 'MARIA souza', name: 'Loja X', dados_cliente: { produto: 'Plano Ouro', ultima_compra: '' } };
    const r = R.montarParametros([
        { campo: 'primeiro_nome' }, { campo: 'dados.produto' }, { campo: 'dados.ultima_compra', padrao: 'há um tempo' },
    ], lead);
    assert.equal(r.ok, true);
    assert.deepEqual(r.valores, ['Maria', 'Plano Ouro', 'há um tempo']);
    assert.deepEqual(r.componentes, [{ type: 'body', parameters: [
        { type: 'text', text: 'Maria' }, { type: 'text', text: 'Plano Ouro' }, { type: 'text', text: 'há um tempo' },
    ] }]);
});

test('montarParametros: variável vazia sem padrão BARRA o envio (a Meta rejeitaria)', () => {
    const r = R.montarParametros([{ campo: 'dados.cupom' }], { dados_cliente: {} });
    assert.equal(r.ok, false);
    assert.match(r.erro, /\{\{1\}\}/);
});

test('montarParametros: template sem variáveis manda sem components', () => {
    assert.deepEqual(R.montarParametros([], {}).componentes, []);
});

test('renderizarTexto: troca {{n}} pelos valores', () => {
    assert.equal(R.renderizarTexto('Oi {{1}}, seu {{2}} venceu', ['Ana', 'plano']), 'Oi Ana, seu plano venceu');
    assert.equal(R.renderizarTexto('Oi {{ 1 }}', ['Ana']), 'Oi Ana');
});

test('dentroDaJanela: usa hora de Brasília (UTC-3)', () => {
    assert.equal(R.dentroDaJanela(new Date('2026-10-24T12:00:00Z'), 9, 19), true);  // 09h BRT
    assert.equal(R.dentroDaJanela(new Date('2026-10-24T11:59:00Z'), 9, 19), false); // 08:59 BRT
    assert.equal(R.dentroDaJanela(new Date('2026-10-24T22:00:00Z'), 9, 19), false); // 19h BRT (fim exclusivo)
});

test('inicioDoDiaBRT: meia-noite de Brasília', () => {
    assert.equal(R.inicioDoDiaBRT(new Date('2026-10-24T02:00:00Z')), '2026-10-23T03:00:00.000Z'); // ainda dia 23 em BRT
    assert.equal(R.inicioDoDiaBRT(new Date('2026-10-24T15:00:00Z')), '2026-10-24T03:00:00.000Z');
});

const CAMP = { id: 'c1', frequencia_dias: 30, templates: [{ nome: 'a' }, { nome: 'b', esperaDias: 3 }] };
const AGORA = new Date('2026-10-24T15:00:00Z');

test('avaliarEnvio: bloqueia opt-out, do_not_call, número inválido e status terminal', () => {
    const base = { contato: { passo: 0, status: 'pendente' }, campanha: CAMP, agora: AGORA };
    assert.deepEqual(R.avaliarEnvio({ ...base, lead: { opt_out: true } }), { acao: 'ignorar', motivo: 'opt_out' });
    assert.equal(R.avaliarEnvio({ ...base, lead: { do_not_call: true } }).motivo, 'do_not_call');
    assert.equal(R.avaliarEnvio({ ...base, lead: { status: 'invalid_number' } }).motivo, 'numero_invalido');
    assert.equal(R.avaliarEnvio({ ...base, lead: {}, contato: { status: 'respondeu' } }).acao, 'ignorar');
    assert.equal(R.avaliarEnvio({ ...base, lead: null }).motivo, 'lead_removido');
});

test('avaliarEnvio: conversa ativa (lead falou < 24h) adia 1 dia', () => {
    const r = R.avaliarEnvio({ contato: { passo: 0, status: 'pendente' }, lead: {}, campanha: CAMP, agora: AGORA,
        ultimaMsgDoLeadAt: '2026-10-24T10:00:00Z' });
    assert.equal(r.acao, 'adiar');
    assert.equal(r.ate, '2026-10-25T15:00:00.000Z');
});

test('avaliarEnvio: frequência só barra se a última campanha foi OUTRA e recente (1º toque)', () => {
    const recente = { ultima_campanha_at: '2026-10-10T00:00:00Z' };
    const ctx = { contato: { passo: 0, status: 'pendente' }, campanha: CAMP, agora: AGORA };
    assert.equal(R.avaliarEnvio({ ...ctx, lead: { ...recente, ultima_campanha_id: 'outra' } }).motivo, 'frequencia');
    assert.equal(R.avaliarEnvio({ ...ctx, lead: { ...recente, ultima_campanha_id: 'c1' } }).acao, 'enviar');
    assert.equal(R.avaliarEnvio({ ...ctx, lead: { ultima_campanha_at: '2026-08-01T00:00:00Z', ultima_campanha_id: 'outra' } }).acao, 'enviar');
    // passo 2 da MESMA campanha nunca é barrado por frequência
    assert.equal(R.avaliarEnvio({ ...ctx, contato: { passo: 1, status: 'lido' }, lead: { ...recente, ultima_campanha_id: 'outra' } }).acao, 'enviar');
});

test('avaliarEnvio: sem próximo passo → ignora', () => {
    assert.equal(R.avaliarEnvio({ contato: { passo: 2, status: 'lido' }, lead: {}, campanha: CAMP, agora: AGORA }).motivo, 'sem_proximo_passo');
});

test('proximoEnvioApos: usa esperaDias do PRÓXIMO passo; último passo → null', () => {
    assert.equal(R.proximoEnvioApos(0, CAMP.templates, AGORA), '2026-10-27T15:00:00.000Z');
    assert.equal(R.proximoEnvioApos(1, CAMP.templates, AGORA), null);
});

test('ehOptOut: pedidos inequívocos sim, frases normais não', () => {
    for (const t of ['PARAR', 'Parar.', 'sair', 'stop', 'não quero', 'Não quero mais receber essas mensagens',
        'para de me mandar mensagem', 'me tira dessa lista', '(Áudio) não me mande mais isso']) {
        assert.equal(R.ehOptOut(t), true, t);
    }
    for (const t of ['vou parar pra almoçar e te respondo', 'quero sim', 'pode parar no portão', 'chega amanhã', 'oi', '']) {
        assert.equal(R.ehOptOut(t), false, t);
    }
});

test('extrairStatuses: lê sent/delivered/read/failed do webhook da Meta', () => {
    const body = { entry: [{ changes: [{ value: { statuses: [
        { id: 'wamid.A', status: 'delivered', timestamp: '1792850400' },
        { id: 'wamid.B', status: 'failed', timestamp: '1792850400', errors: [{ code: 131026, title: 'Message undeliverable' }] },
        { id: 'wamid.C', status: 'deleted' },
    ] } }] }] };
    const s = R.extrairStatuses(body);
    assert.equal(s.length, 2);
    assert.deepEqual(s[0], { wamid: 'wamid.A', status: 'entregue', erro: null, em: new Date(1792850400000).toISOString() });
    assert.equal(s[1].status, 'falhou');
    assert.equal(s[1].erro, '131026 Message undeliverable');
    assert.deepEqual(R.extrairStatuses({}), []);
});

test('extrairAlertaQualidade: só DOWNGRADE/FLAGGED', () => {
    const mk = (event) => ({ entry: [{ changes: [{ field: 'phone_number_quality_update', value: { event, current_limit: 'TIER_1K' } }] }] });
    assert.deepEqual(R.extrairAlertaQualidade(mk('DOWNGRADE')), { evento: 'DOWNGRADE', limite: 'TIER_1K' });
    assert.equal(R.extrairAlertaQualidade(mk('FLAGGED')).evento, 'FLAGGED');
    assert.equal(R.extrairAlertaQualidade(mk('UPGRADE')), null);
    assert.equal(R.extrairAlertaQualidade({}), null);
});

test('patchDeStatus: nunca rebaixa, cobra na entrega, respeita terminais', () => {
    const em = '2026-10-24T15:00:00.000Z';
    assert.deepEqual(R.patchDeStatus({ status: 'enviado', custo_cents: 0 }, { status: 'entregue', em }, 35),
        { status: 'entregue', entregue_at: em, custo_cents: 35 });
    // read chegou antes do delivered: marca lido E cobra
    assert.deepEqual(R.patchDeStatus({ status: 'enviado', custo_cents: 0 }, { status: 'lido', em }, 35),
        { status: 'lido', lido_at: em, entregue_at: em, custo_cents: 35 });
    // delivered atrasado depois do read: ignora
    assert.equal(R.patchDeStatus({ status: 'lido', entregue_at: em }, { status: 'entregue', em }, 35), null);
    // quem respondeu não volta pra "lido"
    assert.equal(R.patchDeStatus({ status: 'respondeu' }, { status: 'lido', em }, 35), null);
    // falha só derruba quem ainda não respondeu
    assert.equal(R.patchDeStatus({ status: 'enviado' }, { status: 'falhou', erro: 'x', em }).status, 'falhou');
    assert.equal(R.patchDeStatus({ status: 'respondeu' }, { status: 'falhou', erro: 'x', em }), null);
});

test('resumirFunil: funil acumulado + custo', () => {
    const f = R.resumirFunil([
        { status: 'pendente' }, { status: 'enviado' }, { status: 'entregue', entregue_at: 'x', custo_cents: 35 },
        { status: 'lido', entregue_at: 'x', lido_at: 'x', custo_cents: 35 },
        { status: 'respondeu', entregue_at: 'x', lido_at: 'x', respondeu_at: 'x', custo_cents: 35 },
        { status: 'convertido', entregue_at: 'x', lido_at: 'x', respondeu_at: 'x', custo_cents: 35 },
        { status: 'optout', entregue_at: 'x', custo_cents: 35 }, { status: 'falhou' }, { status: 'ignorado' },
    ]);
    assert.deepEqual(f, { total: 9, pendentes: 1, enviados: 6, entregues: 5, lidos: 3, responderam: 2, convertidos: 1,
        optout: 1, falhas: 1, ignorados: 1, custo_cents: 175 });
});

test('motivoAutoPausa: precisa de amostra mínima; dispara em falha ou opt-out alto', () => {
    assert.equal(R.motivoAutoPausa({ enviados: 10, falhas: 10, optout: 0 }), null); // amostra pequena
    assert.match(R.motivoAutoPausa({ enviados: 60, falhas: 40, optout: 0 }), /falha/);
    assert.match(R.motivoAutoPausa({ enviados: 100, falhas: 0, optout: 8 }), /opt-out/);
    assert.equal(R.motivoAutoPausa({ enviados: 100, falhas: 5, optout: 2 }), null);
});

test('leadCasaFiltro: lotes + campo importado', () => {
    const lead = { base_lote: 'inativos', dados_cliente: { plano: 'Ouro' } };
    assert.equal(R.leadCasaFiltro(lead, {}), true);
    assert.equal(R.leadCasaFiltro(lead, { lotes: ['inativos'] }), true);
    assert.equal(R.leadCasaFiltro(lead, { lotes: ['outro'] }), false);
    assert.equal(R.leadCasaFiltro(lead, { campo: 'dados.plano', operador: 'igual', valor: 'ouro' }), true);
    assert.equal(R.leadCasaFiltro(lead, { campo: 'dados.plano', operador: 'contem', valor: 'pra' }), false);
});

test('validarCampanha: campos obrigatórios e limites', () => {
    const ok = { nome: 'Volta', instance_id: 'i', templates: [{ nome: 't1', variaveis: [] }] };
    assert.equal(R.validarCampanha(ok), null);
    assert.match(R.validarCampanha({ ...ok, nome: '' }), /nome/);
    assert.match(R.validarCampanha({ ...ok, templates: [] }), /1 a 3/);
    assert.match(R.validarCampanha({ ...ok, janela_inicio: 20, janela_fim: 8 }), /janela/);
    assert.match(R.validarCampanha({ ...ok, objetivo: 'xpto' }), /objetivo/);
});

test('prepararImportacao: normaliza, deduplica, separa colunas livres', () => {
    const r = R.prepararImportacao([
        { telefone: '(11) 99999-8888', nome: ' Ana ', email: 'ANA@X.COM', produto: 'Ouro', vazio: '' },
        { telefone: '11999998888', nome: 'Ana dup' },
        { telefone: 'abc', nome: 'Inválido' },
        { telefone: '21988887777', empresa: 'Loja Y' },
    ]);
    assert.equal(r.validos.length, 2);
    assert.equal(r.duplicados, 1);
    assert.deepEqual(r.invalidos, [3]);
    assert.deepEqual(r.validos[0], { whatsapp_id: '5511999998888@s.whatsapp.net', phone: '5511999998888', nome: 'Ana', email: 'ana@x.com', dados: { produto: 'Ouro' } });
    assert.deepEqual(r.validos[1].dados, { empresa: 'Loja Y' });
});
