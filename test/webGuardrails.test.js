'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripWeb, enxugarWeb } = require('../lib/webGuardrails');

// ── stripWeb: remove tags internas + mata link falso/Calendly ──────────────────

test('stripWeb: remove tags internas de estágio/clima (não sobra colchete)', () => {
    const r = stripWeb('Oi! [ESTAGIO:2] [CLIMA:quente] tudo bem?');
    assert.ok(!/\[/.test(r), 'não pode sobrar tag');
    assert.match(r.replace(/\s+/g, ' '), /^Oi! tudo bem\?$/);
});

test('stripWeb: [QUEBRA] vira quebra de linha', () => {
    assert.equal(stripWeb('linha1[QUEBRA]linha2'), 'linha1\nlinha2');
});

test('stripWeb: MATA o link falso antix.com.br/agendar (a IA não tem link no web)', () => {
    const r = stripWeb('Marca aqui: https://antix.com.br/agendar?x=1 valeu');
    assert.ok(!/antix\.com\.br\/agendar/.test(r), 'link falso deveria sumir');
});

test('stripWeb: MATA link do Calendly', () => {
    const r = stripWeb('Segue: https://calendly.com/fulano/30min agora');
    assert.ok(!/calendly\.com/.test(r), 'calendly deveria sumir');
});

test('stripWeb: colapsa 3+ quebras em no máx 2 e faz trim', () => {
    assert.equal(stripWeb('a\n\n\n\nb   '), 'a\n\nb');
});

test('stripWeb: entrada vazia/nula não quebra', () => {
    assert.equal(stripWeb(null), '');
    assert.equal(stripWeb(undefined), '');
    assert.equal(stripWeb(''), '');
});

// ── enxugarWeb: anti-paredão (1 pergunta por vez / máx 2 frases) ────────────────

test('enxugarWeb: corta no 1º "?" (uma pergunta por vez)', () => {
    const wall = 'Entendi. Quantos leads por dia? E quanto você perde? Faz sentido?';
    assert.equal(enxugarWeb(wall), 'Entendi. Quantos leads por dia?');
});

test('enxugarWeb: NUNCA deixa mais de uma pergunta', () => {
    for (const s of [
        'Show! Você usa Instagram? E o WhatsApp?',
        'Legal. Qual seu segmento? Quantos clientes? Onde perde?',
        'Oi, tudo bem? Sou a Sofia da Antix, o que te trouxe aqui?',
    ]) {
        const out = enxugarWeb(s);
        const qs = (out.match(/\?/g) || []).length;
        assert.ok(qs <= 1, `"${out}" tem ${qs} perguntas`);
    }
});

test('enxugarWeb: sem pergunta, limita a 2 frases (não vira muro)', () => {
    const wall = 'Primeira frase. Segunda frase. Terceira frase. Quarta frase.';
    assert.equal(enxugarWeb(wall), 'Primeira frase. Segunda frase.');
});

test('enxugarWeb: resposta já curta com 1 pergunta passa intacta', () => {
    const ok = 'Prazer, Marina! Como você capta clientes hoje?';
    assert.equal(enxugarWeb(ok), ok);
});

test('enxugarWeb: 1-2 frases sem pergunta passam intactas', () => {
    assert.equal(enxugarWeb('Show, vou te mostrar como funciona.'), 'Show, vou te mostrar como funciona.');
    assert.equal(enxugarWeb('Frase um. Frase dois.'), 'Frase um. Frase dois.');
});

test('enxugarWeb: vazio/nulo não quebra', () => {
    assert.equal(enxugarWeb(null), '');
    assert.equal(enxugarWeb(''), '');
    assert.equal(enxugarWeb('   '), '');
});

// ── Contrato combinado (como roda em produção: enxugarWeb(stripWeb(x))) ─────────

test('pipeline web: tira link falso E enxuga pergunta única, juntos', () => {
    const bruto = 'Perfeito! [ESTAGIO:3] Marca em https://antix.com.br/agendar quando quiser. Qual período prefere? Manhã ou tarde?';
    const out = enxugarWeb(stripWeb(bruto));
    assert.ok(!/antix\.com\.br\/agendar/.test(out), 'não pode sobrar link falso');
    assert.ok((out.match(/\?/g) || []).length <= 1, 'no máx 1 pergunta');
});
