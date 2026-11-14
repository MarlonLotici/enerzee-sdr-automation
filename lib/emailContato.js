'use strict';
/**
 * E-mail do lead na confirmação de agenda: lê a RAJADA inteira (tudo o que ele mandou desde a última fala da IA),
 * não só a última mensagem, e entende correção.
 *
 * Bug 2026-11-14 (Haislann): mandou o e-mail com erro de digitação, "Ops", e o e-mail certo em 14 segundos. A IA
 * só olhava a última mensagem ("Ops" = sem e-mail) e a conversa travou. Também: um e-mail novo nunca substituía
 * o salvo (só preenchia se estivesse vazio), então a correção seria ignorada.
 */

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Sinal de que o lead errou e vai corrigir ("ops", "errei", "desculpa", "na verdade", "o certo é").
const RE_CORRECAO = /\b(ops+|opa+|oops|errei|errad[oa]|erro|desculp\w*|na\s+verdade|o\s+certo|corrig\w*|digitei)\b/i;

function extrairEmails(texto) {
    return (String(texto || '').match(RE_EMAIL) || []).map(e => e.replace(/[.,;:]+$/, '').toLowerCase());
}

function emailValido(e) {
    const s = String(e || '').trim();
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s) && !/\.\./.test(s);
}

/** Mensagens do lead desde a última fala da IA (a "rajada" que a resposta atual precisa cobrir). */
function rajadaDoLead(historico = [], ultimaMsg = '') {
    const rajada = [];
    for (let i = historico.length - 1; i >= 0 && historico[i]?.role !== 'assistant'; i--) {
        rajada.unshift(String(historico[i]?.content || ''));
    }
    if (!rajada.length && ultimaMsg) rajada.push(String(ultimaMsg));
    return rajada;
}

/** O ÚLTIMO e-mail que o lead digitou na rajada (o mais novo vence: é a correção). */
function ultimoEmailDaRajada(historico = [], ultimaMsg = '') {
    const todos = rajadaDoLead(historico, ultimaMsg).flatMap(extrairEmails);
    return todos.length ? todos[todos.length - 1] : null;
}

/** A última mensagem é um "ops/errei" SEM e-mail novo? (a correção está a caminho: não efetivar com o antigo) */
function aguardandoCorrecao(ultimaMsg, historico = []) {
    if (extrairEmails(ultimaMsg).length) return false;
    if (!RE_CORRECAO.test(String(ultimaMsg || ''))) return false;
    return rajadaDoLead(historico, ultimaMsg).some(m => extrairEmails(m).length);
}

module.exports = { extrairEmails, emailValido, rajadaDoLead, ultimoEmailDaRajada, aguardandoCorrecao };
