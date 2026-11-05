'use strict';
/**
 * AVISO NO WHATSAPP DO DONO — lead novo / reunião agendada chegam no celular de quem cuida da conta
 * (pedido 2026-11-05: o Marlon só soube do 1º lead do anúncio dias depois).
 *
 * Regra da Meta: o número oficial só manda TEXTO LIVRE pra quem escreveu pra ele nas últimas 24h.
 * Fora disso, só um MODELO (template) aprovado entrega. Por isso o aviso vai:
 *   - como texto, se o dono falou com o número nas últimas 24h (grátis);
 *   - como template (se configurado), fora da janela.
 * Puro (sem I/O): só monta textos/decide. O envio fica no 4_sdr.js.
 */

const JANELA_24H_MS = 23.5 * 60 * 60 * 1000; // margem de 30 min antes da janela fechar

/** "46999201690" / "+55 (46) 99920-1690" → "5546999201690". Vazio/inválido → null. */
function normalizarNumeroAviso(valor) {
    let d = String(valor || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 10 || d.length === 11) d = '55' + d; // DDD + número, sem DDI
    return d.length >= 12 && d.length <= 13 ? d : null;
}

// Celular BR com/sem o 9º dígito é o MESMO número (a Meta às vezes entrega sem o 9).
function _chaveCelularBR(valor) {
    let d = String(valor || '').replace(/@.*/, '').replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (d.length === 13 && d.startsWith('55') && d[4] === '9') d = d.slice(0, 4) + d.slice(5);
    return d;
}

/** O lead é o próprio dono (ex.: testes do Marlon no número pessoal)? Aí não avisa. */
function ehNumeroDoDono(jidLead, numeroDono) {
    if (!jidLead || !numeroDono) return false;
    return _chaveCelularBR(jidLead) === _chaveCelularBR(numeroDono);
}

function dentroDaJanela24h(ultimaMsgDoDonoIso, agora = Date.now()) {
    if (!ultimaMsgDoDonoIso) return false;
    const t = new Date(ultimaMsgDoDonoIso).getTime();
    return Number.isFinite(t) && agora - t < JANELA_24H_MS;
}

// Parâmetro de template da Meta: sem quebra de linha/tab e sem 4+ espaços seguidos (senão é rejeitado).
const _param = (t, max = 300) => String(t || '-').replace(/\s+/g, ' ').trim().slice(0, max) || '-';

const _telefoneLegivel = (jid) => {
    const d = String(jid || '').replace(/@.*/, '').replace(/\D/g, '');
    return d.startsWith('55') ? `+${d}` : d;
};

function montarAvisoNovoLead({ nome, jid, origem, primeiraMsg } = {}) {
    const titulo = `Lead novo: ${_param(nome || 'sem nome', 60)}`;
    const detalhes = `${_telefoneLegivel(jid)} · origem: ${_param(origem || 'WhatsApp', 80)} · 1ª msg: "${_param(primeiraMsg, 160)}"`;
    return {
        titulo,
        texto: `🔔 *${titulo}*\n📱 ${_telefoneLegivel(jid)}\n📣 Origem: ${origem || 'WhatsApp'}\n💬 "${String(primeiraMsg || '').slice(0, 300)}"\n\nA Sofia já está atendendo. Veja no painel.`,
        params: [titulo, detalhes],
    };
}

function montarAvisoReuniao({ nome, jid, quando } = {}) {
    const titulo = `Reunião agendada: ${_param(nome || 'lead', 60)}`;
    const detalhes = `${_param(quando, 60)} · ${_telefoneLegivel(jid)}`;
    return {
        titulo,
        texto: `📅 *${titulo}*\n🕒 ${quando || '-'}\n📱 ${_telefoneLegivel(jid)}\n\nO convite e o link já foram enviados ao lead.`,
        params: [titulo, detalhes],
    };
}

module.exports = {
    JANELA_24H_MS, normalizarNumeroAviso, ehNumeroDoDono, dentroDaJanela24h,
    montarAvisoNovoLead, montarAvisoReuniao,
};
