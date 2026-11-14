'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairEmails, emailValido, ultimoEmailDaRajada, aguardandoCorrecao } = require('../lib/emailContato');
const { precisaReprocessar } = require('../lib/reprocesso');

const A = (content) => ({ role: 'assistant', content });
const U = (content) => ({ role: 'user', content });

// Rajada real de 2026-11-14 (Haislann), em 14 segundos.
const ate = [A('Fechado, seg às 10h30! ✅ Só me confirma seu melhor e-mail pra eu te enviar o convite da reunião 🙌')];

test('caso real: o e-mail errado, o "Ops" e o e-mail certo — o último e-mail da rajada vence', () => {
    const h = [...ate, U('Haislanm@reinoeducacao.com'), U('Ops'), U('Haislann@reinoeducacao.com')];
    assert.equal(ultimoEmailDaRajada(h, 'Haislann@reinoeducacao.com'), 'haislann@reinoeducacao.com');
});

test('caso real: quando o job começa com "e-mail errado + Ops", o e-mail NÃO é usado e a correção é aguardada', () => {
    const h = [...ate, U('Haislanm@reinoeducacao.com'), U('Ops')];
    assert.equal(aguardandoCorrecao('Ops', h), true);
    assert.equal(ultimoEmailDaRajada(h, 'Ops'), 'haislanm@reinoeducacao.com'); // existe, mas o chamador não efetiva
});

test('"Ops" sem e-mail antes não é correção de e-mail', () => {
    assert.equal(aguardandoCorrecao('Ops', [...ate, U('Ops')]), false);
    assert.equal(aguardandoCorrecao('ok, pode ser', [...ate, U('joao@x.com'), U('ok, pode ser')]), false);
});

test('mensagem com e-mail novo nunca é "aguardando correção"', () => {
    assert.equal(aguardandoCorrecao('Ops, é haislann@reinoeducacao.com', [...ate, U('Ops, é haislann@reinoeducacao.com')]), false);
});

test('e-mail no meio de frase, com pontuação e maiúsculas', () => {
    assert.equal(extrairEmails('meu email é Joao.Silva@Empresa.com.br, valeu!')[0], 'joao.silva@empresa.com.br');
    assert.equal(extrairEmails('é marlon@antix.com.')[0], 'marlon@antix.com');
    assert.deepEqual(extrairEmails('sem email aqui'), []);
});

test('validação do e-mail', () => {
    assert.equal(emailValido('a@b.com'), true);
    assert.equal(emailValido('a@b'), false);
    assert.equal(emailValido('a@@b.com'), false);
    assert.equal(emailValido('a@b..com'), false);
});

test('sem histórico usa a última mensagem', () => {
    assert.equal(ultimoEmailDaRajada([], 'oi, é teste@x.com'), 'teste@x.com');
});

test('reprocesso: mensagem do lead que chegou durante o job precisa de job novo', () => {
    const inicio = Date.parse('2026-11-14T02:15:30Z');
    assert.equal(precisaReprocessar({ role: 'user', created_at: '2026-11-14T02:15:36Z' }, inicio), true);   // chegou durante
    assert.equal(precisaReprocessar({ role: 'user', created_at: '2026-11-14T02:15:22Z' }, inicio), false);  // era a que o job respondeu
    assert.equal(precisaReprocessar({ role: 'assistant', created_at: '2026-11-14T02:15:40Z' }, inicio), false); // IA já respondeu
    assert.equal(precisaReprocessar(null, inicio), false);
    assert.equal(precisaReprocessar({ role: 'user' }, inicio), false);
});
