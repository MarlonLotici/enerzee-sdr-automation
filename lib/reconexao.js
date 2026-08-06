'use strict';
// lib/reconexao.js — Função PURA de backoff de reconexão (sem I/O). Testável isoladamente.

// Backoff quadrático com jitter, teto de 60s. Faz as 10 tentativas cobrirem tempo real
// suficiente pra não brickar um chip por soluço transitório do WhatsApp/proxy.
function calcularBackoffReconexao(tentativas) {
    return Math.min(5000 * (tentativas ** 2) + Math.floor(Math.random() * 5000), 60000);
}

module.exports = { calcularBackoffReconexao };
