'use strict';
/**
 * lib/llm.js — Adaptador ÚNICO de LLM (Anthropic/Claude).
 *
 * Todo o sistema chama LLM por aqui. Centraliza:
 *  - o mapa de modelos (trocar de modelo = editar MODELOS);
 *  - as diferenças da API Anthropic vs o padrão OpenAI/Groq/Together que o código usava
 *    (system fora das mensagens, sem temperature/penalties, leitura de content[].text);
 *  - suporte a imagem (visão) e 1 retry em 429/overloaded.
 *
 * Áudio (speech-to-text) NÃO passa por aqui — o Claude não transcreve; o Whisper (Groq)
 * continua direto no 4_sdr.js.
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mapa central de modelos. Trocar de modelo no futuro = mexer só aqui (ou via env).
const MODELOS = {
    rapido:  process.env.CLAUDE_MODELO_RAPIDO  || 'claude-haiku-4-5', // classificação/extração interna
    cerebro: process.env.CLAUDE_MODELO_CEREBRO || 'claude-sonnet-5',  // resposta que vai pro cliente
    visao:   process.env.CLAUDE_MODELO_VISAO   || 'claude-haiku-4-5', // leitura de fatura (imagem)
};

// Modelos que ligam "adaptive thinking" por padrão quando o campo é omitido (Sonnet 5, Opus, Fable).
// Nesses, mandamos thinking:disabled pra manter a resposta rápida/barata num chat de WhatsApp.
// Haiku 4.5 já vem sem thinking por padrão → omitimos o campo (evita 400 em modelo que não aceita disabled).
function _thinkingPara(model) {
    return /^claude-(sonnet-5|opus|fable)/.test(model) ? { type: 'disabled' } : undefined;
}

/**
 * Normaliza histórico estilo OpenAI (role user/assistant) pro formato Anthropic:
 * só user/assistant, começa em user, funde consecutivos do mesmo role, tira vazios.
 * Função PURA (testável).
 * @param {Array<{role:string,content:string}>} historico
 * @returns {Array<{role:'user'|'assistant',content:string}>}
 */
function normalizarMensagens(historico) {
    const limpos = (historico || [])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map(m => ({ role: m.role, content: m.content }));

    // Funde consecutivos do mesmo role (Anthropic tolera, mas evitamos ambiguidade).
    const fundidos = [];
    for (const m of limpos) {
        const ult = fundidos[fundidos.length - 1];
        if (ult && ult.role === m.role) ult.content += '\n' + m.content;
        else fundidos.push({ ...m });
    }

    // Anthropic exige a 1ª mensagem = user. Se começar em assistant, prefixa um turno user mínimo.
    if (fundidos.length && fundidos[0].role === 'assistant') {
        fundidos.unshift({ role: 'user', content: '(conversa em andamento)' });
    }
    // Precisa de pelo menos 1 mensagem user.
    if (!fundidos.length) fundidos.push({ role: 'user', content: 'ok' });
    return fundidos;
}

/**
 * Extrai o texto de uma resposta Anthropic (concatena blocos text). Trata refusal/vazio.
 * Função PURA (testável).
 */
function extrairTexto(resp) {
    if (!resp || resp.stop_reason === 'refusal' || !Array.isArray(resp.content)) return '';
    return resp.content.filter(b => b && b.type === 'text').map(b => b.text).join('').trim();
}

const _delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Chamada unificada ao Claude.
 * @param {object}   opts
 * @param {string}  [opts.system]     prompt de sistema (fica fora das mensagens)
 * @param {Array}   [opts.messages]   histórico user/assistant (será normalizado)
 * @param {string}  [opts.model]      id do modelo (default MODELOS.rapido)
 * @param {number}  [opts.maxTokens]  teto de saída (default 300)
 * @param {Array}   [opts.imagens]    [{ media_type, dataBase64 }] pra visão (anexadas ao 1º turno user)
 * @returns {Promise<string>} texto da resposta (lança em falha após 1 retry — o chamador trata o fallback)
 */
async function chamarLLM({ system, messages = [], model = MODELOS.rapido, maxTokens = 300, imagens = [] } = {}) {
    let msgs = normalizarMensagens(messages);

    // Visão: anexa as imagens ao primeiro turno user, virando content em blocos.
    if (imagens && imagens.length) {
        const primeiro = msgs[0];
        const blocos = [{ type: 'text', text: primeiro.content }];
        for (const img of imagens) {
            blocos.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.dataBase64 } });
        }
        msgs = [{ role: 'user', content: blocos }, ...msgs.slice(1)];
    }

    const req = { model, max_tokens: maxTokens, messages: msgs };
    if (system) req.system = system;
    const thinking = _thinkingPara(model);
    if (thinking) req.thinking = thinking;

    const chamar = () => client.messages.create(req);
    try {
        return extrairTexto(await chamar());
    } catch (e) {
        if (e?.status === 429 || e?.status === 529) { // rate limit / overloaded → 1 retry curto
            await _delay(1500);
            return extrairTexto(await chamar());
        }
        throw e;
    }
}

module.exports = { chamarLLM, MODELOS, normalizarMensagens, extrairTexto };
