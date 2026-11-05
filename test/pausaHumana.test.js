'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { avaliarPausa, houveAtendenteHumano, montarSecaoRetomadaHumana, PAUSA_HUMANA_MIN } = require('../lib/pausaHumana');

const AGORA = Date.parse('2026-11-05T20:00:00Z');
const minAtras = (m) => new Date(AGORA - m * 60000).toISOString();

test('padrão é 15 minutos', () => assert.equal(PAUSA_HUMANA_MIN, 15));

test('lead não pausado: segue', () => {
    assert.equal(avaliarPausa({ is_paused: false }, AGORA).acao, 'seguir');
    assert.equal(avaliarPausa(null, AGORA).acao, 'seguir');
});

test('bug 2026-11-05: humano falou há 5 min → segura, com o tempo restante', () => {
    const r = avaliarPausa({ is_paused: true, last_human_interaction: minAtras(5) }, AGORA);
    assert.equal(r.acao, 'segurar');
    assert.equal(r.restanteMs, 10 * 60000);
});

test('humano falou há 20 min → acorda (janela de 15 min passou)', () => {
    assert.equal(avaliarPausa({ is_paused: true, last_human_interaction: minAtras(20) }, AGORA).acao, 'acordar');
});

test('exatamente no limite: acorda', () => {
    assert.equal(avaliarPausa({ is_paused: true, last_human_interaction: minAtras(15) }, AGORA).acao, 'acordar');
});

test('pausa manual explícita: silêncio, mesmo com a janela vencida', () => {
    assert.equal(avaliarPausa({ is_paused: true, manual_pause: true, last_human_interaction: minAtras(60) }, AGORA).acao, 'silencio');
    assert.equal(avaliarPausa({ is_paused: true, manual_pause: true }, AGORA).acao, 'silencio');
});

test('pausa por outro motivo (sem last_human_interaction) segue como antes', () => {
    assert.equal(avaliarPausa({ is_paused: true }, AGORA).acao, 'seguir');
    assert.equal(avaliarPausa({ is_paused: true, last_human_interaction: 'lixo' }, AGORA).acao, 'seguir');
});

test('concierge: agendado e pausado sem pausa manual responde sempre', () => {
    assert.equal(avaliarPausa({ is_paused: true, status: 'booked', last_human_interaction: minAtras(1) }, AGORA).acao, 'seguir');
});

test('houveAtendenteHumano / seção de retomada só quando um humano falou', () => {
    const h = [{ role: 'user', content: 'Boa tarde' }, { role: 'assistant', content: '[ATENDENTE_HUMANO]: Oi Andreia, Marlon aqui!' }];
    assert.equal(houveAtendenteHumano(h), true);
    assert.match(montarSecaoRetomadaHumana(h), /LEIA A CONVERSA INTEIRA/);
    assert.match(montarSecaoRetomadaHumana(h), /NÃO se reapresente/);
    assert.equal(houveAtendenteHumano([{ role: 'assistant', content: 'Oi!' }]), false);
    assert.equal(montarSecaoRetomadaHumana([{ role: 'assistant', content: 'Oi!' }]), '');
    assert.equal(montarSecaoRetomadaHumana([]), '');
});
