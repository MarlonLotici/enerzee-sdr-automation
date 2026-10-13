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

// 🧠 COMPREENSÃO, NÃO PALAVRA-CHAVE: querAgendar só pega pedido EXPLÍCITO e inequívoco de marcar.
// De PROPÓSITO não inclui palavras temporais soltas (hoje/amanhã/dias da semana/"pode ser"/"quando"/
// "semana"): elas aparecem em conversa normal ("Hoje trabalho com advocacia", "respondo em 2h",
// "hoje eles chegam") e disparavam agendamento FALSO. A intenção de marcar vem da COMPREENSÃO:
//   - a IA qualifica, entende a dor e CONVIDA → o lead aceita (aceitouConvite), OU
//   - o roteador LLM classifica a mensagem como COMPRA (quer agendar), OU
//   - o lead pede aqui de forma explícita ("quero marcar", "me manda os horários").
// Dia/hora específicos só valem DENTRO de um agendamento já em curso (orquestrador, quando há slots).
const RE_AGENDAR_EXPLICITO = /\b(agendar|agende|agendamento|remarcar|(?:quero|queria|gostaria|posso|pode|podemos|vamos|bora)\s+(?:marcar|agendar)|marcar\s+(?:uma|a)\b|me\s+(?:manda|passa|envia|mande)\s+(?:os\s+)?hor[aá]rios?|tem\s+(?:algum\s+)?hor[aá]rio|qual\s+(?:a\s+)?(?:sua\s+)?(?:agenda|disponibilidade)|que\s+dia\b|que\s+horas?\b)/i;
// Horário explícito com "às" ("às 10h", "às 14", "pode ser às 9:30"): sinal concreto de agendamento
// (diferente de duração "em 2h"). Boundary próprio (o \b do RE acima não pega o "à" não-ASCII).
const RE_HORARIO_COM_AS = /(?:^|[^\p{L}])[àa]s\s?\d{1,2}(?:h|:\d{2})?(?![\p{L}])/iu;

// Compat: nome antigo exportado (testes/introspecção).
const RE_QUER_AGENDAR = RE_AGENDAR_EXPLICITO;

const RE_SAUDACAO_PURA = /^\s*(oi+|ol[áa]|opa|e?\s*a[íi]|bom\s+dia|boa\s+(tarde|noite)|hey|hi|ola|menu)[\s!.,?]*$/i;

// Afirmativo curto ("sim", "bora", "pode ser", "quero", "faz sentido"...). Usado só em par com
// um convite de reunião anterior — sozinho não propõe nada.
const RE_AFIRMATIVO = /^\s*(sim|isso|claro|bora|vamos|vamo|pode(mos)?\s*(ser|sim)?|quero|queria|gostaria|adoraria|com\s+certeza|perfeito|fechado|fecha|topo|aceito|faz\s+sentido|show|beleza|blz|ok|okay|uhum|aham|tá|ta\s+bom|positivo|por\s+favor)\b/i;

// A IA convidou pra reunião/call na fala anterior? ("faz sentido uma call?", "podemos marcar...").
const RE_CONVITE_REUNIAO = /(faz\s+sentido|vale\s+a\s+pena|que\s+tal|topa|podemos|poder[íi]amos|bora)\b[^?]*\b(reuni[aã]o|call|conversa|bate[-\s]?papo|demonstra|apresenta|papo|15\s*min|30\s*min)/i;

// A IA PROMETEU puxar a agenda na fala anterior ("vou ver os horários", "deixa eu abrir a agenda",
// "já estou puxando os horários"). Se prometeu, o sistema tem que ENTREGAR os slots reais no próximo
// turno — senão a IA fica prometendo em loop e nunca aparece horário (promessa vazia, bug real).
const RE_PROMETEU_AGENDA = /\b(vou|deixa\s+eu|deixe[-\s]?me|estou|t[ôo]u?|j[aá]\s+vou)\b[^.?!]{0,30}\b(ver|olhar|abrir|abrindo|puxar|puxando|verificar|verificando|checar|consultar|conferir|pegar|vendo)\b[^.?!]{0,40}\b(agenda|hor[aá]rios?)\b/i;

// O "objeto reunião" (substantivo do encontro). Sozinho NÃO quer dizer que o lead quer marcar —
// ele pode só estar PERGUNTANDO sobre a reunião. Por isso a menção a "reunião"/"call" não deve,
// por si, disparar a oferta de horário.
const RE_OBJETO_REUNIAO = /\b(reuni[aã]o|call|conversa|bate[-\s]?papo|papo|encontro|demonstra\w*|apresenta\w*|demo|dem[oõ])\b/i;

// Marcadores de DÚVIDA (pergunta sobre algo): "como", "o que", "quanto tempo", "é online/pago",
// "preciso levar", "pra que serve"... Combinados com o objeto-reunião = pergunta SOBRE a reunião.
// Borda esquerda via (?:^|\s) em vez de \b: o \b do JS usa \w=[A-Za-z0-9_], então NÃO reconhece
// fronteira antes de "é" (acentuado) — o ramo "é online/pago" nunca casava. (?:^|\s) resolve.
const RE_DUVIDA = /(?:^|\s)(como|o\s+que|oq|qual|quais|quant[oa]s?|onde|por\s*qu[eê]|pq|precis[ao]|preciso|tenho\s+que|vou\s+(?:ter\s+que|precisar)|pra\s+que(?:\s+serve)?|serve\s+pra|é\s+(?:online|presencial|pag\w*|gratuit\w*|gr[áa]tis|cobrad\w*)|tem\s+(?:algum\s+)?custo|é\s+sobre)\b/i;

// É uma DÚVIDA sobre a reunião (ex.: "como funciona a reunião?", "o que é essa call?",
// "quanto tempo dura?", "a reunião é online?", "preciso levar algo?"). Nesse caso a IA deve
// RESPONDER a dúvida (REGRA DE OURO) — NUNCA pular pro horário por cima da pergunta.
function ehDuvidaSobreReuniao(texto) {
    const t = String(texto || '').trim();
    if (!t) return false;
    if (RE_OBJETO_REUNIAO.test(t) && RE_DUVIDA.test(t)) return true;
    // Pergunta sobre a reunião SEM marcador clássico ("vamos falar sobre X na reunião?"): menciona
    // a reunião, termina em "?" e NÃO é pedido explícito de marcar ("podemos marcar a reunião?" é
    // pedido, não dúvida). Bug real: "vamos falar de contabilidade na reunião?" pulava pro horário.
    if (RE_OBJETO_REUNIAO.test(t) && /\?\s*$/.test(t) && !querAgendar(t)) return true;
    return false;
}

function querAgendar(texto) {
    // Só pedido EXPLÍCITO de marcar ou horário com "às". Temporal solto ("hoje"/"amanhã"/"pode ser")
    // NÃO conta mais — a intenção vem da compreensão (aceitouConvite / roteador COMPRA).
    const t = String(texto || '');
    return RE_AGENDAR_EXPLICITO.test(t) || RE_HORARIO_COM_AS.test(t);
}

function ehSaudacaoPura(texto) {
    return RE_SAUDACAO_PURA.test(String(texto || '').trim());
}

function ehAfirmativo(texto) {
    const t = String(texto || '').trim();
    // Pergunta com conteúdo ("vamos falar sobre X na reunião?") NÃO é aceite — é dúvida. Um "vamos"/
    // "pode ser" no começo de uma pergunta longa não pode ser lido como "sim, aceito".
    if (/\?/.test(t) && t.split(/\s+/).filter(Boolean).length > 4) return false;
    return RE_AFIRMATIVO.test(t);
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

// A IA prometeu puxar a agenda na última fala dela?
function prometeuVerAgenda(historico = []) {
    for (let i = historico.length - 1; i >= 0; i--) {
        if (historico[i]?.role === 'assistant') {
            return RE_PROMETEU_AGENDA.test(String(historico[i].content || ''));
        }
    }
    return false;
}

// Retorna true se a orquestração de agendamento DEVE seguir (propor/efetivar).
function deveProporAgendamento({ texto, intencao, currentStage = 0, temSlots = false, aceitouConvite = false, prometeuAgenda = false } = {}) {
    if (temSlots) return true;                                   // conversa de agenda já em curso
    if (ehSaudacaoPura(texto)) return false;                     // "oi" nunca propõe (estágio herdado)
    // DÚVIDA sobre a reunião ("como funciona a reunião?") NÃO é pedido pra marcar — mesmo contendo
    // a palavra "reunião". Responde a pergunta primeiro; não despeja horário por cima dela.
    if (ehDuvidaSobreReuniao(texto)) return false;
    // A IA prometeu puxar a agenda no turno anterior → ENTREGA os horários agora (não promete de
    // novo). Só não cumpre se o lead recuou ("não"/"depois"/"agora não").
    if (prometeuAgenda && !/\b(n[aã]o|depois|mais\s+tarde|outra\s+hora|deixa\s+pra|agora\s+n[aã]o)\b/i.test(String(texto || ''))) return true;
    if (querAgendar(texto)) return true;                         // pediu explicitamente ("quero marcar", "às 10h")
    if (aceitouConvite && ehAfirmativo(texto)) return true;      // IA convidou e o lead topou
    // PERGUNTA genuína (termina em "?") que NÃO é pedido de marcar → RESPONDE primeiro, nunca agenda
    // por cima dela — mesmo que o roteador classifique COMPRA. Bug real (Matheus): "vocês conseguem
    // me economizar quanto?" foi ignorada e virou oferta de horário. Pedidos de horário ("pode ser
    // às 10h?", "podemos marcar amanhã?") já passaram por querAgendar acima.
    if (/\?\s*$/.test(String(texto || '').trim())) return false;
    // COMPRA (aceite pelo roteador) só propõe DEPOIS de qualificar (estágio>=3): evita a IA ser
    // "afoita" e pular pro horário quando o lead só confirmou uma dor ("às vezes sim") no início.
    if (intencao === 'COMPRA' && (currentStage || 0) >= 3) return true;
    return false;                                                // não propõe antes de explorar a dor/solução
}

module.exports = {
    querAgendar, ehSaudacaoPura, ehAfirmativo, ehDuvidaSobreReuniao,
    convidouReuniaoAntes, aceitouConviteDeReuniao, prometeuVerAgenda, deveProporAgendamento,
    RE_QUER_AGENDAR, RE_AGENDAR_EXPLICITO,
    RE_SAUDACAO_PURA, RE_AFIRMATIVO, RE_CONVITE_REUNIAO, RE_OBJETO_REUNIAO, RE_DUVIDA,
};
