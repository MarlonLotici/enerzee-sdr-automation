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
 *   rapido  = deepseek-ai/DeepSeek-V4.1-Flash     (extração/classificação interna)
 *   cerebro = openai/gpt-oss-120b                 (closer/objeção — fala com o cliente)
 *   visao   = Qwen/Qwen3.5-9B                      (leitura de imagem — sem uso no SDR hoje)
 *
 * ⚠️ 2026-10-14: DeepSeek-V4-Flash-0731 descontinuado pela Together (22/out) — migrado pro
 * substituto oficial V4.1-Flash. NO CAMINHO achamos que o antigo virou modelo de "raciocínio"
 * e vinha devolvendo VAZIO em todo call com maxTokens apertado (<150) — o budget era todo
 * consumido pensando, 0 tokens sobravam pro conteúdo. Isso incluía o SUPERVISOR (juiz de
 * qualidade do WhatsApp, maxTokens:260), que ficava SEMPRE em fail-open (sempre aprovava,
 * nunca pegava erro real) — ver supervisorAgent.js. O V4.1-Flash tem o MESMO comportamento de
 * raciocínio; a correção foi subir maxTokens em todo consumidor de MODELOS.rapido (~3-4x).
 *
 * Áudio (speech-to-text) NÃO passa por aqui — Together não faz STT; o Whisper (Groq)
 * continua direto no 4_sdr.js.
 */

const { OpenAI } = require('openai');
const { tenantLLMAtual } = require('./llmContext');

const client = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
});

// ── DeepSeek DIRETO (2026-11-23) ────────────────────────────────────────────
// O mesmo modelo comprado na fonte sai ~2-3x mais barato que na Together e tem cache automático do prefixo
// (as regras fixas da Sofia, que se repetem em toda resposta, passam a custar quase nada). Ids SEM barra:
// 'deepseek-v4-pro' e 'deepseek-flash' (docs oficiais lidas em 23/11/2026). Ids com barra continuam na Together.
// Reserva: sem DEEPSEEK_API_KEY, ou se a DeepSeek falhar, a chamada vai pro MESMO modelo na Together. A IA nunca fica muda.
const clientDeepseek = process.env.DEEPSEEK_API_KEY
    ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com' })
    : null;
const RESERVA_TOGETHER = {
    'deepseek-v4-pro': process.env.LLM_RESERVA_PRO || 'deepseek-ai/DeepSeek-V4-Pro-0813',
    'deepseek-flash':  process.env.LLM_RESERVA_FLASH || 'deepseek-ai/DeepSeek-V4.1-Flash',
};
/** 'deepseek' para ids da API oficial (sem barra), 'together' para o resto. Função PURA. */
function _provedorDe(model) {
    return /^deepseek-[a-z0-9.-]+$/i.test(String(model || '')) ? 'deepseek' : 'together';
}

// ── Custo estimado por chamada (só pra medir; não bloqueia nada) ────────────
// US$ por 1M tokens: [entrada em cache, entrada sem cache, saída]. DeepSeek = preço FORA do pico (no pico é o dobro).
// Together = blog da Together (conferir). Sobrescreva com LLM_PRECOS='{"modelo":[cache,semCache,saida]}'.
const PRECOS = {
    'deepseek-v4-pro':                  [0.022, 0.66, 1.98],
    'deepseek-flash':                   [0.003, 0.15, 0.60],
    'deepseek-ai/DeepSeek-V4-Pro-0813': [0.20, 2.10, 4.40],
    'openai/gpt-oss-120b':              [0.15, 0.15, 0.60],
};
/** Pico da DeepSeek: seg-sex, 01-04h e 06-10h UTC (22h-01h e 03h-07h em Brasília). Função PURA. */
function _ehPicoDeepseek(d = new Date()) {
    const dia = d.getUTCDay(), h = d.getUTCHours();
    return dia >= 1 && dia <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}
/** Custo estimado em US$ de uma chamada a partir do `usage` da resposta. null se não há preço/uso. Função PURA. */
function custoEstimado(model, usage, quando = new Date()) {
    let tabela = PRECOS;
    try { if (process.env.LLM_PRECOS) tabela = { ...PRECOS, ...JSON.parse(process.env.LLM_PRECOS) }; } catch (_) {}
    const p = tabela[model];
    if (!p || !usage) return null;
    const total = Number(usage.prompt_tokens) || 0;
    const cache = Number(usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens) || 0;
    const saida = Number(usage.completion_tokens) || 0;
    const mult = _provedorDe(model) === 'deepseek' && _ehPicoDeepseek(quando) ? 2 : 1;
    return mult * (cache * p[0] + Math.max(0, total - cache) * p[1] + saida * p[2]) / 1e6;
}
// Soma por conversa (em memória, só pro log). Limitado pra não crescer sem fim.
const _custoPorLead = new Map();
function _registrarCusto(model, usage, ctx) {
    if (process.env.LLM_LOG_CUSTO === 'false' || !usage) return;
    const c = custoEstimado(model, usage);
    const cache = Number(usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens) || 0;
    const rac = Number(usage.completion_tokens_details?.reasoning_tokens) || 0;
    let conversa = '';
    if (ctx?.leadId && c != null) {
        const ac = _custoPorLead.get(ctx.leadId) || { usd: 0, n: 0 };
        ac.usd += c; ac.n += 1;
        _custoPorLead.delete(ctx.leadId); _custoPorLead.set(ctx.leadId, ac);
        if (_custoPorLead.size > 1000) _custoPorLead.delete(_custoPorLead.keys().next().value);
        conversa = ` | conversa ${ctx.leadNome || String(ctx.leadId).slice(0, 8)}: US$ ${ac.usd.toFixed(4)} em ${ac.n} chamadas`;
    }
    console.log(`💲 [LLM] ${model} in=${usage.prompt_tokens || 0} cache=${cache} out=${usage.completion_tokens || 0}${rac ? ` (raciocínio ${rac})` : ''} ≈ ${c == null ? 'sem preço' : 'US$ ' + c.toFixed(5)}${conversa}`);
}

// Mapa central de modelos. Trocar de modelo no futuro = mexer só aqui (ou via env).
const MODELOS = {
    rapido:  process.env.LLM_MODELO_RAPIDO  || 'deepseek-ai/DeepSeek-V4.1-Flash', // classificação/extração interna
    cerebro: process.env.LLM_MODELO_CEREBRO || 'openai/gpt-oss-120b',                // classificação/análise interna (roteador, triagem, supervisor...)
    visao:   process.env.LLM_MODELO_VISAO   || 'Qwen/Qwen3.5-9B',                     // leitura de imagem
};
// Texto que VAI PRO CLIENTE (closer, objeção, concierge, retomada, briefing, proposta, prospecção). Separado do
// cérebro (2026-11-18): trocar o cérebro por um modelo de raciocínio maior (DeepSeek V4 Pro) fazia os agentes
// internos de maxTokens pequeno (roteador 200, intel 150...) devolverem VAZIO. Padrão = o próprio cérebro.
MODELOS.conversa = process.env.LLM_MODELO_CONVERSA || MODELOS.cerebro;

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
 *
 * gpt-oss usa o formato "harmony" e às vezes vaza tokens de controle no content
 * (ex.: "...outbound?<|end|><|start|>assistant<|channel|>analysis<|message|>..."). O texto
 * útil vem SEMPRE antes do 1º marcador `<|...|>` — cortamos ali. Nenhuma resposta normal
 * contém `<|`, então o corte é seguro pra todos os modelos.
 */
function extrairTexto(resp) {
    let txt = resp?.choices?.[0]?.message?.content;
    if (typeof txt !== 'string') return '';
    const corte = txt.indexOf('<|');
    if (corte !== -1) txt = txt.slice(0, corte);
    return txt.trim();
}

const _delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── Teto de custo por tenant (modo "inteligente", Fase 2) ───────────────────
// O gasto é contado por (conta, tipo) no budgetGuard (Redis). Mapeia o modelo pro
// tipo de budget. Só conta se houver tenant no contexto (tenantLLMAtual) — em
// scripts/testes sem contexto, o gate é inerte (e o budgetGuard nem é carregado).
function _tipoBudget(model) {
    if (model === MODELOS.cerebro || model === MODELOS.conversa) return 'llm_cerebro';
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

// gpt-oss e DeepSeek (desde a troca pro V4.1-Flash em 2026-10-14) são modelos de RACIOCÍNIO:
// gastam tokens "pensando" antes da resposta, comendo o max_tokens e devolvendo VAZIO/truncado
// (visto: 0 tokens de conteúdo com maxTokens<150 — o supervisor ficava sempre em fail-open por
// isso). reasoning_effort baixo corta esse consumo (~250→80 tokens de raciocínio, confirmado em
// teste) sem precisar inflar o maxTokens de todo call site. Qwen (visao) não recebe o parâmetro
// (nunca bateu nesse regex). Função PURA (testável).
function _reasoningEffortPara(model) {
    return /gpt-oss|deepseek/i.test(String(model)) ? (process.env.LLM_REASONING_EFFORT || 'low') : undefined;
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
    // Monta o pedido de acordo com o provedor. Na DeepSeek direta o raciocínio vem LIGADO por padrão (esforço alto) e
    // é cobrado como saída: desligamos (LLM_DEEPSEEK_THINKING=enabled religa, com esforço baixo).
    const montarReq = (modelo, provedor) => {
        const r = { model: modelo, max_tokens: maxTokens, messages: finalMsgs };
        if (provedor === 'deepseek') {
            const ligado = process.env.LLM_DEEPSEEK_THINKING === 'enabled';
            r.thinking = { type: ligado ? 'enabled' : 'disabled' };
            if (ligado) r.reasoning_effort = process.env.LLM_REASONING_EFFORT || 'low';
        } else {
            const _re = _reasoningEffortPara(modelo);
            if (_re) r.reasoning_effort = _re;
        }
        return r;
    };
    const provedor = _provedorDe(model);
    const modeloTogether = provedor === 'deepseek' ? (RESERVA_TOGETHER[model] || model) : model;

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

    // Alguns modelos da Together (ex.: Qwen3.7 Plus) só aceitam resposta em STREAMING (400 "only supports streaming").
    // Auto-cura: tenta normal; se o provedor exigir stream, refaz acumulando os pedaços e devolve no mesmo formato.
    const chamar = async (cli, req) => {
        try {
            return await cli.chat.completions.create(req);
        } catch (e) {
            if (!(e?.status === 400 && /only supports streaming|stream/i.test(String(e?.message || '')))) throw e;
            const stream = await cli.chat.completions.create({ ...req, stream: true });
            let content = '';
            for await (const parte of stream) content += parte?.choices?.[0]?.delta?.content || '';
            return { choices: [{ message: { content } }] };
        }
    };
    // Retry em erros TRANSITÓRIOS (rate limit, 5xx, timeout, rede) — é o que gerava o "IA
    // degradada / o agente falhou" quando o provedor (Together) dava uma piscada. Até 3 tentativas
    // com backoff. Erro não-transitório (ex.: 400 prompt inválido) sobe na hora, sem retry.
    const _ehTransitorio = (e) => {
        const s = e?.status || e?.response?.status;
        if (s === 429 || (s >= 500 && s < 600)) return true;
        const code = e?.code || e?.cause?.code || '';
        return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|UND_ERR|timeout|aborted|fetch failed/i.test(String(code) + ' ' + String(e?.message || ''));
    };
    const _esperas = [1200, 3000, 6000];
    const _executar = async (cli, req) => {
        let _ultimoErro;
        for (let _i = 0; _i <= _esperas.length; _i++) {
            try {
                return await chamar(cli, req);
            } catch (e) {
                _ultimoErro = e;
                if (_i < _esperas.length && _ehTransitorio(e)) {
                    console.warn(`⚠️ [LLM] Falha transitória (${e?.status || e?.code || e?.message}). Retry ${_i + 1}/${_esperas.length} em ${_esperas[_i]}ms...`);
                    await _delay(_esperas[_i]);
                    continue;
                }
                throw e;
            }
        }
        throw _ultimoErro;
    };

    let resp, modeloUsado = modeloTogether;
    if (provedor === 'deepseek' && clientDeepseek) {
        try {
            resp = await _executar(clientDeepseek, montarReq(model, 'deepseek'));
            modeloUsado = model;
        } catch (e) {
            console.warn(`⚠️ [LLM] DeepSeek falhou (${e?.status || e?.code || String(e?.message || '').slice(0, 80)}) — usando a reserva na Together (${modeloTogether}).`);
            resp = await _executar(client, montarReq(modeloTogether, 'together'));
        }
    } else {
        resp = await _executar(client, montarReq(modeloTogether, 'together'));
    }
    _contabilizar();
    _registrarCusto(modeloUsado, resp?.usage, _ctx);
    return extrairTexto(resp);
}

module.exports = { chamarLLM, MODELOS, normalizarMensagens, extrairTexto, _tipoBudget, _limiteBudget, _reasoningEffortPara, _provedorDe, _ehPicoDeepseek, custoEstimado, PRECOS };
