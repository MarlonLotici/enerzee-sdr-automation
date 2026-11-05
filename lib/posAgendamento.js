'use strict';
/**
 * Pós-agendamento (lead já marcou). Antes, QUALQUER mensagem com < 15 letras caía numa frase fixa
 * ("Tá tudo certo pra nossa conversa... Tem alguma dúvida?") — "Obrigado" e "Tá tudo certo" recebiam
 * a MESMA frase, repetida (bug 2026-11-05). Aqui separamos:
 *   - encerramento ("obrigado", "tá tudo certo", "ok", "até amanhã", 👍) → despede curto, sem pergunta;
 *     se a IA JÁ se despediu e o lead manda outro "ok", fica em silêncio (conversa encerrada).
 *   - o resto (saudação, dúvida curta) → decidido por quem chama.
 */

const _norm = (t) => String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Expressões de "fechou / obrigado" (já normalizadas: sem acento, minúsculas).
const RE_EXPRESSOES = new RegExp('\\b(?:' + [
    'muito obrigad[oa]s?', 'obrigad[oa]+s?', 'obgd?a?', 'brigad[oa]', 'valeu', 'vlw', 'agradec\\w*', 'grat[oa]',
    'ta tudo certo', 'esta tudo certo', 'tudo certo', 'tudo ok', 'tudo tranquilo', 'tudo joia', 'ta certo', 'ta bom', 'ta otimo',
    'sem duvidas?', 'nenhuma duvida', 'nao tenho duvidas?', 'sem mais duvidas?', 'por enquanto (?:e )?so',
    'ate amanha', 'ate la', 'ate logo', 'ate mais', 'ate breve', 'te vejo la', 'nos vemos', 'tchau',
    'ok(?:ay|ey)?', 'blz', 'beleza', 'combinado', 'fechado', 'certo', 'perfeito', 'show', 'top', 'otimo', 'joia', 'massa', 'legal',
    'pode deixar', 'confirmado', 'confirmo', 'certinho', 'ai sim',
].join('|') + ')\\b', 'g');
// Palavras de enchimento que podem sobrar ("ok então, valeu aí").
const RE_ENCHIMENTO = /\b(?:entao|e|ai|aqui|mesmo|demais|mto|muito|pra|por|voce|vc|sofia|amiga|de|nada)\b/g;

/** A mensagem inteira é só agradecimento/encerramento (sem dúvida, sem pedido)? */
function ehEncerramento(texto) {
    const bruto = String(texto || '');
    if (/\?/.test(bruto)) return false;                  // pergunta = não está encerrando
    const n = _norm(bruto);
    if (!n) return bruto.trim().length > 0;              // só emoji (👍 🙏) = encerramento
    if (n.split(' ').length > 10) return false;
    const resto = n.replace(RE_EXPRESSOES, ' ').replace(RE_ENCHIMENTO, ' ').replace(/\s+/g, ' ').trim();
    return resto === '';
}

const INICIOS_DESPEDIDA = ['combinado', 'perfeito', 'por nada', 'imagina', 'disponha'];

/** Última fala da IA já foi uma despedida nossa? (pra não ficar num "ok"/"até" infinito) */
function jaSeDespediu(historico = []) {
    const ultimaIA = [...historico].reverse().find(m => m?.role === 'assistant');
    if (!ultimaIA) return false;
    const n = _norm(ultimaIA.content);
    return !/\?/.test(String(ultimaIA.content || '')) && INICIOS_DESPEDIDA.some(i => n.startsWith(i));
}

/** Despedida curta e SEM pergunta. `quando` = "amanhã às 11h30" (ou null). `sortear` injetável pra teste. */
function montarDespedida({ nome = '', quando = null, agradeceu = false, sortear = (arr) => arr[Math.floor(Math.random() * arr.length)] } = {}) {
    const v = nome ? `, ${nome}` : '';
    const ate = quando ? `Até ${quando}` : 'Até lá';
    const opcoes = agradeceu
        ? [`Por nada${v}! ${ate} 😊`, `Imagina${v}! ${ate} então 🙌`, `Disponha${v}! ${ate} 👋`]
        : [`Combinado${v}! ${ate} 🙌`, `Perfeito${v}! ${ate} então 😊`, `Combinado${v}! Qualquer coisa até lá é só me chamar 👋`];
    return sortear(opcoes);
}

const RE_AGRADECEU = /\b(?:obrigad|obg|brigad|valeu|vlw|agradec|grat[oa]\b)/;
const agradeceu = (texto) => RE_AGRADECEU.test(_norm(texto));

const _semMarcador = (t) => String(t || '').replace(/\[\s*[ÁA]UDIO[\s_-]*TTS\s*\]/gi, '');

/** Mesma mensagem que a IA acabou de mandar? (anti-eco: nunca repete a fala anterior igualzinha) */
function repeteUltimaDaIA(texto, historico = []) {
    const alvo = _norm(_semMarcador(texto));
    if (alvo.length < 8) return false;
    const ultimaIA = [...historico].reverse().find(m => m?.role === 'assistant');
    if (!ultimaIA) return false;
    return _norm(_semMarcador(ultimaIA.content)) === alvo;
}

module.exports = { ehEncerramento, jaSeDespediu, montarDespedida, agradeceu, repeteUltimaDaIA };
