'use strict';
/**
 * lib/llmContext.js — Contexto ambiente do "fluxo" de LLM (qual tenant está gastando).
 *
 * Problema: o gasto de LLM acontece em vários lugares (os 8 agentes + o cérebro do
 * 4_sdr.js), e os agentes não recebem `userId` na assinatura. Threadar userId por
 * todas as assinaturas seria invasivo. Em vez disso, usamos AsyncLocalStorage: o
 * worker (ou o cérebro) chama `definirTenantLLM(userId)` assim que sabe de quem é a
 * conversa, e o adaptador `chamarLLM` lê `tenantLLMAtual()` pra contabilizar o gasto
 * no budgetGuard — sem tocar em nenhum agente.
 *
 * Usa `enterWith` (não `run`) de propósito: o userId só é conhecido no MEIO do
 * handler do worker (depois de buscar o lead), então setamos a partir dali pro
 * resto da cadeia async daquele job. Cada job do BullMQ é uma raiz async própria →
 * um job não vaza contexto pro outro, mesmo com concorrência.
 *
 * PURO: sem Redis, sem I/O — seguro pra `require` de qualquer lugar (inclusive testes).
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const _als = new AsyncLocalStorage();

/** Marca o tenant dono do fluxo atual. No-op se userId vazio. */
function definirTenantLLM(userId) {
    if (userId) _als.enterWith({ userId: String(userId) });
}

/** Retorna { userId } do fluxo atual, ou null se não houver contexto. */
function tenantLLMAtual() {
    return _als.getStore() || null;
}

module.exports = { definirTenantLLM, tenantLLMAtual };
