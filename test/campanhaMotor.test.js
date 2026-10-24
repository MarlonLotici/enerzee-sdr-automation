'use strict';
// Motor de campanhas de ponta a ponta contra um Supabase falso em memória + Meta falsa.
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarMotorCampanhas } = require('../lib/campanhaMotor');
const { criarFakeSupabase } = require('./helpers/fakeSupabase');

const USER = 'user-1';
const CHIP = 'chip-1';
const AGORA = new Date('2026-10-24T15:00:00Z'); // 12h BRT, dentro da janela 9-19

function cenario({ leads, campanha = {}, regras = { whatsapp_provider: 'official', cloud_api_key: 'tk', cloud_base_url: 'https://g/v20.0/1' }, mensagens = [] } = {}) {
    const sb = criarFakeSupabase({
        leads: leads || [
            { id: 'L1', user_id: USER, instance_id: CHIP, whatsapp_id: '5511999990001@s.whatsapp.net', dono: 'Ana Lima', status: 'base', base_lote: 'inativos', dados_cliente: { produto: 'Plano Ouro' } },
            { id: 'L2', user_id: USER, instance_id: CHIP, whatsapp_id: '5511999990002@s.whatsapp.net', dono: 'Bruno', status: 'base', base_lote: 'inativos', dados_cliente: { produto: 'Plano Prata' } },
            { id: 'L3', user_id: USER, instance_id: CHIP, whatsapp_id: '5511999990003@s.whatsapp.net', dono: 'Caio', status: 'base', base_lote: 'outro-lote', dados_cliente: {} },
            { id: 'L4', user_id: USER, instance_id: CHIP, whatsapp_id: '5511999990004@s.whatsapp.net', dono: 'Duda', status: 'base', base_lote: 'inativos', opt_out: true },
            { id: 'LX', user_id: 'outro-tenant', instance_id: CHIP, whatsapp_id: '5511999990009@s.whatsapp.net', dono: 'Zé', status: 'base', base_lote: 'inativos' },
        ],
        campanhas: [{
            id: 'C1', user_id: USER, instance_id: CHIP, nome: 'Volta', objetivo: 'reativacao', status: 'rascunho',
            filtro_segmento: { lotes: ['inativos'] }, janela_inicio: 9, janela_fim: 19, limite_diario: 100, frequencia_dias: 30,
            templates: [
                { nome: 'volta_1', idioma: 'pt_BR', texto: 'Oi {{1}}, sentimos falta! Seu {{2}} te espera.', variaveis: [{ campo: 'primeiro_nome' }, { campo: 'dados.produto' }] },
                { nome: 'volta_2', idioma: 'pt_BR', texto: 'Oi {{1}}, última chamada!', variaveis: [{ campo: 'primeiro_nome' }], esperaDias: 3 },
            ],
            ...campanha,
        }],
        messages: mensagens,
    });
    const enviados = [];
    const historico = [];
    let n = 0;
    const transport = {
        enviarTemplate: async (cfg, jid, nome, idioma, componentes) => {
            enviados.push({ cfg, jid, nome, idioma, componentes });
            return { id: `wamid.${++n}` };
        },
    };
    let relogio = AGORA;
    const motor = criarMotorCampanhas({
        supabase: sb, getRegras: async () => regras, transport,
        salvarMensagem: async (...a) => { historico.push(a); },
        agora: () => relogio, dormir: async () => {}, log: { log() {}, warn() {}, error() {} },
    });
    return { sb, motor, enviados, historico, avancar: (ms) => { relogio = new Date(relogio.getTime() + ms); } };
}

test('iniciarCampanha: público = lotes do filtro, sem opt-out e SÓ do próprio tenant', async () => {
    const { sb, motor } = cenario();
    const r = await motor.iniciarCampanha('C1', USER);
    assert.equal(r.adicionados, 2); // L1, L2 (L3 é outro lote, L4 opt-out, LX outro tenant)
    assert.deepEqual(sb._db.campanha_contatos.map(c => c.lead_id).sort(), ['L1', 'L2']);
    assert.equal(sb._db.campanhas[0].status, 'ativa');
});

test('iniciarCampanha: outro tenant não inicia campanha alheia', async () => {
    const { motor } = cenario();
    await assert.rejects(() => motor.iniciarCampanha('C1', 'intruso'), /não encontrada/);
});

test('iniciarCampanha: chip fora da API oficial é recusado', async () => {
    const { motor } = cenario({ regras: { whatsapp_provider: 'baileys' } });
    await assert.rejects(() => motor.iniciarCampanha('C1', USER), /API oficial/);
});

test('tick: envia o template com variáveis, grava wamid, histórico e agenda o passo 2', async () => {
    const { sb, motor, enviados, historico } = cenario();
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();

    assert.equal(enviados.length, 2);
    const paraAna = enviados.find(e => e.jid.includes('0001'));
    assert.equal(paraAna.nome, 'volta_1');
    assert.deepEqual(paraAna.componentes[0].parameters.map(p => p.text), ['Ana', 'Plano Ouro']);

    const cAna = sb._db.campanha_contatos.find(c => c.lead_id === 'L1');
    assert.equal(cAna.status, 'enviado');
    assert.equal(cAna.passo, 1);
    assert.ok(cAna.wamid.startsWith('wamid.'));
    assert.equal(cAna.proximo_envio_at, '2026-10-27T15:00:00.000Z'); // esperaDias 3 do passo 2

    assert.ok(historico.some(([jid, role, txt]) => jid.includes('0001') && role === 'assistant' && txt === 'Oi Ana, sentimos falta! Seu Plano Ouro te espera.'));
    assert.equal(sb._db.leads.find(l => l.id === 'L1').ultima_campanha_id, 'C1');
});

test('tick: rodar de novo NÃO reenvia o mesmo passo (idempotente)', async () => {
    const { motor, enviados } = cenario();
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    await motor.tick();
    await Promise.all([motor.tick(), motor.tick()]);
    assert.equal(enviados.length, 2);
});

test('tick: fora da janela de horário não envia', async () => {
    const { motor, enviados, avancar } = cenario();
    await motor.iniciarCampanha('C1', USER);
    avancar(9 * 3600 * 1000); // 21h BRT
    await motor.tick();
    assert.equal(enviados.length, 0);
});

test('tick: respeita o limite diário', async () => {
    const { motor, enviados } = cenario({ campanha: { limite_diario: 1 } });
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    await motor.tick();
    assert.equal(enviados.length, 1);
});

test('tick: lead em conversa ativa (falou < 24h) é adiado, não interrompido', async () => {
    const { sb, motor, enviados } = cenario({ mensagens: [
        { id: 'm1', whatsapp_id: '5511999990001@s.whatsapp.net', instance_id: CHIP, role: 'user', created_at: '2026-10-24T13:00:00Z' },
    ] });
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    assert.equal(enviados.length, 1); // só o Bruno
    const cAna = sb._db.campanha_contatos.find(c => c.lead_id === 'L1');
    assert.equal(cAna.status, 'pendente');
    assert.equal(cAna.proximo_envio_at, '2026-10-25T15:00:00.000Z');
});

test('ciclo de status: entregue → lido, custo na entrega, webhook atrasado não rebaixa', async () => {
    const { sb, motor } = cenario();
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    const wamid = sb._db.campanha_contatos.find(c => c.lead_id === 'L1').wamid;
    await motor.registrarStatuses([{ wamid, status: 'entregue', em: '2026-10-24T15:01:00Z' }]);
    await motor.registrarStatuses([{ wamid, status: 'lido', em: '2026-10-24T15:05:00Z' }]);
    await motor.registrarStatuses([{ wamid, status: 'entregue', em: '2026-10-24T15:06:00Z' }]); // atrasado
    const c = sb._db.campanha_contatos.find(x => x.lead_id === 'L1');
    assert.equal(c.status, 'lido');
    assert.equal(c.custo_cents, 35);
    assert.equal(await motor.registrarStatuses([{ wamid: 'wamid.desconhecido', status: 'lido', em: 'x' }]), 0);
});

test('resposta do lead encerra a cadência (não manda o passo 2)', async () => {
    const { sb, motor, enviados, avancar } = cenario();
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    assert.equal(await motor.registrarResposta('L1'), 1);
    avancar(4 * 24 * 3600 * 1000); // passou a espera do passo 2
    await motor.tick();
    const passo2 = enviados.filter(e => e.nome === 'volta_2');
    assert.deepEqual(passo2.map(e => e.jid.slice(-19, -15)), ['0002']); // só o Bruno recebe o passo 2
    assert.equal(sb._db.campanha_contatos.find(c => c.lead_id === 'L1').status, 'respondeu');
});

test('opt-out: marca o lead e nunca mais envia', async () => {
    const { sb, motor, enviados, avancar } = cenario();
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    await motor.registrarOptOut('L2');
    avancar(4 * 24 * 3600 * 1000);
    await motor.tick();
    assert.equal(enviados.filter(e => e.jid.includes('0002')).length, 1);
    assert.equal(sb._db.leads.find(l => l.id === 'L2').opt_out, true);
    assert.equal(sb._db.campanha_contatos.find(c => c.lead_id === 'L2').status, 'optout');
});

test('conversão + métricas do funil', async () => {
    const { motor } = cenario();
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    await motor.registrarResposta('L1');
    assert.equal(await motor.marcarConvertido('L1'), true);
    const f = await motor.metricas('C1');
    assert.equal(f.total, 2);
    assert.equal(f.enviados, 2);
    assert.equal(f.responderam, 1);
    assert.equal(f.convertidos, 1);
});

test('contextoDoLead: devolve a campanha recente do lead (pro prompt)', async () => {
    const { motor } = cenario({ campanha: { prompt_campanha: 'Ofereça 10% de desconto pra voltar.' } });
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    const ctx = await motor.contextoDoLead('L1');
    assert.equal(ctx.nome, 'Volta');
    assert.equal(ctx.prompt_campanha, 'Ofereça 10% de desconto pra voltar.');
    assert.equal(await motor.contextoDoLead('L3'), null);
});

test('variável sem valor e sem padrão → contato falha com motivo, os outros seguem', async () => {
    const { sb, motor, enviados } = cenario({ campanha: { filtro_segmento: {} } }); // inclui L3 (sem produto)
    await motor.iniciarCampanha('C1', USER);
    await motor.tick();
    const c3 = sb._db.campanha_contatos.find(c => c.lead_id === 'L3');
    assert.equal(c3.status, 'falhou');
    assert.match(c3.erro, /\{\{2\}\}/);
    assert.equal(enviados.length, 2);
});

test('erro transitório da Meta adia 30min; erro definitivo marca falhou', async () => {
    const { sb: sb2 } = cenario();
    let chamada = 0;
    // 1ª chamada: rate limit (transitório); 2ª: template inexistente (definitivo).
    const motor2 = criarMotorCampanhas({
        supabase: sb2, getRegras: async () => ({ whatsapp_provider: 'official' }),
        transport: { enviarTemplate: async () => { chamada++; throw new Error(chamada === 1 ? 'Cloud API 429: (#130429) Rate limit hit' : 'Cloud API 400: (#132001) Template name does not exist'); } },
        salvarMensagem: async () => {}, agora: () => AGORA, dormir: async () => {}, log: { log() {}, warn() {}, error() {} },
    });
    await motor2.iniciarCampanha('C1', USER);
    await motor2.tick();
    const [a, b] = sb2._db.campanha_contatos;
    const adiado = [a, b].find(c => c.status === 'pendente');
    const falho = [a, b].find(c => c.status === 'falhou');
    assert.equal(adiado.proximo_envio_at, '2026-10-24T15:30:00.000Z');
    assert.match(falho.erro, /132001/);
});

test('campanha termina sozinha quando ninguém tem próximo envio', async () => {
    const { sb, motor } = cenario({ campanha: { templates: [
        { nome: 'unico', texto: 'Oi {{1}}', variaveis: [{ campo: 'primeiro_nome' }] },
    ] } });
    await motor.iniciarCampanha('C1', USER);
    await motor.tick(); // envia
    await motor.tick(); // fila vazia, nada agendado → conclui
    assert.equal(sb._db.campanhas[0].status, 'concluida');
});

test('motor desliga sozinho se as tabelas não existem (SQL não rodado)', async () => {
    const quebrado = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "Could not find the table 'public.campanhas' in the schema cache" } }) }) }) };
    const avisos = [];
    const m = criarMotorCampanhas({ supabase: quebrado, getRegras: async () => null, transport: {}, salvarMensagem: async () => {},
        log: { log() {}, warn: (x) => avisos.push(x), error() {} } });
    await m.tick();
    await m.tick();
    assert.equal(avisos.length, 1);
    assert.equal(await m.contextoDoLead('L1'), null);
});
