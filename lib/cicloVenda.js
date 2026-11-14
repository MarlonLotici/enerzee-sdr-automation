'use strict';
/**
 * Fase do ciclo de venda por conversa (descoberta -> solução -> convite -> agendamento). Função PURA.
 *
 * Bug 2026-11-14 (Haislann): o lead nomeou a dor ("volume e qualidade") e a Sofia seguiu perguntando
 * "qual o maior desafio/obstáculo" por 8 turnos, sem nunca mostrar a solução. A Constituição só dizia
 * "amplie o gargalo", sem critério de saída. Aqui a saída é DETERMINÍSTICA: depois de 3 perguntas de
 * descoberta já respondidas, a próxima fala é a solução (o prompt recebe a ordem, não uma sugestão).
 */

const LIMITE_DESCOBERTA = 3;

// Tenants que usam o ciclo rígido. Padrão: só a Antix (os outros têm funil próprio no prompt).
const TENANTS_PADRAO = ['f437f090-5fa0-4a94-b4aa-8c22998c9cf6'];
function tenantComCiclo(userId, env = process.env) {
    const lista = (env.CICLO_SOLUCAO_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    return (lista.length ? lista : TENANTS_PADRAO).includes(String(userId || ''));
}

const _limpa = (t) => String(t || '').replace(/\[\s*[ÁA]UDIO[\s_-]*TTS\s*\]/gi, '').replace(/\[[^\]]*\]/g, '').trim();

// Agrupa mensagens seguidas do mesmo papel em turnos: [{ role, texto }]
function turnos(historico = []) {
    const out = [];
    for (const m of historico) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
        const texto = _limpa(m.content);
        if (!texto) continue;
        const ult = out[out.length - 1];
        if (ult && ult.role === m.role) ult.texto += ` ${texto}`;
        else out.push({ role: m.role, texto });
    }
    return out;
}

// A IA já mostrou como a Antix resolve a dor? ("a gente resolve", "nós conseguimos", "nossa solução"...)
const RE_SOLUCAO = /(?:a\s+antix|a\s+gente|n[óo]s|nosso\w*|nossa\w*)[^.?!]{0,70}\b(resolv\w+|conseguimos|garant\w+|mant[eé]m|filtr\w+|qualific\w+\s+(?:cada|todo|antes)|solu[çc][ãa]o)\b/i;
// A IA já convidou pra reunião? ("faz sentido agendar", "um papo de 30 minutos com o especialista")
const RE_CONVITE = /(faz\s+sentido|vale\s+a\s+pena|que\s+tal|topa|podemos|poder[íi]amos|bora|pode\s+ser)\b[^?]*\b(agendar|marcar|reuni[aã]o|call|conversa|bate[-\s]?papo|papo|\d+\s*minutos)/i;

/**
 * @param {Array<{role:string,content:string}>} historico
 * @param {{current_stage?:number, slots_propostos?:any[], status?:string}} lead
 * @returns {{ fase: 'descoberta'|'solucao'|'convite'|'agendamento', perguntasRespondidas: number }}
 */
function faseDoCiclo(historico = [], lead = {}) {
    const ts = turnos(historico);
    const temSlots = Array.isArray(lead?.slots_propostos) && lead.slots_propostos.length > 0;
    if (temSlots || lead?.status === 'booked') return { fase: 'agendamento', perguntasRespondidas: 0 };

    let perguntasRespondidas = 0;
    let solucaoApresentada = Number(lead?.current_stage) >= 3;
    let convidou = false;
    let abertura = true; // a 1ª fala da IA é a acolhida ("como posso te ajudar?"), não é descoberta
    ts.forEach((t, i) => {
        if (t.role !== 'assistant') return;
        const ehAbertura = abertura;
        abertura = false;
        if (RE_CONVITE.test(t.texto)) convidou = true;
        if (!ehAbertura && RE_SOLUCAO.test(t.texto)) solucaoApresentada = true;
        // Pergunta de descoberta = fala da IA (depois da abertura) com "?" que o lead RESPONDEU.
        const respondida = ts[i + 1]?.role === 'user';
        if (!ehAbertura && /\?/.test(t.texto) && respondida && !RE_CONVITE.test(t.texto)) perguntasRespondidas++;
    });

    if (convidou) return { fase: 'agendamento', perguntasRespondidas };
    if (solucaoApresentada) return { fase: 'convite', perguntasRespondidas };
    if (perguntasRespondidas >= LIMITE_DESCOBERTA) return { fase: 'solucao', perguntasRespondidas };
    return { fase: 'descoberta', perguntasRespondidas };
}

/** Ordem pro prompt do closer conforme a fase. '' quando não há o que forçar. */
function blocoDaFase({ fase, perguntasRespondidas } = {}) {
    if (fase === 'solucao') {
        return `
=======================================================
🎯 FASE OBRIGATÓRIA AGORA: APRESENTAR A SOLUÇÃO (a dor já foi mapeada)
=======================================================
Você já fez ${perguntasRespondidas} perguntas de descoberta e o lead respondeu. A dor dele está clara. Continuar perguntando só esfria o lead.
SUA PRÓXIMA MENSAGEM (obrigatória, nesta ordem):
1) Espelhe a dor com as palavras DELE, em uma frase curta (ex.: "então o que pega é que, quando o volume sobe, a qualidade das agendas cai").
2) Diga COMO a Antix resolve ESSA dor, de forma concreta, em 1 ou 2 frases (o agente de IA conversa com cada lead, qualifica antes de passar pro time e mantém o padrão mesmo com volume alto).
3) Termine com UMA pergunta de validação sobre a solução (ex.: "isso resolveria o que vocês vivem hoje?"). NÃO convide pra reunião ainda e NÃO fale de horário.
Marque [ESTAGIO:3].
PROIBIDO: perguntar de novo "qual o maior desafio/dor/obstáculo", "como vocês fazem hoje" ou qualquer pergunta de descoberta. Se o lead perguntou algo na última mensagem, responda primeiro (em uma frase) e siga com os passos acima.`;
    }
    if (fase === 'convite') {
        return `
=======================================================
🎯 FASE OBRIGATÓRIA AGORA: CONVITE (a solução já foi apresentada)
=======================================================
O lead já ouviu como a Antix resolve a dor dele. Se a última resposta dele foi positiva ou neutra (concordou, entendeu, quer saber mais), sua próxima mensagem PERGUNTA se faz sentido agendar uma conversa de 30 minutos com o especialista. Sem horário, sem link. Marque [ESTAGIO:4].
Se ele fez uma pergunta ou objeção, responda primeiro (curto) e então faça o convite.
PROIBIDO: voltar a perguntar sobre a dor e falar de horário antes do "sim".`;
    }
    return '';
}

// ───────────────────────────────────────────────────────────────────────────
// O CÓDIGO é dono do estágio: confere a resposta da IA contra a fase, força o estágio gravado e,
// se a IA não cumprir a fase, troca por texto determinístico. Prompt é só a primeira tentativa.
// ───────────────────────────────────────────────────────────────────────────

const RE_HORARIO_NA_FALA = /\b\d{1,2}\s?h(?:\d{2})?\b|\bàs?\s?\d|amanh[ãa]|\b(?:segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b|\bhor[áa]rios?\b/i;
// Pergunta de VALIDAÇÃO da solução ("isso faria sentido?", "resolveria?"), não de descoberta.
const RE_VALIDACAO = /((?:faz|far[ií]a)\s+sentido|resolv(?:e|eria|er)|ajud(?:a|aria|ar)|encaixa|atende|interessa|vale\s+a\s+pena|serve)/i;
const RE_ME_PEDIU_NAO = /\b(n[aã]o\s+(?:quero|tenho\s+interesse|faz\s+sentido|preciso|obrigad)|sem\s+interesse|agora\s+n[aã]o|mais\s+tarde|depois\s+eu|pare\s+de|me\s+tira|sair\s+da\s+lista)\b/i;

function _partes(texto) {
    const t = _limpa(texto).replace(/\s+/g, ' ');
    const frases = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    const perguntas = frases.filter(f => /\?\s*$/.test(f));
    return { declarativo: frases.filter(f => !/\?\s*$/.test(f)).join(' '), ultimaPergunta: perguntas[perguntas.length - 1] || '' };
}

/** O lead recusou/pediu pra parar? Aí o ciclo não força nada (quem trata é o fluxo de objeção/pausa). */
function leadRecusou(texto) { return RE_ME_PEDIU_NAO.test(String(texto || '')); }

/** A resposta da IA cumpre a fase? */
function respostaCumpreFase(fase, resposta) {
    const { declarativo, ultimaPergunta } = _partes(resposta);
    if (fase === 'solucao') {
        // Tem que ter um trecho afirmativo sobre COMO a Antix resolve e fechar com pergunta de validação.
        const falaDaSolucao = /\b(nosso|nossa|nossos|nossas|a\s+gente|n[óo]s|antix|agentes?\s+de\s+ia|agente)\b/i.test(declarativo);
        return falaDaSolucao && declarativo.length >= 60 && RE_VALIDACAO.test(ultimaPergunta) && !RE_HORARIO_NA_FALA.test(resposta);
    }
    if (fase === 'convite') {
        return RE_CONVITE.test(_limpa(resposta)) && !RE_HORARIO_NA_FALA.test(_limpa(resposta).replace(/\b\d+\s*minutos\b/gi, ''));
    }
    return true; // descoberta/agendamento: sem exigência extra
}

/** Estágio que o CÓDIGO grava ao entregar a resposta dessa fase (null = deixa como está). */
function estagioDaFase(fase) { return fase === 'solucao' ? 3 : fase === 'convite' ? 4 : null; }

/** Reescreve a etiqueta [ESTAGIO:N] da resposta: o estágio gravado é o do código, não o que a IA declarou. */
function forcarEstagio(resposta, n) {
    const sem = String(resposta || '').replace(/\[?\s*EST[AÁ]GIO\s*:?\s*\w+\s*\]?/gi, '').replace(/[ \t]{2,}/g, ' ').trim();
    return `${sem} [ESTAGIO:${n}]`;
}

// Textos determinísticos (último recurso quando a IA não cumpre a fase mesmo depois de refazer).
const SOLUCAO_FIXA = 'Entendi o cenário de vocês. É exatamente esse tipo de gargalo que a gente resolve: nosso agente de IA conversa com cada lead, qualifica antes de passar pro time e mantém o mesmo padrão mesmo quando o volume sobe. Isso faria sentido pra vocês?';
const CONVITES_FIXOS = [
    'Faz sentido a gente agendar um papo de 30 minutos com nosso especialista pra desenhar isso pra vocês?',
    'Que tal um papo de 30 minutos com nosso especialista pra ver como isso ficaria no seu caso? Faz sentido?',
];
const textoFixoDaFase = (fase, i = 0) => (fase === 'solucao' ? SOLUCAO_FIXA : CONVITES_FIXOS[i % CONVITES_FIXOS.length]);

module.exports = {
    faseDoCiclo, blocoDaFase, tenantComCiclo, LIMITE_DESCOBERTA,
    respostaCumpreFase, estagioDaFase, forcarEstagio, textoFixoDaFase, leadRecusou,
};
