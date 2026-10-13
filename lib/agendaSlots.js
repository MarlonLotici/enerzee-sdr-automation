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
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random; // injetável p/ testes
    // 📅 DIA ALVO: se o lead pediu um dia específico ({ano,mes,dia} BRT), só gera slots DESSE dia
    // (respeita o dia pedido em vez de empurrar pro próximo livre). Vazio = "nesse dia não tenho".
    const diaAlvo = opts.diaAlvo || null;

    // 1) Coleta TODOS os livres da janela (não só os primeiros) pra poder ESPAÇAR a oferta.
    const livres = [];
    const base = _brt(agoraMs);
    const LIMITE = 80; // teto de coleta (segurança)
    const maxOffset = diaAlvo ? 8 : diasAdiante; // alcança qualquer dia da próxima semana quando há dia alvo

    for (let offset = 0; offset <= maxOffset && livres.length < LIMITE; offset++) {
        const alvo = _brt(_utcDeBRT(base.ano, base.mes, base.dia + offset, 12).getTime());
        if (diaAlvo && !(alvo.ano === diaAlvo.ano && alvo.mes === diaAlvo.mes && alvo.dia === diaAlvo.dia)) continue; // só o dia pedido
        if (!incluirFDS && (alvo.diaSemana === 0 || alvo.diaSemana === 6)) continue; // pula fim de semana

        for (let h = horaInicio; h + duracaoMin / 60 <= horaFim && livres.length < LIMITE; h += duracaoMin / 60) {
            const horaInt = Math.floor(h);
            const minInt = Math.round((h - horaInt) * 60);
            const ini = _utcDeBRT(alvo.ano, alvo.mes, alvo.dia, horaInt, minInt);
            const iniMs = ini.getTime();
            const fimMs = iniMs + duracaoMin * 60 * 1000;

            if (iniMs < agoraMs + antecedenciaMs) continue; // muito em cima / no passado
            if (_colide(iniMs, fimMs, ocupados)) continue;

            livres.push({
                inicioISO: ini.toISOString(),
                fimISO: new Date(fimMs).toISOString(),
                label: rotularSlotBRT(ini, agoraMs),
                _h: horaInt,
                _dia: `${alvo.ano}-${alvo.mes}-${alvo.dia}`,
            });
        }
    }

    // 2) Seleciona ESPAÇADOS + com variação ("ginga"): tira os campos internos antes de devolver.
    return _selecionarEspacados(livres, maxSlots, rng)
        .map(({ inicioISO, fimISO, label }) => ({ inicioISO, fimISO, label }));
}

/**
 * Escolhe `n` slots BEM ESPAÇADOS pra dar sensação REAL de escolha (ex.: "10h ou 14h"),
 * nunca fixos: primeiro tenta manhã + tarde do mesmo dia; senão espaça por um gap mínimo.
 * A variação vem do `rng` (Math.random em produção; determinístico nos testes). PURO.
 */
function _selecionarEspacados(livres, n, rng) {
    if (livres.length <= n) return livres;
    if (n === 2) {
        // (a) manhã + tarde no 1º dia que tiver os dois → "10h ou 14h"
        const porDia = new Map();
        for (const s of livres) { if (!porDia.has(s._dia)) porDia.set(s._dia, []); porDia.get(s._dia).push(s); }
        for (const doDia of porDia.values()) {
            const manha = doDia.filter((s) => s._h < 12);
            const tarde = doDia.filter((s) => s._h >= 13); // gap do almoço
            if (manha.length && tarde.length) {
                const a = manha[Math.floor(rng() * manha.length)];
                const b = tarde[Math.floor(rng() * tarde.length)];
                return [a, b].sort((x, y) => x.inicioISO.localeCompare(y.inicioISO));
            }
        }
        // (b) fallback: primeiro (com leve variação) + outro pelo menos 3h depois
        const GAP_MS = 3 * 60 * 60 * 1000;
        const janela = Math.min(3, livres.length);
        const primeiro = livres[Math.floor(rng() * janela)];
        const iniMs = new Date(primeiro.inicioISO).getTime();
        const cand = livres.filter((s) => new Date(s.inicioISO).getTime() >= iniMs + GAP_MS);
        if (cand.length) {
            const segundo = cand[Math.floor(rng() * cand.length)];
            return [primeiro, segundo].sort((x, y) => x.inicioISO.localeCompare(y.inicioISO));
        }
        return livres.slice(0, 2);
    }
    // n != 2: distribui de forma uniforme ao longo dos livres
    const passo = Math.max(1, Math.floor(livres.length / n));
    const out = [];
    for (let i = 0; i < livres.length && out.length < n; i += passo) out.push(livres[i]);
    return out;
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

// 📅 Detecta o DIA que o lead pediu ("quinta", "na terça", "amanhã", "hoje", "depois de amanhã",
// "segunda-feira") e devolve a data BRT da PRÓXIMA ocorrência: { ano, mes, dia, label } ou null.
// Dia da semana nomeado → próxima ocorrência futura (offset 1..7), nunca "hoje" (evita ambiguidade:
// quem diz "quinta" numa quinta quer a próxima). PURO.
const _WD_NOME = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const _WD_LABEL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function extrairDiaPedido(texto, agora = Date.now()) {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!t.trim()) return null;
    const base = _brt(agora);
    const dataEmOffset = (off) => _brt(_utcDeBRT(base.ano, base.mes, base.dia + off, 12).getTime());

    if (/\bdepois\s+de\s+amanha\b/.test(t)) { const d = dataEmOffset(2); return { ano: d.ano, mes: d.mes, dia: d.dia, label: 'depois de amanhã' }; }
    if (/\bamanha\b/.test(t))               { const d = dataEmOffset(1); return { ano: d.ano, mes: d.mes, dia: d.dia, label: 'amanhã' }; }
    if (/\bhoje\b/.test(t))                 { const d = dataEmOffset(0); return { ano: d.ano, mes: d.mes, dia: d.dia, label: 'hoje' }; }

    // "segunda" é ambíguo com "a segunda (opção)" / "2ª". Como DIA DA SEMANA, só conta se não
    // estiver no sentido de opção/ordinal (a menos que venha explícito "segunda-feira").
    const segundaEhOpcao = /\b(a\s+segunda|segunda\s*(op[cç]|alternativa|vez))/.test(t) && !/segunda\s*-?\s*feira/.test(t);
    for (const [nome, wd] of Object.entries(_WD_NOME)) {
        if (nome === 'segunda' && segundaEhOpcao) continue;
        if (new RegExp(`\\b${nome}(?:\\s*-?\\s*feira)?\\b`).test(t)) {
            for (let off = 1; off <= 7; off++) {
                const d = dataEmOffset(off);
                if (d.diaSemana === wd) return { ano: d.ano, mes: d.mes, dia: d.dia, label: _WD_LABEL[wd] };
            }
        }
    }
    return null;
}

module.exports = { calcularSlotsLivres, rotularSlotBRT, extrairDiaPedido, _brt, _utcDeBRT };
