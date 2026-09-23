'use strict';
// lib/agendaDecisao.js — Decisão PURA de "devo propor/seguir com agendamento?".
// Extraída de 4_sdr.js (orquestrarAgendamento) pra ser testável. Sem I/O.
//
// Regra (idêntica à de produção): a orquestração só age quando há UM sinal real:
//   - o lead já tem slots propostos (conversa de agendamento em curso), OU
//   - intenção de COMPRA (aceite), OU
//   - o texto pede agendar (querAgendar), OU
//   - o lead já está no estágio de agenda (>=4) E a msg NÃO é saudação pura.
// O guard da saudação pura evita o bug clássico: um "oi" (com estágio herdado de
// outro chip) NÃO pode fazer a IA oferecer horário de cara.

const RE_QUER_AGENDAR = /\b(agendar|agende|marcar|marca[r]?\s+uma|remarcar|reuni[aã]o|hor[aá]rio|hor[aá]rios|dispon[ií]ve(l|is)|que\s+dia|que\s+horas|quando|amanh[aã]|hoje|depois\s+de\s+amanh[aã]|semana\s+que\s+vem|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|pode\s+ser|podemos\s+marcar|vamos\s+marcar)\b/i;

const RE_SAUDACAO_PURA = /^\s*(oi+|ol[áa]|opa|e?\s*a[íi]|bom\s+dia|boa\s+(tarde|noite)|hey|hi|ola|menu)[\s!.,?]*$/i;

function querAgendar(texto) {
    return RE_QUER_AGENDAR.test(texto || '');
}

function ehSaudacaoPura(texto) {
    return RE_SAUDACAO_PURA.test(String(texto || '').trim());
}

// Retorna true se a orquestração de agendamento DEVE seguir (propor/efetivar).
function deveProporAgendamento({ texto, intencao, currentStage = 0, temSlots = false } = {}) {
    if (temSlots) return true;
    if (intencao === 'COMPRA') return true;
    if (querAgendar(texto)) return true;
    const prontoPraAgendar = (currentStage || 0) >= 4 && !ehSaudacaoPura(texto);
    return prontoPraAgendar;
}

module.exports = { querAgendar, ehSaudacaoPura, deveProporAgendamento, RE_QUER_AGENDAR, RE_SAUDACAO_PURA };
