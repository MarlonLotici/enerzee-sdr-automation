'use strict';
/**
 * PAUSA HUMANA (15 min) — quando uma pessoa da equipe responde o lead, a Sofia se cala por um tempo e,
 * ao voltar, é OBRIGADA a retomar lendo a conversa inteira (inclusive o que o humano disse).
 *
 * Bug 2026-11-05: o chip OFICIAL ignorava a pausa (só o caminho Baileys a respeitava), então a Sofia
 * respondia por cima do Marlon, se reapresentava e repetia perguntas.
 *
 * avaliarPausa(lead) devolve o que fazer com uma mensagem NOVA do lead:
 *   - 'seguir'   → responde normal.
 *   - 'silencio' → pausa MANUAL explícita (botão "Pausar IA" / /pausar): só volta com reativação.
 *   - 'segurar'  → humano falou há menos de N min: não responde agora; retoma ao fim da janela.
 *   - 'acordar'  → a janela passou: tira a pausa e responde (lendo o histórico completo).
 * Pausas por OUTRO motivo (encerramento, engano, robô...) não têm last_human_interaction e seguem
 * exatamente como antes ('seguir').
 */
const PAUSA_HUMANA_MIN = Number(process.env.PAUSA_HUMANA_MIN) || 15;

function avaliarPausa(lead, agora = Date.now(), minutos = PAUSA_HUMANA_MIN) {
    if (!lead || !lead.is_paused) return { acao: 'seguir' };
    // Concierge: lead agendado (pausado só p/ o proativo) responde sempre que ELE escreve.
    if (lead.status === 'booked' && !lead.manual_pause) return { acao: 'seguir' };
    if (lead.manual_pause) return { acao: 'silencio', motivo: 'pausa_manual' };
    if (!lead.last_human_interaction) return { acao: 'seguir' };
    const ts = new Date(lead.last_human_interaction).getTime();
    if (!Number.isFinite(ts)) return { acao: 'seguir' };
    const restanteMs = ts + minutos * 60000 - agora;
    return restanteMs > 0 ? { acao: 'segurar', restanteMs } : { acao: 'acordar' };
}

const MARCADOR_HUMANO = '[ATENDENTE_HUMANO]';

/** Alguma fala do histórico (já mapeado: human_operator → "[ATENDENTE_HUMANO]: …") é de um humano? */
function houveAtendenteHumano(historico = []) {
    return historico.some(m => typeof m?.content === 'string' && m.content.startsWith(MARCADOR_HUMANO));
}

/**
 * Seção de prompt da retomada: só existe se um humano falou nesta conversa.
 * `retomandoAgora` = esta é a PRIMEIRA resposta da IA depois da pausa (o sistema acabou de despausar):
 * a IA é avisada explicitamente de que está voltando agora, não só de que "houve um humano".
 */
function montarSecaoRetomadaHumana(historico = [], { retomandoAgora = false } = {}) {
    const houve = houveAtendenteHumano(historico);
    if (!houve && !retomandoAgora) return '';
    const momento = retomandoAgora
        ? 'VOCÊ ESTÁ VOLTANDO AGORA: a IA ficou pausada enquanto uma pessoa da equipe (o gestor) atendia este lead, e esta é a sua PRIMEIRA resposta depois da pausa.'
        : 'Uma pessoa da equipe (o gestor) conversou diretamente com este lead em algum momento desta conversa.';
    return `

[RETOMADA APÓS ATENDIMENTO HUMANO — LEIA A CONVERSA INTEIRA ANTES DE RESPONDER]
${momento} As falas marcadas com ${MARCADOR_HUMANO} foram escritas por ELA, não por você.
OBRIGATÓRIO: leia TODA a conversa acima, entenda o que o lead e o atendente já disseram e continue exatamente dali.
- NÃO cumprimente de novo, NÃO se reapresente e NÃO refaça pergunta que o lead já respondeu (a você ou ao atendente).
- NÃO repita nem contradiga o que o atendente disse. Se ele fez uma pergunta que o lead ainda não respondeu, retome essa pergunta de forma natural.
- Responda primeiro o que o lead acabou de dizer.
- NUNCA escreva o marcador ${MARCADOR_HUMANO} na sua resposta.`;
}

module.exports = { PAUSA_HUMANA_MIN, MARCADOR_HUMANO, avaliarPausa, houveAtendenteHumano, montarSecaoRetomadaHumana };
