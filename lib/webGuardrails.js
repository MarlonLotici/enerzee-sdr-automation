'use strict';
// lib/webGuardrails.js — Travas PURAS de qualidade da resposta da IA no chat do site.
// Extraídas de 4_sdr.js (responderWebChat) pra serem testáveis isoladamente. Sem I/O.
//
// stripWeb   : remove tags internas ([ESTAGIO], [QUEBRA]...) e MATA link falso
//              (antix.com.br/agendar) e Calendly — a IA não tem link no canal web.
// enxugarWeb : anti-paredão. 1 pergunta por vez (corta no 1º "?") e, sem pergunta,
//              no máx 2 frases — pra a resposta nunca virar muro de texto.

const { regexTagsInternas } = require('./marcadoresInternos');

function stripWeb(t) {
    return String(t || '')
        .replace(regexTagsInternas(), '')
        .replace(/\[QUEBRA\]/gi, '\n')
        .replace(/https?:\/\/antix\.com\.br\/agendar\S*/gi, '')
        .replace(/https?:\/\/calendly\.com\/\S*/gi, '')
        .replace(/\n{3,}/g, '\n\n').trim();
}

function enxugarWeb(t) {
    let s = String(t || '').trim();
    if (!s) return s;
    const q = s.indexOf('?');
    if (q !== -1) return s.slice(0, q + 1).trim();
    const frases = s.split(/(?<=[.!…])\s+/).filter(Boolean);
    return (frases.length > 2 ? frases.slice(0, 2).join(' ') : s).trim();
}

module.exports = { stripWeb, enxugarWeb };
