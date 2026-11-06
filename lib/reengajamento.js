'use strict';
/**
 * REENGAJAMENTO de quem sumiu (lead que ESCREVEU PRIMEIRO, a Sofia respondeu e ele não falou mais):
 *   1) lembrete: 45 min depois da nossa última fala → "Fulano, estou aqui pra te ajudar... consegue falar agora…?"
 *   2) despedida: ~22 h depois da última mensagem DELE → "Fulano, respeito seu tempo e decisão… ótima semana!"
 *
 * Por que 22h e não "depois": a Meta só deixa o número mandar TEXTO LIVRE dentro de 24h da última mensagem do
 * lead (janela de atendimento). Passou disso, só template aprovado. Então a despedida sai entre 22h e 23,5h e,
 * se o servidor perder essa hora, NÃO manda (melhor calar do que tentar e a Meta recusar / contar como erro).
 *
 * Tudo aqui é PURO (sem banco/rede): decide e monta o texto. O varredor (lib/reengajamentoLoop.js) cuida do I/O.
 */

const H = 3600 * 1000;
const MIN = 60 * 1000;
const JANELA_SERVICO_MS = 23.5 * H;   // margem de 30 min antes da janela de 24h fechar

const CONFIG_PADRAO = {
    lembreMin: 45,        // minutos de silêncio depois da nossa última fala
    lembreMaxH: 20,       // depois disso o lembrete perde o sentido (a despedida de 22h já vem aí)
    despedidaH: 22,       // horas desde a última mensagem do LEAD
    horaInicio: 8,        // só manda de 08:00…
    horaFim: 21,          // …até 20:59 (horário de Brasília): ninguém quer ser cutucado às 3h da manhã
    humanoRecenteH: 24,   // se uma pessoa da equipe falou nesse período, a conversa é dela: a IA não cutuca
};

const FUSO = 'America/Sao_Paulo';

function horaEmBrasilia(ms) {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hour: 'numeric', hour12: false }).format(new Date(ms));
    return Number(h) % 24; // "24" em alguns ambientes = meia-noite
}
function diaDaSemanaEmBrasilia(ms) {
    const d = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(new Date(ms));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d); // 0 = domingo
}
function dentroDoHorario(ms, cfg = CONFIG_PADRAO) {
    const h = horaEmBrasilia(ms);
    return h >= cfg.horaInicio && h < cfg.horaFim;
}

const _norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Recusa EXPLÍCITA (mais ampla que o opt-out de LGPD): quem disse isso NUNCA recebe cutucada.
// Na dúvida, calar: perder um lembrete custa pouco; insistir com quem recusou custa a credibilidade.
const RECUSA_REGEX = /\b(nao (tenho|tem|temos|vejo|ha) (mais )?(interesse|necessidade|orcamento|como)|sem (interesse|necessidade|orcamento)|nao (me|nos) interessa|nao (preciso|precisamos|quero|queremos|vou querer|vamos querer|vou precisar|vamos precisar|vou contratar|vamos contratar)|nao e (pra|para) (mim|nos)|nao faz sentido|nao obrigad[oa]|dispenso|dispensamos|agora nao|ja (tenho|temos|uso|usamos|contratei|contratamos)|deixa pra la|desisti|(pode|podem) (encerrar|cancelar|arquivar)|nao autorizo|nao me chame|nao (entre|entrem) em contato)\b/;

// Rastro de reunião já marcada na conversa (se o status do lead falhou em refletir).
const AGENDAMENTO_REGEX = /(reuniao|call|conversa|encontro|horario)[^.!?\n]{0,60}(confirmad|agendad|marcad)|(confirmad|agendad|marcad)[^.!?\n]{0,60}(reuniao|call|conversa|encontro|dia \d|as \d|\d ?h)|meet\.google\.com|calendar\.google\.com|\[agendamento|convite (enviado|da agenda)/;

/** Última mensagem do lead que NÃO é autoresposta (índice na lista, que vem da mais nova pra mais antiga). */
function indiceUltimoInbound(mensagens = []) {
    return mensagens.findIndex(m => m?.role === 'user');
}

/**
 * Texto do lembrete / da despedida. `override` = texto personalizado do cliente (com {nome}).
 * Sem nome da pessoa, a frase sai sem o vocativo (nunca "undefined, estou aqui…").
 */
function montarTexto(tipo, { nome = '', agora = Date.now(), override = null } = {}) {
    const n = String(nome || '').trim();
    if (override && String(override).trim()) {
        let t = String(override);
        t = n ? t.replace(/\{nome\}/gi, n) : t.replace(/\{nome\}[,:;!\s]*/gi, '');
        t = t.replace(/\s{2,}/g, ' ').trim();
        return t.charAt(0).toUpperCase() + t.slice(1);
    }
    if (tipo === 'lembrete') {
        return n
            ? `${n}, estou aqui pra te ajudar... consegue falar agora e testar como funciono?`
            : 'Oi! Estou aqui pra te ajudar... consegue falar agora e testar como funciono?';
    }
    const dia = diaDaSemanaEmBrasilia(agora);
    const desejo = (dia === 5 || dia === 6) ? 'um ótimo fim de semana' : 'uma ótima semana'; // sex/sáb → fim de semana
    return n
        ? `${n}, respeito seu tempo e decisão, mas saiba que estou aqui se quiser conversar! Desejo ${desejo}!`
        : `Respeito seu tempo e decisão, mas saiba que estou aqui se quiser conversar! Desejo ${desejo}!`;
}

/**
 * Decide o que fazer com UM lead.
 * @param {object} p
 * @param {object} p.lead       { status, is_paused, manual_pause }
 * @param {object} p.instancia  { reengajamento_ativo }
 * @param {Array}  p.mensagens  da MAIS NOVA pra mais antiga: [{ role: 'user'|'assistant'|'human_operator', content, created_at }]
 * @param {{lembrete:boolean, despedida:boolean}} p.flags  o que já foi enviado neste período de silêncio
 * @param {number} p.agora      ms
 * @param {RegExp} [p.optOutRegex]
 * @returns {{ acao: 'lembrete'|'despedida'|'nenhuma', motivo?: string, inboundEm?: number }}
 */
function decidirReengajamento({ lead, instancia, mensagens = [], flags = {}, agora = Date.now(), optOutRegex = null, config = {} } = {}) {
    const cfg = { ...CONFIG_PADRAO, ...config };
    const nao = (motivo) => ({ acao: 'nenhuma', motivo });

    if (!instancia?.reengajamento_ativo) return nao('desligado');
    if (!lead || lead.status !== 'contact') return nao('status');
    if (lead.is_paused || lead.manual_pause) return nao('pausado');
    if (!mensagens.length) return nao('sem_mensagens');

    const ultima = mensagens[0];
    if (ultima.role === 'user') return nao('lead_respondeu');
    if (ultima.role === 'human_operator') return nao('humano_falou');

    // uma pessoa da equipe falou nesta conversa há pouco? então é ela quem decide quando cutucar
    const limiteHumano = agora - cfg.humanoRecenteH * H;
    if (mensagens.some(m => m.role === 'human_operator' && Date.parse(m.created_at) >= limiteHumano)) return nao('humano_na_conversa');

    const iIn = indiceUltimoInbound(mensagens);
    if (iIn < 0) return nao('sem_inbound'); // conversa aberta por nós: sem janela de atendimento, não é o caso desta regra
    const inbound = mensagens[iIn];
    const conteudoIn = String(inbound.content || '');
    if (conteudoIn.startsWith('[AUTORESPOSTA]')) return nao('autoresposta');
    if (optOutRegex && optOutRegex.test(conteudoIn)) return nao('optout');

    // recusa explícita em qualquer das últimas 3 falas do lead
    const ultimasDoLead = mensagens.filter(m => m?.role === 'user').slice(0, 3);
    if (ultimasDoLead.some(m => RECUSA_REGEX.test(_norm(m.content)))) return nao('recusou');
    // já existe reunião marcada na conversa (mesmo que o status não tenha sido atualizado)
    if (mensagens.some(m => m?.role === 'assistant' && AGENDAMENTO_REGEX.test(_norm(m.content)))) return nao('agendamento_na_conversa');

    const tIn = Date.parse(inbound.created_at);
    const tUlt = Date.parse(ultima.created_at);
    if (!Number.isFinite(tIn) || !Number.isFinite(tUlt)) return nao('data_invalida');

    const desdeIn = agora - tIn;
    const desdeUlt = agora - tUlt;
    if (desdeIn >= JANELA_SERVICO_MS) return nao('janela_fechada');
    if (!dentroDoHorario(agora, cfg)) return nao('fora_do_horario'); // tenta de novo no próximo ciclo

    if (desdeIn >= cfg.despedidaH * H && !flags.despedida) return { acao: 'despedida', inboundEm: tIn };
    if (!flags.lembrete && desdeUlt >= cfg.lembreMin * MIN && desdeIn < cfg.lembreMaxH * H) return { acao: 'lembrete', inboundEm: tIn };
    return { ...nao('aguardando'), inboundEm: tIn };
}

module.exports = {
    RECUSA_REGEX, AGENDAMENTO_REGEX, CONFIG_PADRAO, JANELA_SERVICO_MS,
    horaEmBrasilia, diaDaSemanaEmBrasilia, dentroDoHorario, indiceUltimoInbound,
    montarTexto, decidirReengajamento,
};
