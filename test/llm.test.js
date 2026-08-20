'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Env dummy pra o require do adaptador não estourar ao instanciar o client Together.
process.env.TOGETHER_API_KEY = process.env.TOGETHER_API_KEY || 'together-dummy';
const { normalizarMensagens, extrairTexto, MODELOS, _tipoBudget, _limiteBudget, _reasoningEffortPara } = require('../lib/llm');
const { definirTenantLLM, tenantLLMAtual } = require('../lib/llmContext');

test('normalizarMensagens: vazio vira 1 turno user', () => {
    assert.deepEqual(normalizarMensagens([]), [{ role: 'user', content: 'ok' }]);
    assert.deepEqual(normalizarMensagens(null), [{ role: 'user', content: 'ok' }]);
});

test('normalizarMensagens: se começa em assistant, prefixa um user', () => {
    const out = normalizarMensagens([{ role: 'assistant', content: 'oi' }, { role: 'user', content: 'quanto?' }]);
    assert.equal(out[0].role, 'user');
    assert.equal(out[1].role, 'assistant');
    assert.equal(out[2].content, 'quanto?');
});

test('normalizarMensagens: funde consecutivos do mesmo role e tira vazios', () => {
    const out = normalizarMensagens([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: '  ' },   // vazio → descartado
        { role: 'system', content: 'x' },        // role inválido → descartado
        { role: 'assistant', content: 'c' },
    ]);
    assert.deepEqual(out, [
        { role: 'user', content: 'a\nb' },
        { role: 'assistant', content: 'c' },
    ]);
});

test('extrairTexto: lê choices[0].message.content (formato OpenAI), sempre string, nunca lança', () => {
    assert.equal(extrairTexto({ choices: [{ message: { content: ' oi ' } }] }), 'oi');
    assert.equal(extrairTexto({ choices: [] }), '');            // sem choices → ''
    assert.equal(extrairTexto({ choices: [{ message: {} }] }), ''); // message sem content → ''
    assert.equal(extrairTexto(null), '');
    assert.equal(extrairTexto({}), '');
});

test('extrairTexto: corta tokens de controle harmony do gpt-oss (<|...|>)', () => {
    const vazado = 'Entendi, sem problema. Você poderia me dizer o produto?<|end|><|start|>assistant<|channel|>analysis<|message|>the user...';
    assert.equal(extrairTexto({ choices: [{ message: { content: vazado } }] }), 'Entendi, sem problema. Você poderia me dizer o produto?');
    // sem vazamento, texto normal passa intacto
    assert.equal(extrairTexto({ choices: [{ message: { content: 'resposta normal' } }] }), 'resposta normal');
});

test('MODELOS: mapa central tem os 3 papéis', () => {
    assert.ok(MODELOS.rapido && MODELOS.cerebro && MODELOS.visao);
});

test('_tipoBudget: mapeia cada modelo pro tipo de budget certo, custom vira null', () => {
    assert.equal(_tipoBudget(MODELOS.cerebro), 'llm_cerebro');
    assert.equal(_tipoBudget(MODELOS.rapido),  'llm_rapido');
    assert.equal(_tipoBudget(MODELOS.visao),   'llm_visao');
    assert.equal(_tipoBudget('modelo-desconhecido'), null);
});

test('_limiteBudget: usa env quando válido, senão o default alto de segurança', () => {
    delete process.env.BUDGET_LLM_CEREBRO_DIA;
    assert.equal(_limiteBudget('llm_cerebro'), 5000);   // default
    process.env.BUDGET_LLM_CEREBRO_DIA = '123';
    assert.equal(_limiteBudget('llm_cerebro'), 123);    // env vence
    process.env.BUDGET_LLM_CEREBRO_DIA = '0';           // 0/inválido → cai no default
    assert.equal(_limiteBudget('llm_cerebro'), 5000);
    delete process.env.BUDGET_LLM_CEREBRO_DIA;
});

test('_reasoningEffortPara: só o gpt-oss recebe reasoning_effort (default low)', () => {
    delete process.env.LLM_REASONING_EFFORT;
    assert.equal(_reasoningEffortPara('openai/gpt-oss-120b'), 'low');
    assert.equal(_reasoningEffortPara('deepseek-ai/DeepSeek-V4-Flash-0731'), undefined);
    assert.equal(_reasoningEffortPara('Qwen/Qwen3.5-9B'), undefined);
    process.env.LLM_REASONING_EFFORT = 'medium';
    assert.equal(_reasoningEffortPara('openai/gpt-oss-120b'), 'medium'); // env sobrescreve
    delete process.env.LLM_REASONING_EFFORT;
});

test('llmContext: definir/ler tenant do fluxo atual', () => {
    assert.equal(tenantLLMAtual(), null);               // sem contexto
    definirTenantLLM('user-abc');
    assert.deepEqual(tenantLLMAtual(), { userId: 'user-abc' });
    definirTenantLLM(null);                              // no-op não apaga contexto válido
    assert.deepEqual(tenantLLMAtual(), { userId: 'user-abc' });
});
