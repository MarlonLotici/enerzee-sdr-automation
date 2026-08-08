'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPOS_INSTANCE_PATCHAVEIS_TEXTO, emailBriefValido } = require('../lib/validadores');

const { owner_phone, email_from_address, email_website_url, email_prompt, agent_name, company_name } = CAMPOS_INSTANCE_PATCHAVEIS_TEXTO;

test('agent_name: aceita 1-60 chars, rejeita vazio/longo', () => {
    assert.ok(agent_name('Sofia'));
    assert.ok(agent_name('x'.repeat(60)));
    assert.ok(!agent_name(''));                 // vazio é tratado como "limpar" antes do validador; aqui garante que não passa como valor
    assert.ok(!agent_name('x'.repeat(61)));
});

test('company_name: aceita 1-80 chars, rejeita vazio/longo', () => {
    assert.ok(company_name('Antix'));
    assert.ok(company_name('x'.repeat(80)));
    assert.ok(!company_name(''));
    assert.ok(!company_name('x'.repeat(81)));
});

test('owner_phone: aceita 10-13 dígitos, com ou sem máscara', () => {
    assert.ok(owner_phone('5548998203038'));       // 13 (55+DDD+9dig)
    assert.ok(owner_phone('4898203038'));          // 10
    assert.ok(owner_phone('(48) 99820-3038'));     // máscara → 11 dígitos
});

test('owner_phone: rejeita curto/longo demais', () => {
    assert.ok(!owner_phone('123'));
    assert.ok(!owner_phone('123456789012345'));
    assert.ok(!owner_phone('abc'));
});

test('email_from_address: valida formato e comprimento', () => {
    assert.ok(email_from_address('contato@dominio.com'));
    assert.ok(!email_from_address('nao-e-email'));
    assert.ok(!email_from_address('a@b'));            // sem TLD
    assert.ok(!email_from_address('x'.repeat(255) + '@d.com')); // > 254
});

test('email_website_url e email_prompt: só trava de tamanho', () => {
    assert.ok(email_website_url('https://exemplo.com'));
    assert.ok(!email_website_url('x'.repeat(501)));
    assert.ok(email_prompt('oferta qualquer'));
    assert.ok(!email_prompt('x'.repeat(4001)));
});

test('emailBriefValido: aceita objeto plano, rejeita array/null/grande', () => {
    assert.ok(emailBriefValido({ vende: 'solar', dor: 'conta alta', tom: 'amigável' }));
    assert.ok(!emailBriefValido(['a', 'b']));
    assert.ok(!emailBriefValido(null));
    assert.ok(!emailBriefValido('string'));
    assert.ok(!emailBriefValido({ x: 'y'.repeat(7000) })); // > 6000 chars serializado
});
