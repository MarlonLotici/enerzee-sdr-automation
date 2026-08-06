'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairNomeHumano, saudacaoPrimeiroNome, extrairNomeDeclarado } = require('../lib/textPuros');

test('extrairNomeHumano: aceita nome de pessoa e capitaliza', () => {
    assert.equal(extrairNomeHumano('joão'), 'João');
    assert.equal(extrairNomeHumano('Maria Silva'), 'Maria');
    assert.equal(extrairNomeHumano('CARLOS'), 'Carlos');
});

test('extrairNomeHumano: rejeita empresa/setor/sigla/lixo', () => {
    assert.equal(extrairNomeHumano('Padaria São José Ltda'), null); // primeira palavra "padaria" na blacklist
    assert.equal(extrairNomeHumano('Supermercado Opção'), null);
    assert.equal(extrairNomeHumano('JJ'), null);   // sem vogal
    assert.equal(extrairNomeHumano('Distribuidora'), null);
    assert.equal(extrairNomeHumano(''), null);
    assert.equal(extrairNomeHumano(null), null);
    assert.equal(extrairNomeHumano('🔥'), null);   // só emoji → vazio após limpeza
});

test('saudacaoPrimeiroNome: nome humano vira saudação, resto cai no fallback', () => {
    assert.equal(saudacaoPrimeiroNome('João'), 'João');
    assert.equal(saudacaoPrimeiroNome('Padaria Ltda'), '');
    assert.equal(saudacaoPrimeiroNome('Padaria Ltda', 'Opa'), 'Opa');
});

test('extrairNomeDeclarado: pega nome que o lead fala no chat', () => {
    assert.equal(extrairNomeDeclarado('oi, meu nome é Carlos'), 'Carlos');
    assert.equal(extrairNomeDeclarado('aqui é o João falando'), 'João');
    assert.equal(extrairNomeDeclarado('sou a Ana, tudo bem?'), 'Ana');
    assert.equal(extrairNomeDeclarado('me chamo Roberto'), 'Roberto');
    assert.equal(extrairNomeDeclarado('pode me chamar de Bia'), 'Bia');
    assert.equal(extrairNomeDeclarado('aqui é o Pedro'), 'Pedro');
});

test('extrairNomeDeclarado: rejeita quando o "nome" é empresa ou não há nome', () => {
    assert.equal(extrairNomeDeclarado('aqui é a Padaria São José'), null);
    assert.equal(extrairNomeDeclarado('sou o supermercado opção'), null);
    assert.equal(extrairNomeDeclarado('quanto custa?'), null);
    assert.equal(extrairNomeDeclarado('bom dia'), null);
    assert.equal(extrairNomeDeclarado(''), null);
    assert.equal(extrairNomeDeclarado(null), null);
});
