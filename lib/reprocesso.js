'use strict';
/**
 * Mensagem que chegou ENQUANTO a IA processava a anterior precisa ser respondida.
 *
 * Bug 2026-11-14 (Haislann): duas travas se anulavam e o lead ficou no vácuo.
 *  1) o job da mensagem nova era descartado ("já em processamento — job duplicado ignorado");
 *  2) o job em andamento descartava a PRÓPRIA resposta ("[ANTI-DUP] chegou msg nova — abortando"),
 *     contando que o job da msg nova responderia. Mas esse job já tinha sido descartado em (1).
 * Agora, ao terminar, o job confere se ficou mensagem do lead sem resposta e enfileira um job novo.
 */

/**
 * @param {{role?:string, created_at?:string}|null} ultima  última mensagem da conversa
 * @param {number} inicioJobMs  quando o job que está terminando começou
 * @param {number} folgaMs
 * @returns {boolean} true se há mensagem do lead que chegou depois do início do job e ficou sem resposta
 */
function precisaReprocessar(ultima, inicioJobMs, folgaMs = 1000) {
    if (!ultima || ultima.role !== 'user' || !ultima.created_at) return false;
    const t = Date.parse(ultima.created_at);
    return Number.isFinite(t) && t > inicioJobMs - folgaMs;
}

module.exports = { precisaReprocessar };
