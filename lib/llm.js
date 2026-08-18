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

    const chamar = () => client.chat.completions.create(req);
    try {
        return extrairTexto(await chamar());
    } catch (e) {
        if (e?.status === 429) { // rate limit → 1 retry curto
            await _delay(1500);
            return extrairTexto(await chamar());
        }
        throw e;
    }
}

module.exports = { chamarLLM, MODELOS, normalizarMensagens, extrairTexto };
