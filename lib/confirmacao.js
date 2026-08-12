'use strict';
// lib/confirmacao.js — Classificador PURO da resposta do lead à confirmação de reunião.
// Sem I/O, sem LLM: heurística determinística em PT-BR. Testável via node --test.
// Usado SÓ para leads em confirmacao_status='pendente' (fluxo opt-in por tenant) — não
// substitui o routerAgent (compartilhado por todos os tenants), preservando o isolamento.

// Normaliza: minúsculas, sem acento, colapsa espaços. Mantém a lógica robusta a "confirmação"/"nao".
function _norm(s) {
    return (s || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos (marcas combinantes)
        .replace(/\s+/g, ' ')
        .trim();
}

// Sinais de que NÃO vai / quer remarcar. Checados ANTES do "sim" porque "não vou conseguir" contém "vou".
const NEGATIVOS = [
    /\bnao (vou|posso|consigo|dou conta|da pra mim|vai dar|conseguirei)\b/,
    /\bnao (poderei|estarei|participar)\b/,
    /\b(cancela|cancelar|cancelado|desmarca|desmarcar|remarca|remarcar|reagenda|reagendar|adiar|adia)\b/,
    /\b(outro dia|outra hora|outro horario|semana que vem|fica pra depois|deixa pra depois)\b/,
    /\b(nao vai dar|nao da|imprevisto|surgiu um imprevisto|nao consigo mais)\b/,
    /\binfelizmente\b/,
];

// Sinais de confirmação afirmativa.
const POSITIVOS = [
    /\b(sim|confirmo|confirmado|confirmar|confirmando|confirma)\b/,
    /\b(estarei|vou sim|vou estar|estou dentro|to dentro|to confirmado|pode contar comigo)\b/,
    /\b(pode ser|combinado|fechado|beleza|blz|ok|okay|certo|perfeito|isso mesmo|com certeza|claro)\b/,
    /\b(estarei la|te espero|vou participar|participarei|nos vemos|ate la)\b/,
    /^(s|👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|✅)$/,
];

/**
 * @param {string} texto  resposta do lead
 * @returns {'confirmado'|'desmarcado'|'indefinido'}
 */
function classificarConfirmacao(texto) {
    const t = _norm(texto);
    if (!t) return 'indefinido';

    // Negativos primeiro: "não vou conseguir" tem prioridade sobre qualquer "sim/ok" solto.
    for (const re of NEGATIVOS) if (re.test(t)) return 'desmarcado';
    for (const re of POSITIVOS) if (re.test(t)) return 'confirmado';
    return 'indefinido';
}

module.exports = { classificarConfirmacao, _norm };
