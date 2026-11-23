'use strict';
// DeepSeek direto + reserva na Together + custo estimado. Os dois provedores são servidores HTTP falsos locais.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function servidorFalso(responder) {
    const pedidos = [];
    const srv = http.createServer((req, res) => {
        let corpo = '';
        req.on('data', d => { corpo += d; });
        req.on('end', () => {
            const json = corpo ? JSON.parse(corpo) : {};
            pedidos.push(json);
            const { status, body } = responder(json);
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        });
    });
    return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, pedidos, url: `http://127.0.0.1:${srv.address().port}` })));
}
const respostaOk = (texto, usage) => ({ status: 200, body: { choices: [{ message: { content: texto } }], usage } });

let deepseek, together, llm, deepseekFalha = false;

test.before(async () => {
    deepseek = await servidorFalso(() => deepseekFalha
        ? { status: 400, body: { error: { message: 'modelo indisponível' } } }
        : respostaOk('resposta da DeepSeek', { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 50 }));
    together = await servidorFalso(() => respostaOk('resposta da Together', { prompt_tokens: 1000, completion_tokens: 50 }));
    process.env.TOGETHER_API_KEY = 'teste';
    process.env.DEEPSEEK_API_KEY = 'teste';
    process.env.DEEPSEEK_BASE_URL = deepseek.url;
    process.env.TOGETHER_BASE_URL = together.url;
    process.env.LLM_LOG_CUSTO = 'false';
    delete process.env.LLM_DEEPSEEK_THINKING;
    llm = require('../lib/llm');
});
test.after(() => { deepseek.srv.close(); together.srv.close(); });

test('_provedorDe: id sem barra da DeepSeek vai direto; o resto fica na Together', () => {
    assert.equal(llm._provedorDe('deepseek-v4-pro'), 'deepseek');
    assert.equal(llm._provedorDe('deepseek-flash'), 'deepseek');
    assert.equal(llm._provedorDe('deepseek-ai/DeepSeek-V4-Pro-0813'), 'together');
    assert.equal(llm._provedorDe('openai/gpt-oss-120b'), 'together');
    assert.equal(llm._provedorDe(undefined), 'together');
});

test('DeepSeek direto: manda o modelo certo, raciocínio DESLIGADO e sem reasoning_effort', async () => {
    deepseekFalha = false;
    const antes = deepseek.pedidos.length;
    const txt = await llm.chamarLLM({ messages: [{ role: 'user', content: 'oi' }], model: 'deepseek-v4-pro', maxTokens: 120 });
    assert.equal(txt, 'resposta da DeepSeek');
    const pedido = deepseek.pedidos[antes];
    assert.equal(pedido.model, 'deepseek-v4-pro');
    assert.deepEqual(pedido.thinking, { type: 'disabled' });
    assert.equal(pedido.reasoning_effort, undefined);
    assert.equal(pedido.max_tokens, 120);
});

test('DeepSeek falhou: a mesma pergunta vai pro mesmo modelo na Together (a IA não fica muda)', async () => {
    deepseekFalha = true;
    const antes = together.pedidos.length;
    const txt = await llm.chamarLLM({ messages: [{ role: 'user', content: 'oi' }], model: 'deepseek-v4-pro', maxTokens: 120 });
    assert.equal(txt, 'resposta da Together');
    const pedido = together.pedidos[antes];
    assert.equal(pedido.model, 'deepseek-ai/DeepSeek-V4-Pro-0813');
    assert.equal(pedido.thinking, undefined, 'a Together não recebe o parâmetro da DeepSeek');
    assert.equal(pedido.reasoning_effort, 'low');
    deepseekFalha = false;
});

test('modelos da Together continuam indo pra Together', async () => {
    const antesD = deepseek.pedidos.length, antesT = together.pedidos.length;
    const txt = await llm.chamarLLM({ messages: [{ role: 'user', content: 'oi' }], model: 'openai/gpt-oss-120b', maxTokens: 50 });
    assert.equal(txt, 'resposta da Together');
    assert.equal(deepseek.pedidos.length, antesD);
    assert.equal(together.pedidos[antesT].model, 'openai/gpt-oss-120b');
});

test('_ehPicoDeepseek: 01-04h e 06-10h UTC em dia útil; resto e fim de semana fora do pico', () => {
    assert.equal(llm._ehPicoDeepseek(new Date('2026-11-23T02:30:00Z')), true);   // segunda 02:30 UTC
    assert.equal(llm._ehPicoDeepseek(new Date('2026-11-23T08:00:00Z')), true);   // segunda 08:00 UTC
    assert.equal(llm._ehPicoDeepseek(new Date('2026-11-23T15:00:00Z')), false);  // segunda 12h em Brasília
    assert.equal(llm._ehPicoDeepseek(new Date('2026-11-22T02:30:00Z')), false);  // domingo
});

test('custoEstimado: separa cache, sem cache e saída; no pico da DeepSeek é o dobro', () => {
    const usage = { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, completion_tokens: 50 };
    const fora = llm.custoEstimado('deepseek-v4-pro', usage, new Date('2026-11-23T15:00:00Z'));
    const esperado = (800 * 0.022 + 200 * 0.66 + 50 * 1.98) / 1e6;
    assert.ok(Math.abs(fora - esperado) < 1e-12);
    const pico = llm.custoEstimado('deepseek-v4-pro', usage, new Date('2026-11-23T02:30:00Z'));
    assert.ok(Math.abs(pico - 2 * esperado) < 1e-12);
    // Together lê o cache de prompt_tokens_details e nunca dobra
    const t = llm.custoEstimado('openai/gpt-oss-120b', { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens: 100 });
    assert.ok(Math.abs(t - (1000 * 0.15 + 100 * 0.60) / 1e6) < 1e-12);
    assert.equal(llm.custoEstimado('modelo-sem-preco', usage), null);
    assert.equal(llm.custoEstimado('deepseek-v4-pro', null), null);
});
