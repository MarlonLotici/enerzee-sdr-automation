'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dividirEmBaloes } = require('../lib/baloes');

test('respeita [QUEBRA] emitido pelo LLM', () => {
    const b = dividirEmBaloes('Oi, tudo bem?[QUEBRA]Como posso te ajudar?');
    assert.deepEqual(b, ['Oi, tudo bem?', 'Como posso te ajudar?']);
});

test('quebra texto longo de várias frases em vários balões, sem cortar frase', () => {
    const texto = 'Que bom que você chamou aqui. A Antix cria agentes de IA que assumem o comercial repetitivo. Isso significa lead respondido na hora, sem depender de equipe. Faz sentido pro seu momento hoje?';
    const b = dividirEmBaloes(texto);
    assert.ok(b.length >= 2 && b.length <= 6, `esperava 2-6 balões, veio ${b.length}`);
    for (const balao of b) assert.match(balao, /[.!?…]$/); // nenhuma frase cortada no meio
    assert.equal(b.join(' '), texto);                       // conteúdo íntegro
});

test('nunca corta dentro de uma URL e tira "?" colado após o link', () => {
    const b = dividirEmBaloes('Bora marcar? Escolhe um horário aqui: https://calendly.com/antix/15min?');
    const comLink = b.find((x) => x.includes('calendly.com'));
    assert.ok(comLink, 'deveria ter um balão com o link');
    assert.ok(comLink.includes('https://calendly.com/antix/15min'), 'URL inteira preservada');
    assert.ok(!/15min\?/.test(comLink), 'não pode ter "?" colado após o link');
});

test('respeita o teto de balões fundindo (nunca cortando frase)', () => {
    const texto = 'Um. Dois. Três. Quatro. Cinco. Seis. Sete. Oito.';
    const b = dividirEmBaloes(texto, { max: 3, minChars: 0, maxChars: 1 });
    assert.ok(b.length <= 3, `esperava <=3, veio ${b.length}`);
    assert.equal(b.join(' '), texto);
});

test('frase única curta vira 1 balão só', () => {
    assert.deepEqual(dividirEmBaloes('Opa, tudo certo?'), ['Opa, tudo certo?']);
});

test('REVEAL Antix: link NÃO é movido pro fim quando há mensagem substancial depois', () => {
    const texto = 'Fechado! Escolhe o horário aqui: https://calendly.com/antix/15min[QUEBRA]Ah, e antes que eu esqueça: essa conversa toda foi conduzida por uma IA da Antix. Até a reunião!';
    const b = dividirEmBaloes(texto);
    const idxLink = b.findIndex((x) => x.includes('calendly.com'));
    assert.ok(idxLink !== -1);
    assert.ok(idxLink < b.length - 1, 'o link deve continuar ANTES do reveal, não movido pro fim');
    assert.match(b[b.length - 1], /IA da Antix/);
});

test('link fecha a mensagem quando só sobra coisa trivial depois', () => {
    const b = dividirEmBaloes('Perfeito, marca aqui pra gente conversar: https://calendly.com/antix/15min 🙌');
    assert.ok(b[b.length - 1].includes('calendly.com'), 'link deve fechar a mensagem');
});

test('entradas inválidas não quebram', () => {
    assert.deepEqual(dividirEmBaloes(''), []);
    assert.deepEqual(dividirEmBaloes(null), []);
    assert.deepEqual(dividirEmBaloes(undefined), []);
});
