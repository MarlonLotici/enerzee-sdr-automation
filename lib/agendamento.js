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

// Extrai hora E MINUTO do label "amanhã às 15h" / "hoje às 10h30" → { h, m }.
// (Antes só pegava a hora → "9h" e "9h30" viravam iguais e o lead que pedia 9:30 caía no 9h.)
function _horarioDoLabel(label) {
    const m = _norm(label).match(/as\s+(\d{1,2})h(\d{2})?/);
    return m ? { h: parseInt(m[1], 10), m: m[2] != null ? parseInt(m[2], 10) : 0 } : null;
}

// Todos os horários mencionados na mensagem do lead, COM minutos: "15h", "as 10",
// "10 horas", "10:30", "9h30" → [{ h, m }, ...].
function _horariosNaMensagem(msg) {
    const t = _norm(msg);
    const out = [];
    const re = /\b(\d{1,2})\s*(?:h|hs|horas|:)?\s*(\d{2})?\b/g;
    let m;
    while ((m = re.exec(t)) !== null) {
        const trecho = m[0];
        const h = parseInt(m[1], 10);
        const min = m[2] != null ? parseInt(m[2], 10) : 0;
        const temMarcador = /[h:]/.test(trecho);
        // Só conta como horário se tem marcador (h/:) OU é um número plausível de hora comercial.
        if (!(temMarcador || (h >= 7 && h <= 21))) continue;
        if (h > 23 || min > 59) continue;
        out.push({ h, m: min });
    }
    return out;
}

/**
 * @param {string} mensagem            última mensagem do lead
 * @param {Array<{inicioISO,fimISO,label}>} slots  slots propostos (ordem = 1º, 2º)
 * @param {string} [ultimaMsgIA]       última mensagem DA IA (opcional) — usada só pra resolver
 *                                     afirmação genérica ("pode ser", "ok") quando a IA tinha
 *                                     acabado de citar um horário específico (ver passo 4 abaixo).
 * @returns {{inicioISO,fimISO,label}|null}
 */
function detectarConfirmacaoSlot(mensagem, slots, ultimaMsgIA) {
    if (!Array.isArray(slots) || !slots.length) return null;
    const t = _norm(mensagem);
    if (!t.trim()) return null;

    // Recusa explícita → não confirma nada.
    if (/\b(nao|não|nenhum|outro dia|outro horario|nao pode|remarcar|depois eu vejo)\b/.test(t)) return null;

    // 1) Ordinal / posição.
    // "segunda"/"a segunda" ficam de FORA de propósito: em pt-BR "segunda" também é dia da semana
    // (segunda-feira). Tratar como ordinal "2ª opção" causava risco real de marcar o DIA ERRADO
    // quando o lead dizia "pode ser segunda" (bug encontrado em teste real 2026-10-09).
    if (/\b(1o|1|primeiro|primeira|o de cima|a primeira)\b/.test(t)) return slots[0];
    if (slots[1] && /\b(2o|2|segundo|o de baixo|o outro|a outra)\b/.test(t)) return slots[1];

    // 2) Horário explícito que bate com o label de um slot — HORA + MINUTO.
    const pedidos = _horariosNaMensagem(t);
    if (pedidos.length) {
        // (a) match exato hora+minuto ("9:30" → slot 9h30, não 9h).
        for (const s of slots) {
            const sl = _horarioDoLabel(s.label);
            if (sl && pedidos.some((p) => p.h === sl.h && p.m === sl.m)) return s;
        }
        // (b) só a hora (sem minuto): aceita apenas se UM único slot tem aquela hora
        //     (se dois slots são da mesma hora, ex.: 9h e 9h30, é ambíguo → não chuta).
        for (const s of slots) {
            const sl = _horarioDoLabel(s.label);
            if (!sl) continue;
            const pediuSoHora = pedidos.some((p) => p.h === sl.h && p.m === 0);
            const mesmaHora = slots.filter((x) => { const xl = _horarioDoLabel(x.label); return xl && xl.h === sl.h; });
            if (pediuSoHora && mesmaHora.length === 1) return s;
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

    // 4) Afirmação GENÉRICA ("pode ser", "ok", "beleza"...) sem número/ordinal — só aceita se a
    // IA, na mensagem ANTERIOR, tinha citado um horário específico que bate com UM único slot.
    // Sem isso, "pode ser" virava null → a IA caía em conversa livre e inventava ("deixa eu ver
    // os horários aqui pra você"), travando o agendamento (bug observado em teste real
    // 2026-10-09: lead aceitou "segunda às 14h30" com um "Pode ser" solto e a IA alucinou).
    // Mensagem curta de propósito (≤4 palavras) — evita casar "sim" dentro de frase longa/alheia.
    const ehAfirmacaoGenerica = t.split(/\s+/).filter(Boolean).length <= 4
        && /\b(pode ser|pode sim|ok|okay|beleza|fechado|combinado|confirmo|confirmado|isso mesmo|perfeito|show|bora|topo|vamos|certeza|sim|isso)\b/.test(t);
    if (ehAfirmacaoGenerica && ultimaMsgIA) {
        const horariosNaIA = _horariosNaMensagem(ultimaMsgIA);
        if (horariosNaIA.length) {
            const candidatos = slots.filter((s) => {
                const sl = _horarioDoLabel(s.label);
                return sl && horariosNaIA.some((p) => p.h === sl.h && p.m === sl.m);
            });
            if (candidatos.length === 1) return candidatos[0];
        }
    }

    return null; // ambíguo — a IA deve reperguntar de novo
}

/**
 * Extrai o horário específico que o lead PEDIU (mesmo que não seja um dos ofertados).
 * Ex.: "quero as 14h" → { h:14, m:0 }; "pode ser 9:30" → { h:9, m:30 }. null se nenhum.
 * Usado pra, em vez de loopar nos 2 slots, checar o horário pedido na agenda de verdade.
 */
function extrairHorarioPedido(mensagem) {
    const hs = _horariosNaMensagem(mensagem);
    return hs.length ? hs[0] : null;
}

module.exports = { detectarConfirmacaoSlot, extrairHorarioPedido };
