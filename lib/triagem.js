'use strict';
/**
 * lib/triagem.js — IDENTIFICAÇÃO INTELIGENTE do momento da conversa (escuta ativa).
 *
 * Em vez de decidir o rumo por palavra-chave, uma ÚNICA chamada de LLM lê a conversa e
 * devolve, de forma estruturada, ONDE a conversa está e O QUE o lead quer AGORA. Um
 * roteador determinístico (decidirAcao) usa isso pra escolher o modo — e, crucialmente,
 * só libera agendamento quando faz sentido (lead concordou com o valor ou pediu pra marcar).
 *
 * Isso resolve o problema real: a IA forçando agendamento por cima de dúvida/objeção, em
 * vez de OUVIR o que o cliente está buscando naquele momento.
 *
 * Fluxo ideal (momento):
 *   rapport → descoberta(ramo+nome) → dor → solucao(mostrar+visualizar) →
 *   validacao_valor(lead concorda que vale) → convite → agendado(concierge/tira-dúvidas)
 *
 * Tipos de dor (o "dedo na ferida" muda conforme):
 *   sem_atendimento      → perde cliente por demora/sem resposta (conta = perdas × ticket)
 *   time_comercial_caro  → tem equipe cara e quer baratear com IA (conta = custo atual × economia)
 */

// require do llm é LAZY (dentro de triar) — assim as funções puras (decidirAcao/_coagir) e os
// testes não disparam a criação do client OpenAI (que exige TOGETHER_API_KEY no load).

const MOMENTOS =['rapport', 'descoberta', 'dor', 'solucao', 'validacao_valor', 'convite', 'agendado'];
const INTENCOES = ['responde_qualificacao', 'duvida', 'objecao', 'sinal_de_avanco', 'pedido_agendar', 'smalltalk'];
const DORES = ['sem_atendimento', 'time_comercial_caro', 'outro', 'desconhecido'];
const TEMPERATURAS = ['quente', 'morno', 'esfriando', 'frio'];

function _promptTriagem() {
    return `Você é o "cérebro" de escuta ativa de uma IA de vendas (a Sofia, da Antix, que vende um agente de IA de atendimento/comercial no WhatsApp). Sua tarefa NÃO é responder o cliente — é LER a conversa e dizer, com precisão, onde ela está e o que o cliente quer AGORA. Outro sistema decide a resposta a partir da sua leitura.

Devolva SOMENTE um JSON válido (sem texto fora dele):
{
  "momento": "rapport|descoberta|dor|solucao|validacao_valor|convite|agendado",
  "intencao_agora": "responde_qualificacao|duvida|objecao|sinal_de_avanco|pedido_agendar|smalltalk",
  "dor_tipo": "sem_atendimento|time_comercial_caro|outro|desconhecido",
  "tem_numeros": { "perde_por_semana": <número ou null>, "ticket": <número ou null>, "gasto_atual_mes": <número ou null> },
  "concordou_com_valor": <true|false>,
  "pergunta_aberta": <true|false>,
  "temperatura": "quente|morno|esfriando|frio",
  "raciocinio": "<1 frase curta>"
}

DEFINIÇÕES (leia com cuidado — é o coração da escuta ativa):
- momento = o estágio GERAL da conversa até aqui:
  • rapport: só cumprimento/apresentação, sem saber nome nem ramo.
  • descoberta: pegando nome e o que a pessoa faz/vende.
  • dor: explorando onde ela perde cliente/dinheiro/tempo (ainda sem fechar a conta).
  • solucao: a Sofia já quantificou a dor e/ou apresentou a solução.
  • validacao_valor: a pessoa está reagindo à solução/valor (concordando, duvidando ou objetando).
  • convite: já foi proposta a reunião.
  • agendado: reunião já marcada (tem data/hora confirmada).
- intencao_agora = o que a ÚLTIMA mensagem do LEAD representa:
  • responde_qualificacao: está respondendo uma pergunta da Sofia (diz o ramo, números, como atende...).
  • duvida: está PERGUNTANDO algo ou pedindo esclarecimento (como funciona, quanto custa, "economizar quanto?", "você ignorou minha pergunta", "?"). Pergunta que NÃO é pedido de marcar.
  • objecao: resistência/ceticismo ("achei caro", "IA é fria", "não sei se funciona", "tô sem tempo").
  • sinal_de_avanco: concordou/demonstrou querer seguir ("faz sentido", "gostei", "ok", "quero sim", "bora").
  • pedido_agendar: explicitamente quer marcar ou deu um horário ("quero marcar", "pode ser às 10h", "amanhã às 15h").
  • smalltalk: conversa fiada/retribuir cumprimento ("tudo e vc?").
- dor_tipo: classifique a dor REAL do lead. Se ele diz que GASTA muito com equipe e quer baratear → time_comercial_caro (NÃO sem_atendimento). Se perde cliente por demora → sem_atendimento.
- concordou_com_valor: true SÓ se o lead já sinalizou que enxergou vantagem/valor na solução (não basta responder qualificação).
- pergunta_aberta: true se a última mensagem do lead contém uma pergunta ainda não respondida.
- temperatura: o quão "quente" o lead está AGORA (instinto de vendedor): quente=animado, concordou, quer seguir ("gostei","quero sim","quando marcamos?"); morno=engajado respondendo a qualificação, neutro ("sou padeiro","perco uns 5"); esfriando=respostas SECAS/evasivas ou "vou pensar" DEPOIS de um pitch ("ta","sei","depois eu vejo","hmm") — recuou, NÃO é avanço; frio=desinteresse claro ("não tenho interesse"). Resposta seca logo após a Sofia empurrar valor/reunião é ESFRIANDO.

REGRA DE OURO: se o lead PERGUNTOU algo (dúvida) ou OBJETOU, a intencao_agora NÃO é pedido_agendar nem sinal_de_avanco — mesmo que ele esteja no fim do funil. Ouça o que ele está pedindo AGORA.

EXEMPLOS RESOLVIDOS (aprenda os casos sutis — depois classifique a conversa REAL abaixo do mesmo jeito):

Ex1 — dor de CUSTO explícita + pergunta:
IA: "qual economia você quer?" / LEAD: "hoje gasto 6 mil fixo nessa operação, vocês me economizam quanto?"
→ {"momento":"dor","intencao_agora":"duvida","dor_tipo":"time_comercial_caro","concordou_com_valor":false,"pergunta_aberta":true}
(ele PERGUNTOU → duvida, não avanço; a dor é GASTO com equipe, não perda de cliente → time_comercial_caro)

Ex2 — dor de CUSTO implícita, SEM pergunta:
IA: "como vocês atendem hoje?" / LEAD: "tenho 3 funcionárias só pra isso, uma ganha 2500 só pra responder wpp"
→ {"momento":"dor","intencao_agora":"responde_qualificacao","dor_tipo":"time_comercial_caro","concordou_com_valor":false,"pergunta_aberta":false}
(está respondendo, não perguntando; e a dor é o CUSTO da equipe → time_comercial_caro, mesmo sem ele reclamar de preço)

Ex3 — ticket NÃO é pedido de agendar:
IA: "qual o ticket médio?" / LEAD: "60 reais"
→ {"momento":"dor","intencao_agora":"responde_qualificacao","dor_tipo":"sem_atendimento","concordou_com_valor":false,"pergunta_aberta":false}
(responder um número de qualificação NUNCA é pedido_agendar nem avanço)

Ex4 — pergunta DISFARÇADA no meio da qualificação:
IA: "qual o ticket médio?" / LEAD: "e vcs cobram por mensagem ou é fixo mensal?"
→ {"momento":"dor","intencao_agora":"duvida","dor_tipo":"sem_atendimento","concordou_com_valor":false,"pergunta_aberta":true}
(mudou o rumo pra uma pergunta de preço → duvida, mesmo sem ter respondido o ticket)

Ex5 — "ok" DEPOIS de ver o valor = avanço QUENTE:
IA: "a IA recupera ~1500/mês. Quer marcar 15 min pra eu mostrar?" / LEAD: "ok"
→ {"momento":"convite","intencao_agora":"sinal_de_avanco","concordou_com_valor":true,"pergunta_aberta":false,"temperatura":"quente"}
(ele já viu o valor e topou seguir → sinal_de_avanco, quente)

Ex6 — resposta SECA pós-pitch = ESFRIANDO (NÃO confunda com o "ok" do Ex5):
IA: "Recupera 1500/mês e ainda libera seu tempo, bacana né?" / LEAD: "ta"
→ {"momento":"solucao","intencao_agora":"smalltalk","concordou_com_valor":false,"pergunta_aberta":false,"temperatura":"esfriando"}
(um "ta"/"sei"/"hmm" seco, sem entusiasmo, logo após a Sofia empurrar valor = o lead ESFRIOU, não é um sim. Marque temperatura "esfriando" e NÃO trate como avanço.)

Agora classifique a conversa REAL abaixo. Devolva SOMENTE o JSON completo (com tem_numeros e raciocinio também).`;
}

function _fallback(ultimaMsg) {
    const t = String(ultimaMsg || '').trim();
    const ehPergunta = /\?\s*$/.test(t);
    return {
        momento: 'descoberta',
        intencao_agora: ehPergunta ? 'duvida' : 'responde_qualificacao',
        dor_tipo: 'desconhecido',
        tem_numeros: { perde_por_semana: null, ticket: null, gasto_atual_mes: null },
        concordou_com_valor: false,
        pergunta_aberta: ehPergunta,
        temperatura: 'morno',
        raciocinio: 'fallback (LLM indisponível)',
        _fallback: true,
    };
}

function _coagir(obj, ultimaMsg) {
    const fb = _fallback(ultimaMsg);
    if (!obj || typeof obj !== 'object') return fb;
    const momento = MOMENTOS.includes(obj.momento) ? obj.momento : fb.momento;
    const intencao_agora = INTENCOES.includes(obj.intencao_agora) ? obj.intencao_agora : fb.intencao_agora;
    const dor_tipo = DORES.includes(obj.dor_tipo) ? obj.dor_tipo : 'desconhecido';
    const n = obj.tem_numeros || {};
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (parseFloat(v) || null));
    return {
        momento, intencao_agora, dor_tipo,
        tem_numeros: { perde_por_semana: num(n.perde_por_semana), ticket: num(n.ticket), gasto_atual_mes: num(n.gasto_atual_mes) },
        concordou_com_valor: obj.concordou_com_valor === true,
        pergunta_aberta: obj.pergunta_aberta === true || /\?\s*$/.test(String(ultimaMsg || '').trim()),
        temperatura: TEMPERATURAS.includes(obj.temperatura) ? obj.temperatura : 'morno',
        raciocinio: typeof obj.raciocinio === 'string' ? obj.raciocinio.slice(0, 200) : '',
    };
}

/**
 * Lê a conversa e devolve a triagem estruturada. Nunca lança (cai no fallback).
 * @param {object} p
 * @param {Array<{role,content}>} p.historico  histórico user/assistant
 * @param {string} p.ultimaMsg                  última mensagem do lead
 */
async function triar({ historico = [], ultimaMsg = '' } = {}) {
    const msgs = [...historico.filter(m => m && (m.role === 'user' || m.role === 'assistant')),
    { role: 'user', content: String(ultimaMsg || '') }];
    // 2 tentativas: a triagem decide o rumo da conversa, então uma piscada do provedor não pode
    // derrubar pro fallback cego (que já custou 1 caso no teste). chamarLLM já faz retry de rede;
    // aqui cobrimos também JSON malformado.
    const { chamarLLM, MODELOS } = require('./llm');
    for (let i = 0; i < 2; i++) {
        try {
            // 450 (não 220): o JSON completo + eventuais tokens de controle do gpt-oss não cabem em
            // 220 e o corte derruba o parse → fallback cego. 450 dá folga sem custo relevante.
            const raw = await chamarLLM({ system: _promptTriagem(), messages: msgs, model: MODELOS.cerebro, maxTokens: 450 });
            const m = String(raw || '').match(/\{[\s\S]*\}/);
            if (m) return _coagir(JSON.parse(m[0]), ultimaMsg);
        } catch (e) { /* tenta de novo */ }
    }
    return _fallback(ultimaMsg);
}

/**
 * Roteador DETERMINÍSTICO: da triagem → o modo de resposta. É aqui que a escuta ativa vira
 * comportamento. Agendamento só é liberado quando faz sentido.
 * @returns {'tira_duvida'|'tratar_objecao'|'propor_reuniao'|'agendar'|'qualificar'}
 */
function decidirAcao(tri, lead = {}) {
    const t = tri || {};
    // 1) Pedido EXPLÍCITO de marcar/horário → agendar — mesmo em forma de pergunta ("quando
    //    marcamos?", "qual horário você tem?"). Pergunta de AGENDAR é pedido, não dúvida; por isso
    //    vem ANTES da regra de pergunta aberta. (Vontade clara também vence a temperatura.)
    if (t.intencao_agora === 'pedido_agendar') return 'agendar';
    // 2) Dúvida/pergunta aberta vira tira-dúvidas — nunca agenda por cima (o furo real).
    if (t.intencao_agora === 'duvida' || t.pergunta_aberta) return 'tira_duvida';
    // 3) Objeção → tratar objeção.
    if (t.intencao_agora === 'objecao') return 'tratar_objecao';
    // 4) Sinal de avanço + já viu valor/solução → convidar pra reunião. MAS instinto de vendedor
    //    sênior: se o lead está ESFRIANDO/FRIO (ex.: "ta","vou pensar" seco pós-pitch — que o LLM
    //    às vezes lê como avanço), NÃO empurra horário; recua pra re-aquecer (qualificar). Empurrar
    //    reunião num lead frio queima o lead. (Bug real: "ta" virava oferta de reunião.)
    if (t.intencao_agora === 'sinal_de_avanco' &&
        (t.concordou_com_valor || t.momento === 'validacao_valor' || t.momento === 'convite' || t.momento === 'solucao')) {
        if (t.temperatura === 'esfriando' || t.temperatura === 'frio') return 'qualificar';
        return 'propor_reuniao';
    }
    // 5) Caso contrário, segue qualificando (SPIN).
    return 'qualificar';
}

module.exports = { triar, decidirAcao, _coagir, _fallback, MOMENTOS, INTENCOES, DORES, TEMPERATURAS };
