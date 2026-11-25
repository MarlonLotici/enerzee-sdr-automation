'use strict';
// Caso real Carla (2026-11-24): a DeepSeek segurou a conexão sem responder e, sem timeout (padrão do SDK = 10 min), o job travou.
const test = require('node:test');
const assert = require('node:assert/strict');

test('timeout na DeepSeek: não repete, cai direto na reserva da Together; clientes nascem com timeout', async () => {
    process.env.DEEPSEEK_API_KEY = 'x'; process.env.TOGETHER_API_KEY = 'y';
    const abertos = [];
    const chamadas = { deepseek: 0, together: 0 };
    const openaiPath = require.resolve('openai');
    require.cache[openaiPath] = { id: openaiPath, filename: openaiPath, loaded: true, exports: {
        OpenAI: class {
            constructor(opts) {
                abertos.push(opts);
                const qual = /deepseek\.com/.test(opts.baseURL || '') ? 'deepseek' : 'together';
                this.chat = { completions: { create: async () => {
                    chamadas[qual]++;
                    if (qual === 'deepseek') { const e = new Error('Request timed out.'); e.name = 'APIConnectionTimeoutError'; throw e; }
                    return { choices: [{ message: { content: 'resposta da reserva' } }], usage: {} };
                } } };
            }
        },
    } };
    delete require.cache[require.resolve('../lib/llm.js')];
    const { chamarLLM } = require('../lib/llm.js');

    const ds = abertos.find((o) => /deepseek\.com/.test(o.baseURL || ''));
    const tg = abertos.find((o) => !/deepseek\.com/.test(o.baseURL || ''));
    assert.ok(ds.timeout > 0 && ds.timeout <= 60000, 'DeepSeek precisa de timeout curto');
    assert.equal(ds.maxRetries, 0);
    assert.ok(tg.timeout > 0 && tg.timeout <= 120000, 'Together também precisa de timeout');

    const t0 = Date.now();
    const r = await chamarLLM({ messages: [{ role: 'user', content: 'oi' }], model: 'deepseek-v4-pro', maxTokens: 50 });
    assert.equal(r, 'resposta da reserva');
    assert.equal(chamadas.deepseek, 1, 'não pode repetir a DeepSeek depois do timeout');
    assert.equal(chamadas.together, 1);
    assert.ok(Date.now() - t0 < 2000, 'sem esperas de retry antes da reserva');
});
