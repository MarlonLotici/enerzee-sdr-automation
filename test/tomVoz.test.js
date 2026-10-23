'use strict';
// Tom de voz adaptativo dos áudios TTS (lib/tomVoz.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectarTomVoz, configVozParaTom, aplicarTagEmocao, TONS } = require('../lib/tomVoz');

test('lead descontraído (risada/gíria) → descontraido', () => {
    assert.equal(detectarTomVoz({ textoLead: 'kkkk opa, blz?' }), 'descontraido');
    assert.equal(detectarTomVoz({ textoLead: 'hahaha show mano' }), 'descontraido');
    assert.equal(detectarTomVoz({ textoLead: 'massa 😂' }), 'descontraido');
});

test('lead formal → serio', () => {
    assert.equal(detectarTomVoz({ textoLead: 'Prezados, gostaria de entender as cláusulas do contrato.' }), 'serio');
    assert.equal(detectarTomVoz({ textoLead: 'Por gentileza, qual a garantia?' }), 'serio');
});

test('lead tenso/desconfiado → empatico (vence clima animado)', () => {
    assert.equal(detectarTomVoz({ textoLead: 'isso é golpe?' }), 'empatico');
    assert.equal(detectarTomVoz({ textoLead: 'não confio nisso', clima: 'ANIMADO' }), 'empatico');
    assert.equal(detectarTomVoz({ textoLead: 'ok', clima: 'DESCONFIADO' }), 'empatico');
});

test('lead com pressa → direto', () => {
    assert.equal(detectarTomVoz({ textoLead: 'to ocupado, resume aí' }), 'direto');
    assert.equal(detectarTomVoz({ textoLead: 'ok', clima: 'OCUPADO' }), 'direto');
});

test('lead empolgado → entusiasmado', () => {
    assert.equal(detectarTomVoz({ textoLead: 'perfeito, quero sim!!' }), 'entusiasmado');
});

test('sem sinal → neutro; clima livre ainda é aproveitado', () => {
    assert.equal(detectarTomVoz({ textoLead: 'ok' }), 'neutro');
    assert.equal(detectarTomVoz({}), 'neutro');
    assert.equal(detectarTomVoz({ textoLead: 'certo', clima: 'NEUTRO' }), 'neutro');
    assert.equal(detectarTomVoz({ textoLead: 'certo', clima: 'INTERESSADO' }), 'entusiasmado');
});

test('falso-positivos comuns não viram empático', () => {
    assert.equal(detectarTomVoz({ textoLead: 'sem problema, pode mandar' }), 'neutro');
    assert.equal(detectarTomVoz({ textoLead: 'pode ser para de manhã' }), 'neutro');
});

test('voice_settings: todo tom tem preset válido', () => {
    for (const tom of TONS) {
        const v = configVozParaTom(tom, 'eleven_multilingual_v2');
        assert.ok(v.stability >= 0 && v.stability <= 1);
        assert.ok(v.speed >= 0.7 && v.speed <= 1.2);
    }
    assert.ok(configVozParaTom('serio').stability > configVozParaTom('descontraido').stability);
    assert.deepEqual(configVozParaTom('inexistente'), configVozParaTom('neutro'));
});

test('eleven_v3: stability discreta + audio tag; outros modelos sem tag', () => {
    for (const tom of TONS) assert.ok([0, 0.5, 1].includes(configVozParaTom(tom, 'eleven_v3').stability));
    assert.equal(aplicarTagEmocao('Oi!', 'descontraido', 'eleven_v3'), '[cheerfully] Oi!');
    assert.equal(aplicarTagEmocao('Oi!', 'descontraido', 'eleven_multilingual_v2'), 'Oi!');
    assert.equal(aplicarTagEmocao('Oi!', 'neutro', 'eleven_v3'), 'Oi!');
});
