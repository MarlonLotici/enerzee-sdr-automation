'use strict';
// lib/observabilidade.js — Buffer em memória dos erros recentes do servidor (puro, testável).
// Objetivo: você ENXERGAR a produção sem depender do cliente avisar. O server.js registra
// aqui os erros (rotas, crashes, rejeições) e expõe os últimos ao dono no /api/health.

const MAX = 50; // guarda só os últimos N — é diagnóstico, não log persistente.
const _erros = [];

function registrarErro(origem, err) {
    const msg = (err && err.message) ? err.message : String(err ?? 'erro desconhecido');
    const stack = (err && err.stack) ? String(err.stack).split('\n').slice(1, 3).join(' | ') : '';
    _erros.push({
        ts: Date.now(),
        origem: String(origem || '?').slice(0, 60),
        msg: String(msg).slice(0, 300),
        stack: stack.slice(0, 400),
    });
    if (_erros.length > MAX) _erros.splice(0, _erros.length - MAX);
    return _erros.length;
}

function errosRecentes(n = 20) {
    return _erros.slice(-n).reverse(); // mais novo primeiro
}

function contarUltimaHora() {
    const corte = Date.now() - 3600000;
    return _erros.filter(e => e.ts >= corte).length;
}

function resumoErros() {
    return { total: _erros.length, ultimaHora: contarUltimaHora(), ultimo: _erros[_erros.length - 1] || null };
}

function _limpar() { _erros.length = 0; } // só para testes

module.exports = { registrarErro, errosRecentes, contarUltimaHora, resumoErros, _limpar, MAX };
