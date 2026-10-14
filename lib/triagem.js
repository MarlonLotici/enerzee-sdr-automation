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

REGRA DE OURO: se o lead PERGUNTOU algo (dúvida) ou OBJETOU, a intencao_agora NÃO é pedido_agendar nem sinal_de_avanco — mesmo que ele esteja no fim do funil. Ouça o que ele está pedindo AGORA.`;
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
    // 1) Dúvida/pergunta aberta SEMPRE vira tira-dúvidas — nunca agenda por cima (o furo real).
    if (t.intencao_agora === 'duvida' || t.pergunta_aberta) return 'tira_duvida';
    // 2) Objeção → tratar objeção.
    if (t.intencao_agora === 'objecao') return 'tratar_objecao';
    // 3) Pedido explícito de marcar/horário → agendar.
    if (t.intencao_agora === 'pedido_agendar') return 'agendar';
    // 4) Sinal de avanço + já viu valor/solução → convidar pra reunião.
    if (t.intencao_agora === 'sinal_de_avanco' &&
        (t.concordou_com_valor || t.momento === 'validacao_valor' || t.momento === 'convite' || t.momento === 'solucao'))
        return 'propor_reuniao';
    // 5) Caso contrário, segue qualificando (SPIN).
    return 'qualificar';
}

module.exports = { triar, decidirAcao, _coagir, _fallback, MOMENTOS, INTENCOES, DORES };
