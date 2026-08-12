'use strict';
// lib/gcalParse.js — Parsing PURO de eventos do Google Calendar (sem I/O). Testável.
// A descrição do evento (vinda do GoHighLevel/msgsndr) traz o telefone e o email do convidado.
// Ex.:  "Telefone: - (94) 98109-3362\nE-mail: - pcenine@gmail.com"  (ou "Phone:- (11) 97602-4571")

// Captura o bloco após "Telefone"/"Phone"/"Fone"/"Celular" até a quebra de linha.
const RE_TELEFONE = /(?:telefone|phone|fone|celular|whatsapp|cel)\s*:?\s*-?\s*([+()\d][()\d\s\-]{7,})/i;

/**
 * Extrai só os dígitos do telefone da descrição do evento.
 * @returns {string|null} dígitos (ex.: "94981093362") ou null se não achar.
 */
function extrairTelefoneDescricao(descricao) {
    if (!descricao || typeof descricao !== 'string') return null;
    const m = descricao.match(RE_TELEFONE);
    if (!m) return null;
    const digitos = m[1].replace(/\D/g, '');
    // BR: 10 (fixo com DDD) a 13 (55+DDD+9). Fora disso, não é telefone confiável.
    if (digitos.length < 10 || digitos.length > 13) return null;
    return digitos;
}

// Emojis de status que podem já estar no título — usados pra não re-marcar e pra reescrever.
const EMOJIS_STATUS = ['✅', '❌', '❓', '☑️', '✔️', '❔'];

/**
 * Decide se um evento é uma REUNIÃO com um lead (candidata a confirmação).
 * Aceita: evento com horário (não all-day), com pelo menos um convidado diferente do organizador.
 * Rejeita: blocos tipo "fechado"/"Fechado" (sem convidado), all-day, cancelados.
 * @param {object} ev  evento cru da API do Google Calendar
 * @returns {boolean}
 */
function eventoEhReuniao(ev) {
    if (!ev || ev.status === 'cancelled') return false;
    if (!ev.start || !ev.start.dateTime) return false;              // all-day não tem dateTime
    const organizador = (ev.organizer && ev.organizer.email || '').toLowerCase();
    const convidados = Array.isArray(ev.attendees) ? ev.attendees : [];
    const externo = convidados.some((a) => {
        const email = (a.email || '').toLowerCase();
        return email && email !== organizador && !a.resource;
    });
    return externo;
}

// Remove qualquer emoji de status já presente no começo do título, pra reescrever limpo.
function tituloSemEmojiStatus(summary) {
    let s = summary || '';
    let mudou = true;
    while (mudou) {
        mudou = false;
        for (const e of EMOJIS_STATUS) {
            if (s.startsWith(e)) { s = s.slice(e.length); mudou = true; }
        }
        if (s.startsWith(' ')) { s = s.replace(/^\s+/, ''); }
    }
    return s;
}

/**
 * Monta o novo título com o emoji de status no começo (idempotente).
 * @param {string} summary  título atual
 * @param {string} emoji    '✅' | '❌' | '❓'
 */
function tituloComEmoji(summary, emoji) {
    return `${emoji}${tituloSemEmojiStatus(summary)}`;
}

/**
 * Dígitos BR → lista de JIDs do WhatsApp, cobrindo a variação do 9º dígito (celular).
 * Mesma lógica de normalizarTelefoneBR (server.js), aqui pura/testável. Primeiro item = base.
 * @param {string} digitos  só dígitos (ex.: "94981093362")
 * @returns {string[]} ex.: ["5594981093362@s.whatsapp.net", ...]
 */
function digitosParaJids(digitos) {
    const d = (digitos || '').replace(/\D/g, '');
    if (d.length < 10) return [];
    const base = d.startsWith('55') ? d : '55' + d;
    const variacoes = new Set([base]);
    if (base.length === 12) variacoes.add(base.slice(0, 4) + '9' + base.slice(4)); // insere 9º dígito
    else if (base.length === 13) variacoes.add(base.slice(0, 4) + base.slice(5));  // remove 9º dígito
    return Array.from(variacoes).map((n) => `${n}@s.whatsapp.net`);
}

module.exports = { extrairTelefoneDescricao, eventoEhReuniao, tituloSemEmojiStatus, tituloComEmoji, digitosParaJids, RE_TELEFONE };
