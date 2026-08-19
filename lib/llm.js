'use strict';
/**
 * lib/llm.js — Adaptador ÚNICO de LLM (Together, via client OpenAI-compatible).
 *
 * Todo o sistema chama LLM por aqui. Centraliza:
 *  - o mapa de modelos (trocar de modelo = editar MODELOS, ou via env LLM_MODELO_*);
 *  - a montagem das mensagens no formato OpenAI (system dentro do array de mensagens);
 *  - suporte a imagem (visão, via image_url base64) e 1 retry em 429.
 *
 * Provedor: Together (https://api.together.xyz/v1) com o SDK `openai` — mesmo padrão
 * OpenAI-compatible que os agentes usavam antes do adaptador. Modelos atuais (nenhum é
 * Llama, nenhum na lista de descontinuação):
 *   rapido  = deepseek-ai/DeepSeek-V4-Flash-0731  (roteador/extração/classificação)
 *   cerebro = openai/gpt-oss-120b                 (closer/objeção — fala com o cliente)
 *   visao   = Qwen/Qwen3.5-9B                      (leitura de foto de conta de luz)
 *
 * Áudio (speech-to-text) NÃO passa por aqui — Together não faz STT; o Whisper (Groq)
 * continua direto no 4_sdr.js.
 */

const { OpenAI } = require('openai');
const { tenantLLMAtual } = require('./llmContext');

const client = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});

// Mapa central de modelos. Trocar de modelo no futuro = mexer só aqui (ou via env).
const MODELOS = {
    rapido:  process.env.LLM_MODELO_RAPIDO  || 'deepseek-ai/DeepSeek-V4-Flash-0731', // classificação/extração interna
    cerebro: process.env.LLM_MODELO_CEREBRO || 'openai/gpt-oss-120b',                // resposta que vai pro cliente
    visao:   process.env.LLM_MODELO_VISAO   || 'Qwen/Qwen3.5-9B',                     // leitura de fatura (imagem)
};

/**
 * Normaliza histórico (role user/assistant): só user/assistant, começa em user, funde
 * consecutivos do mesmo role, tira vazios. A normalização é inofensiva pro formato OpenAI
 * (evita turnos vazios/ambíguos). Função PURA (testável).
 * @param {Array<{role:string,content:string}>} historico
 * @returns {Array<{role:'user'|'assistant',content:string}>}
 */
function normalizarMensagens(historico) {
    const limpos = (historico || [])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map(m => ({ role: m.role, content: m.content }));

    // Funde consecutivos do mesmo role (evita ambiguidade).
    const fundidos = [];
    for (const m of limpos) {
        const ult = fundidos[fundidos.length - 1];
        if (ult && ult.role === m.role) ult.content += '\n' + m.content;
        else fundidos.push({ ...m });
    }

    // Garante 1ª mensagem = user. Se começar em assistant, prefixa um turno user mínimo.
    if (fundidos.length && fundidos[0].role === 'assistant') {
        fundidos.unshift({ role: 'user', content: '(conversa em andamento)' });
    }
    // Precisa de pelo menos 1 mensagem user.
    if (!fundidos.length) fundidos.push({ role: 'user', content: 'ok' });
    return fundidos;
}

/**
 * Extrai o texto de uma resposta OpenAI-compatible (choices[0].message.content).
 * Sempre devolve string (nunca lança), trate choices/message ausentes. Função PURA (testável).
 */
function extrairTexto(resp) {
    return resp?.choices?.[0]?.message?.content?.trim() || '';
}

const _delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── Teto de custo por tenant (modo "inteligente", Fase 2) ───────────────────
// O gasto é contado por (conta, tipo) no budgetGuard (Redis). Mapeia o modelo pro
// tipo de budget. Só conta se houver tenant no contexto (tenantLLMAtual) — em
// scripts/testes sem contexto, o gate é inerte (e o budgetGuard nem é carregado).
function _tipoBudget(model) {
    if (model === MODELOS.cerebro) return 'llm_cerebro';
    if (model === MODELOS.visao)   return 'llm_visao';
    if (model === MODELOS.rapido)  return 'llm_rapido';
    return null; // modelo custom/desconhecido → não contabiliza
}
// Tetos de SEGURANÇA (por conta/dia). Altos de propósito: no uso normal nunca
// batem — só cortam loop absurdo. O cérebro (fala com o lead) NUNCA é calado no
// uso real; se bater o teto, é sinal de bug em loop, e aí travar é o certo.
function _limiteBudget(tipo) {
    const envs = {
        llm_cerebro: process.env.BUDGET_LLM_CEREBRO_DIA,
        llm_rapido:  process.env.BUDGET_LLM_RAPIDO_DIA,
        llm_visao:   process.env.BUDGET_LLM_VISAO_DIA,
    };
    const defaults = { llm_cerebro: 5000, llm_rapido: 12000, llm_visao: 2000 };
    const n = parseInt(envs[tipo], 10);
    return Number.isFinite(n) && n > 0 ? n : defaults[tipo];
}

// gpt-oss é modelo de RACIOCÍNIO: gasta tokens "pensando" antes da resposta, comendo o
// max_tokens e truncando a resposta no meio. Num chat de WhatsApp não precisamos disso →
// reasoning_effort baixo (economiza token/custo e libera o orçamento pra resposta final).
// Só se aplica ao gpt-oss; DeepSeek/Qwen não recebem o parâmetro. Função PURA (testável).
function _reasoningEffortPara(model) {
    return /gpt-oss/i.test(String(model)) ? (process.env.LLM_REASONING_EFFORT || 'low') : undefined;
}

/**
 * Chamada unificada ao LLM (Together).
 * @param {object}   opts
 * @param {string}  [opts.system]     prompt de sistema (vira a 1ª mensagem role:system)
 * @param {Array}   [opts.messages]   histórico user/assistant (será normalizado)
 * @param {string}  [opts.model]      id do modelo (default MODELOS.rapido)
 * @param {number}  [opts.maxTokens]  teto de saída (default 300)
 * @param {Array}   [opts.imagens]    [{ media_type, dataBase64 }] pra visão (anexadas ao 1º turno user)
 * @returns {Promise<string>} texto da resposta (lança em falha após 1 retry — o chamador trata o fallback)
 */
async function chamarLLM({ system, messages = [], model = MODELOS.rapido, maxTokens = 300, imagens = [] } = {}) {
    let msgs = normalizarMensagens(messages);

    // Visão: anexa as imagens ao primeiro turno user, virando content em blocos (formato OpenAI).
    if (imagens && imagens.length) {
        const primeiro = msgs[0];
        const blocos = [{ type: 'text', text: primeiro.content }];
        for (const img of imagens) {
            blocos.push({
                type: 'image_url',
                image_url: { url: `data:${img.media_type || 'image/jpeg'};base64,${img.dataBase64}` },
            });
        }
        msgs = [{ role: 'user', content: blocos }, ...msgs.slice(1)];
    }

    const finalMsgs = system ? [{ role: 'system', content: system }, ...msgs] : msgs;
    const req = { model, max_tokens: maxTokens, messages: finalMsgs };
    const _re = _reasoningEffortPara(model);
    if (_re) req.reasoning_effort = _re;

    // Teto de custo por tenant (só quando há tenant no contexto do fluxo atual).
    // require lazy do budgetGuard: evita puxar o Redis no load do módulo (mantém os
    // testes puros). podeGastar falha ABERTO se o Redis cair (não trava o motor).
    const _ctx = tenantLLMAtual();
    const _tipo = _tipoBudget(model);
    let _budget = null, _limite = 0;
    if (_ctx?.userId && _tipo) {
        _budget = require('../budgetGuard');
        _limite = _limiteBudget(_tipo);
        if (!(await _budget.podeGastar(_ctx.userId, _tipo, _limite))) {
            throw new Error(`[BUDGET] teto diário de ${_tipo} atingido para o tenant ${String(_ctx.userId).slice(0, 8)} (possível loop).`);
        }
    }
    const _contabilizar = () => {
        if (_budget) _budget.registrarGasto(_ctx.userId, _tipo, _limite).catch(() => {});
    };

    const chamar = () => client.chat.completions.create(req);
    try {
        const out = extrairTexto(await chamar());
        _contabilizar();
        return out;
    } catch (e) {
        if (e?.status === 429) { // rate limit → 1 retry curto
            await _delay(1500);
            const out = extrairTexto(await chamar());
            _contabilizar();
            return out;
        }
        throw e;
    }
}

module.exports = { chamarLLM, MODELOS, normalizarMensagens, extrairTexto, _tipoBudget, _limiteBudget, _reasoningEffortPara };
