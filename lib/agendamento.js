'use strict';
/**
 * lib/agendamento.js — Detecção PURA de qual slot o lead confirmou.
 *
 * A IA propõe 2 horários (slots com label "hoje às 10h", "amanhã às 15h"...). O lead
 * responde de forma livre ("o primeiro", "pode ser 15h", "amanhã tá bom", "o de 10"...).
 * Esta função devolve o slot escolhido ou null (ambíguo/negou). Sem I/O — testável.
 */

function _norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Extrai a hora (inteiro 0-23) do label "amanhã às 15h" / "hoje às 10h30".
function _horaDoLabel(label) {
    const m = _norm(label).match(/as\s+(\d{1,2})h/);
    return m ? parseInt(m[1], 10) : null;
}

// Todas as horas mencionadas na mensagem do lead: "15h", "as 10", "10 horas", "10:30".
function _horasNaMensagem(msg) {
    const t = _norm(msg);
    const horas = new Set();
    const re = /\b(\d{1,2})\s*(?:h|hs|horas|:\d{2})?\b/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        const h = parseInt(m[1], 10);
        // Só considera como HORA se veio com marcador de hora, ou se é um número plausível de horário.
        const trecho = m[0];
        if (/h|hora|:/.test(trecho) || (h >= 7 && h <= 21)) horas.add(h);
    }
    return horas;
}

/**
 * @param {string} mensagem            última mensagem do lead
 * @param {Array<{inicioISO,fimISO,label}>} slots  slots propostos (ordem = 1º, 2º)
 * @returns {{inicioISO,fimISO,label}|null}
 */
function detectarConfirmacaoSlot(mensagem, slots) {
    if (!Array.isArray(slots) || !slots.length) return null;
    const t = _norm(mensagem);
    if (!t.trim()) return null;

    // Recusa explícita → não confirma nada.
    if (/\b(nao|não|nenhum|outro dia|outro horario|nao pode|remarcar|depois eu vejo)\b/.test(t)) return null;

    // 1) Ordinal / posição.
    if (/\b(1o|1|primeiro|primeira|o de cima|a primeira)\b/.test(t)) return slots[0];
    if (slots[1] && /\b(2o|2|segundo|segunda|o de baixo|a segunda|o outro|a outra)\b/.test(t)) return slots[1];

    // 2) Hora explícita que bate com o label de um slot.
    const horas = _horasNaMensagem(t);
    if (horas.size) {
        for (const s of slots) {
            const h = _horaDoLabel(s.label);
            if (h != null && horas.has(h)) return s;
        }
    }

    // 3) "amanhã"/"hoje" quando só um slot é daquele dia.
    const querAmanha = /\bamanha\b/.test(t);
    const querHoje = /\bhoje\b/.test(t);
    if (querAmanha || querHoje) {
        const alvo = querAmanha ? 'amanha' : 'hoje';
        const daquele = slots.filter((s) => _norm(s.label).includes(alvo));
        if (daquele.length === 1) return daquele[0];
    }

    return null; // ambíguo — a IA deve reperguntar de novo
}

module.exports = { detectarConfirmacaoSlot };
