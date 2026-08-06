'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { empresaConfiavelDoLead } = require('../lib/textPuros');

test('nome do WhatsApp (pessoa) SEM sinal de empresa → null (não presumir empresa)', () => {
    assert.equal(empresaConfiavelDoLead({ name: 'Matheus Flaris' }), null);
    assert.equal(empresaConfiavelDoLead({ name: 'João' }), null);
});

test('lead com sinal real de empresa → devolve o nome', () => {
    assert.equal(empresaConfiavelDoLead({ name: 'Padaria do João', niche: 'padaria' }), 'Padaria do João');
    assert.equal(empresaConfiavelDoLead({ name: 'Matheus Flaris', cnpj: '12345678000199' }), 'Matheus Flaris'); // CNPJ manda
    assert.equal(empresaConfiavelDoLead({ name: 'Auto Center X', capital_social_numeric: 50000 }), 'Auto Center X');
    assert.equal(empresaConfiavelDoLead({ name: 'Loja Y', origin: 'scraper' }), 'Loja Y');
});

test('nome composto que não é de pessoa (ex: "Padaria Central") → tratado como empresa', () => {
    assert.equal(empresaConfiavelDoLead({ name: 'Padaria Central' }), 'Padaria Central');
});

test('contatos genéricos do sistema → null', () => {
    assert.equal(empresaConfiavelDoLead({ name: 'Contato Orgânico' }), null);
    assert.equal(empresaConfiavelDoLead({ name: 'Cliente' }), null);
});

test('entradas vazias/invalidas → null', () => {
    assert.equal(empresaConfiavelDoLead({ name: '' }), null);
    assert.equal(empresaConfiavelDoLead({}), null);
    assert.equal(empresaConfiavelDoLead(null), null);
});
