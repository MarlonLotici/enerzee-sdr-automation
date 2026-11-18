'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/prospeccao');
const B = require('../lib/briefing');
const D = require('../lib/discordTenant');

test('telefone BR: celular, fixo e inválido', () => {
    assert.deepEqual(P.normalizarTelefoneBR('(48) 99999-8888'), { digitos: '5548999998888', celular: true });
    assert.deepEqual(P.normalizarTelefoneBR('+55 48 3333-4444'), { digitos: '554833334444', celular: false });
    assert.equal(P.normalizarTelefoneBR('123'), null);
});

test('link do WhatsApp leva a mensagem pronta', () => {
    assert.equal(P.linkWhatsApp('5548999998888', 'Oi, tudo bem?'), 'https://wa.me/5548999998888?text=Oi%2C%20tudo%20bem%3F');
});

test('handle do Instagram ignora post/reel e pega perfil', () => {
    assert.equal(P.handleInstagram('https://www.instagram.com/gestor.solar/'), 'gestor.solar');
    assert.equal(P.handleInstagram('https://www.instagram.com/p/ABC123/'), null);
    assert.equal(P.handleInstagram('https://www.instagram.com/reel/XYZ/'), null);
});

test('places: só integradora solar com telefone; celular primeiro', () => {
    const places = [
        { title: 'Padaria do Zé', category: 'Padaria', phoneNumber: '(48) 99999-0000' },
        { title: 'Sol Forte Energia Solar', category: 'Empresa de energia solar', phoneNumber: '(48) 3333-4444', rating: 4.9, ratingCount: 80 },
        { title: 'Luz Energia Fotovoltaica', category: 'Fornecedor', phoneNumber: '(48) 98888-7777', rating: 4.5, ratingCount: 12 },
        { title: 'Solar Sem Telefone', category: 'Energia solar' },
    ];
    const r = P.priorizarIntegradores(P.integradoresDePlaces(places, 'Florianópolis SC'));
    assert.deepEqual(r.map(x => x.nome), ['Luz Energia Fotovoltaica', 'Sol Forte Energia Solar']);
    assert.equal(r[0].celular, true);
});

test('gestores: perfis únicos do Instagram', () => {
    const g = P.gestoresDeBusca([
        { link: 'https://www.instagram.com/ana.trafego/', title: 'Ana Tráfego (@ana.trafego) • Instagram', snippet: 'Gestora de tráfego para energia solar' },
        { link: 'https://www.instagram.com/ana.trafego/', title: 'dup' },
        { link: 'https://www.instagram.com/p/xyz/', title: 'post' },
    ]);
    assert.equal(g.length, 1);
    assert.equal(g[0].instagram, 'ana.trafego');
    assert.equal(g[0].nome, 'Ana Tráfego');
});

test('cidades do dia rotacionam e não repetem no mesmo dia', () => {
    const a = P.cidadesDoDia('2026-11-18', 4), b = P.cidadesDoDia('2026-11-19', 4);
    assert.equal(new Set(a).size, 4);
    assert.notDeepEqual(a, b);
});

test('mensagem padrão: sem abreviação, cita nome e nota', () => {
    const m = P.mensagemPadrao({ tipo: 'integrador', nome: 'Sol Forte', cidade: 'Florianópolis SC', nota: 4.9, avaliacoes: 80 });
    assert.match(m, /Sol Forte em Florianópolis \(nota 4,9 no Google/);
    assert.doesNotMatch(m, /\b(vc|tb|min)\b/);
    assert.match(P.mensagemPadrao({ tipo: 'gestor', nome: 'Ana' }), /30% recorrente/);
});

test('JSON do LLM com texto em volta', () => {
    assert.deepEqual(P.lerJsonMensagens('ok aqui: {"tel:1":"Oi"} fim'), { 'tel:1': 'Oi' });
    assert.deepEqual(P.lerJsonMensagens('nada'), {});
});

test('rodarProspeccao: dedupe, mensagens e Discord sem enviar nada ao prospect', async () => {
    const vistos = new Set(['tel:5548988887777']);
    const enviados = [];
    const r = await P.rodarProspeccao({
        dataISO: '2026-11-18', qtdIntegradores: 2, qtdGestores: 1, log: () => {},
        serper: async (endpoint) => endpoint === 'places'
            ? { places: [
                { title: 'A Solar', category: 'energia solar', phoneNumber: '(48) 98888-7777' },
                { title: 'B Solar', category: 'energia solar', phoneNumber: '(48) 97777-6666' },
                { title: 'C Solar', category: 'energia solar', phoneNumber: '(48) 96666-5555' }] }
            : { organic: [{ link: 'https://instagram.com/gestor.x/', title: 'Gestor X (@gestor.x)' }] },
        gerarMensagens: async () => '{"tel:5548977776666":"Oi, tudo bem? Aqui é o Marlon, da Antix. Mensagem personalizada para a B Solar, posso mandar um áudio?"}',
        marcarNovo: async (k) => { if (vistos.has(k)) return false; vistos.add(k); return true; },
        enviarDiscord: async (p) => enviados.push(p),
    });
    assert.deepEqual(r, { integradores: 2, gestores: 1 });
    const cards = enviados.flatMap(p => p.embeds || []);
    assert.equal(cards.length, 3);
    assert.doesNotMatch(JSON.stringify(cards), /A Solar/); // já tinha sido enviado antes
    assert.match(cards[0].description, /personalizada para a B Solar/);
    assert.match(cards[0].url, /^https:\/\/wa\.me\/5548977776666\?text=/);
    assert.match(cards[2].url, /^https:\/\/ig\.me\/m\/gestor\.x$/);
});

test('briefing: transcrição sem marcadores internos e prompts sem invenção', () => {
    const t = B.transcricao([{ role: 'user', content: 'Oi' }, { role: 'assistant', content: '[AUDIO_TTS] Olá [ESTAGIO:1]' }]);
    assert.equal(t, 'LEAD: Oi\nIA: Olá');
    assert.match(B.promptBriefing({ historico: [], nomeLead: 'Ana', empresaCliente: 'Foz' }), /não invente nada/);
    assert.match(B.promptProposta({ historico: [] }), /R\$597/);
});

test('proposta só entre 45 min e 6 h depois do início da reunião', () => {
    const ini = Date.parse('2026-11-16T13:30:00Z');
    assert.equal(B.reuniaoTerminouAgora('2026-11-16T13:30:00Z', ini + 30 * 60e3), false);
    assert.equal(B.reuniaoTerminouAgora('2026-11-16T13:30:00Z', ini + 60 * 60e3), true);
    assert.equal(B.reuniaoTerminouAgora('2026-11-16T13:30:00Z', ini + 7 * 3600e3), false);
});

test('Discord por cliente: mapa do Railway > coluna > Antix', () => {
    assert.deepEqual(D.escolherWebhook({ userId: 'foz', mapaEnv: { foz: 'https://foz' }, global: 'https://antix' }), { url: 'https://foz', proprio: true });
    assert.deepEqual(D.escolherWebhook({ userId: 'foz', colunaPerfil: 'https://col', global: 'https://antix' }), { url: 'https://col', proprio: true });
    assert.deepEqual(D.escolherWebhook({ userId: 'foz', global: 'https://antix' }), { url: 'https://antix', proprio: false });
    assert.deepEqual(D.escolherWebhook({ userId: D.ANTIX_USER_ID, global: 'https://antix' }), { url: 'https://antix', proprio: true });
});

test('busca falhando (ex.: sem créditos) vira erro, não "nenhum contato novo"', async () => {
    const enviados = [];
    await assert.rejects(P.rodarProspeccao({
        dataISO: '2026-11-18', log: () => {},
        serper: async () => { throw new Error('Serper HTTP 400 Not enough credits'); },
        gerarMensagens: async () => '{}', marcarNovo: async () => true, enviarDiscord: async (p) => enviados.push(p),
    }), /credits/);
    assert.equal(enviados.length, 0);
});
