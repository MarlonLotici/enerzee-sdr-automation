'use strict';
// lib/agendaDecisao.js — Decisão PURA de "devo propor/seguir com agendamento?".
// Extraída de 4_sdr.js (orquestrarAgendamento) pra ser testável. Sem I/O.
//
// ROTEIRO (espinha dorsal do SDR): rapport → SPIN (descobrir a dor) → explicar a solução
// → PERGUNTAR se faz sentido uma reunião → só então PROPOR horário. Por isso a proposta de
// horário NÃO dispara só por "estágio alto": exige um sinal REAL de agendamento:
//   - já há slots propostos (conversa de agenda em curso), OU
//   - o texto PEDE agendar (querAgendar — dia/horário/semana/disponibilidade), OU
//   - a IA CONVIDOU pra reunião na última fala E o lead TOPOU agora (aceitouConvite + afirmativo), OU
//   - intenção de COMPRA (aceite explícito detectado pelo roteador), fora de saudação pura.
// Removido o gatilho "currentStage>=4 em qualquer msg não-saudação": era o que fazia a IA
// propor horário quando o lead só respondia uma pergunta de qualificação (ex.: "30 minutos").

const RE_QUER_AGENDAR = /\b(agendar|agende|marcar|marca[r]?\s+uma|remarcar|reuni[aã]o|hor[aá]rio|hor[aá]rios|dispon[ií]ve(l|is)|disponibilidade|que\s+dia|que\s+horas|quando|amanh[aã]|hoje|depois\s+de\s+amanh[aã]|(essa|esta|nessa|nesta)\s+semana|semana\s+que\s+vem|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|pode\s+ser|podemos\s+marcar|vamos\s+marcar)\b/i;

const RE_SAUDACAO_PURA = /^\s*(oi+|ol[áa]|opa|e?\s*a[íi]|bom\s+dia|boa\s+(tarde|noite)|hey|hi|ola|menu)[\s!.,?]*$/i;

// Afirmativo curto ("sim", "bora", "pode ser", "quero", "faz sentido"...). Usado só em par com
// um convite de reunião anterior — sozinho não propõe nada.
const RE_AFIRMATIVO = /^\s*(sim|isso|claro|bora|vamos|vamo|pode(mos)?\s*(ser|sim)?|quero|queria|gostaria|adoraria|com\s+certeza|perfeito|fechado|fecha|topo|aceito|faz\s+sentido|show|beleza|blz|ok|okay|uhum|aham|tá|ta\s+bom|positivo|por\s+favor)\b/i;

// A IA convidou pra reunião/call na fala anterior? ("faz sentido uma call?", "podemos marcar...").
const RE_CONVITE_REUNIAO = /(faz\s+sentido|vale\s+a\s+pena|que\s+tal|topa|podemos|poder[íi]amos|bora)\b[^?]*\b(reuni[aã]o|call|conversa|bate[-\s]?papo|demonstra|apresenta|papo|15\s*min|30\s*min)/i;

function querAgendar(texto) {
    return RE_QUER_AGENDAR.test(texto || '');
}

function ehSaudacaoPura(texto) {
    return RE_SAUDACAO_PURA.test(String(texto || '').trim());
}

function ehAfirmativo(texto) {
    return RE_AFIRMATIVO.test(String(texto || '').trim());
}

// Olha a ÚLTIMA fala da IA no histórico: ela convidou pra reunião?
function convidouReuniaoAntes(historico = []) {
    for (let i = historico.length - 1; i >= 0; i--) {
        if (historico[i]?.role === 'assistant') {
            return RE_CONVITE_REUNIAO.test(String(historico[i].content || ''));
        }
    }
    return false;
}

// Conveniência pro caller: "a IA convidou e o lead está topando agora?"
function aceitouConviteDeReuniao(historico, texto) {
    return convidouReuniaoAntes(historico) && ehAfirmativo(texto);
}

// Retorna true se a orquestração de agendamento DEVE seguir (propor/efetivar).
function deveProporAgendamento({ texto, intencao, currentStage = 0, temSlots = false, aceitouConvite = false } = {}) {
    if (temSlots) return true;                                   // conversa de agenda já em curso
    if (ehSaudacaoPura(texto)) return false;                     // "oi" nunca propõe (estágio herdado)
    if (querAgendar(texto)) return true;                         // pediu explicitamente
    if (aceitouConvite && ehAfirmativo(texto)) return true;      // IA convidou e o lead topou
    // COMPRA (aceite pelo roteador) só propõe DEPOIS de qualificar (estágio>=3): evita a IA ser
    // "afoita" e pular pro horário quando o lead só confirmou uma dor ("às vezes sim") no início.
    if (intencao === 'COMPRA' && (currentStage || 0) >= 3) return true;
    return false;                                                // não propõe antes de explorar a dor/solução
}

module.exports = {
    querAgendar, ehSaudacaoPura, ehAfirmativo,
    convidouReuniaoAntes, aceitouConviteDeReuniao, deveProporAgendamento,
    RE_QUER_AGENDAR, RE_SAUDACAO_PURA, RE_AFIRMATIVO, RE_CONVITE_REUNIAO,
};
