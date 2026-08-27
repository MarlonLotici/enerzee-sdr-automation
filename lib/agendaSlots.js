'use strict';
/**
 * lib/agendaSlots.js — Cálculo PURO de horários livres na agenda (testável).
 *
 * Recebe os intervalos OCUPADOS (do Google free/busy) + o horário comercial do tenant,
 * e devolve os próximos N slots livres, já rotulados em português-BR (fuso BRT = UTC-3 fixo;
 * o Brasil não usa mais horário de verão). Sem I/O — a integração com o Google fica no
 * integrations/googleCalendar.js e só usa estas funções puras.
 */

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // BRT = UTC-3
const DIA_MS = 24 * 60 * 60 * 1000;

const _DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// Componentes de data no fuso BRT a partir de um instante (Date/ISO/ms).
function _brt(instante) {
    const d = new Date(new Date(instante).getTime() - BRT_OFFSET_MS);
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(), hora: d.getUTCHours(), min: d.getUTCMinutes(), diaSemana: d.getUTCDay() };
}

// Instante UTC (Date) de um horário BRT (ano/mes/dia/hora/min).
function _utcDeBRT(ano, mes, dia, hora, min = 0) {
    return new Date(Date.UTC(ano, mes, dia, hora, min, 0) + BRT_OFFSET_MS);
}

// true se [ini,fim) colide com algum intervalo ocupado.
function _colide(iniMs, fimMs, ocupados) {
    return ocupados.some((o) => {
        const oi = new Date(o.inicio).getTime();
        const of = new Date(o.fim).getTime();
        return iniMs < of && oi < fimMs; // sobreposição
    });
}

/**
 * Próximos slots livres.
 * @param {object} opts
 * @param {Date|string|number} [opts.agora]   instante de referência (default: now)
 * @param {Array<{inicio,fim}>} [opts.ocupados] intervalos ocupados (ISO/Date)
 * @param {number} [opts.diasAdiante=5]  quantos dias olhar à frente
 * @param {number} [opts.horaInicio=9]   início do expediente (BRT)
 * @param {number} [opts.horaFim=18]     fim do expediente (BRT) — último slot termina até aqui
 * @param {number} [opts.duracaoMin=30]  duração de cada reunião
 * @param {number} [opts.maxSlots=2]     quantos slots retornar
 * @param {number} [opts.antecedenciaMin=120] só oferece slots com pelo menos X min de antecedência
 * @param {boolean} [opts.incluirFimDeSemana=false]
 * @returns {Array<{inicioISO,fimISO,label}>}
 */
function calcularSlotsLivres(opts = {}) {
    const agoraMs = new Date(opts.agora || Date.now()).getTime();
    const ocupados = Array.isArray(opts.ocupados) ? opts.ocupados : [];
    const diasAdiante = opts.diasAdiante ?? 5;
    const horaInicio = opts.horaInicio ?? 9;
    const horaFim = opts.horaFim ?? 18;
    const duracaoMin = opts.duracaoMin ?? 30;
    const maxSlots = opts.maxSlots ?? 2;
    const antecedenciaMs = (opts.antecedenciaMin ?? 120) * 60 * 1000;
    const incluirFDS = opts.incluirFimDeSemana === true;

    const slots = [];
    const base = _brt(agoraMs);

    for (let offset = 0; offset <= diasAdiante && slots.length < maxSlots; offset++) {
        // Dia BRT alvo
        const alvo = _brt(_utcDeBRT(base.ano, base.mes, base.dia + offset, 12).getTime());
        if (!incluirFDS && (alvo.diaSemana === 0 || alvo.diaSemana === 6)) continue; // pula fim de semana

        for (let h = horaInicio; h + duracaoMin / 60 <= horaFim && slots.length < maxSlots; h += duracaoMin / 60) {
            const horaInt = Math.floor(h);
            const minInt = Math.round((h - horaInt) * 60);
            const ini = _utcDeBRT(alvo.ano, alvo.mes, alvo.dia, horaInt, minInt);
            const iniMs = ini.getTime();
            const fimMs = iniMs + duracaoMin * 60 * 1000;

            if (iniMs < agoraMs + antecedenciaMs) continue; // muito em cima / no passado
            if (_colide(iniMs, fimMs, ocupados)) continue;

            slots.push({
                inicioISO: ini.toISOString(),
                fimISO: new Date(fimMs).toISOString(),
                label: rotularSlotBRT(ini, agoraMs),
            });
        }
    }
    return slots;
}

/**
 * Rótulo humano do slot em BRT: "hoje às 14h", "amanhã às 10h30", "qua às 15h".
 * PURO.
 */
function rotularSlotBRT(instante, agora = Date.now()) {
    const s = _brt(instante);
    const a = _brt(agora);
    const diffDias = Math.round(
        (_utcDeBRT(s.ano, s.mes, s.dia, 12).getTime() - _utcDeBRT(a.ano, a.mes, a.dia, 12).getTime()) / DIA_MS
    );
    const quando = diffDias === 0 ? 'hoje' : diffDias === 1 ? 'amanhã' : _DIAS_SEMANA[s.diaSemana];
    const hora = s.min === 0 ? `${s.hora}h` : `${s.hora}h${String(s.min).padStart(2, '0')}`;
    return `${quando} às ${hora}`;
}

module.exports = { calcularSlotsLivres, rotularSlotBRT };
