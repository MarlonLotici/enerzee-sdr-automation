const { chamarLLM, MODELOS } = require('../lib/llm');

// Parse tolerante (mesmo do auditor): extrai o bloco { ... } e tenta parsear. Nunca lança.
function _parseJsonRobusto(txt) {
    if (!txt || typeof txt !== 'string') return null;
    const limpo = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
    const ini = limpo.indexOf('{');
    const fim = limpo.lastIndexOf('}');
    const candidato = (ini !== -1 && fim > ini) ? limpo.slice(ini, fim + 1) : limpo;
    try { return JSON.parse(candidato); } catch { /* tenta cru */ }
    try { return JSON.parse(limpo); } catch { return null; }
}

// Monta um resumo curto do histórico recente pro crítico ter contexto sem gastar tokens à toa.
function _historicoCurto(historico = [], n = 8) {
    return historico.slice(-n).map(m => {
        const quem = m.role === 'assistant' ? 'IA' : (m.role === 'user' ? 'LEAD' : m.role);
        return `${quem}: ${String(m.content || '').slice(0, 220)}`;
    }).join('\n');
}

/**
 * CRÍTICO (juiz) — avalia o RASCUNHO da resposta ANTES do envio. SÓ julga, não reescreve.
 * Usa o modelo rápido/barato (classificação). Fail-open: em erro, retorna { ok: true }.
 *
 * @returns {{ ok: boolean, problemas: string[] }}
 */
async function revisar({ historico = [], lead = {}, draft = '', primeiroContato = false } = {}) {
    try {
        if (!draft || !String(draft).trim()) return { ok: true, problemas: [] };

        const temNome = !!(lead.dono && String(lead.dono).trim().length > 1);
        const jaAgendado = lead.status === 'booked' && !!lead.gcal_event_id;
        const jaOfereceuHorario = Array.isArray(lead.slots_propostos) && lead.slots_propostos.length > 0;

        const prompt = `Você é SUPERVISOR de qualidade de uma SDR por WhatsApp. Avalie o RASCUNHO da próxima resposta da IA, ANTES de enviar. Seja rígido mas justo: aponte SÓ problemas REAIS e GRAVES da lista. Se estiver bom, aprove.

ESTADO:
- Primeiro contato (lead falou primeiro, IA nunca abriu): ${primeiroContato ? 'SIM' : 'não'}
- Já sabemos o nome da pessoa: ${temNome ? 'SIM (' + lead.dono + ')' : 'NÃO'}
- Estágio atual do funil (0=acolhida,1=contexto,2-3=qualificação,4=agendamento,5=pós): ${lead.current_stage ?? 0}
- Já há reunião agendada: ${jaAgendado ? 'SIM' : 'não'}
- Já ofereceu horários e aguarda escolha: ${jaOfereceuHorario ? 'SIM' : 'não'}

HISTÓRICO RECENTE:
${_historicoCurto(historico)}

RASCUNHO DA IA (a avaliar):
"""${String(draft).slice(0, 900)}"""

PROBLEMAS A DETECTAR (use estas chaves exatas em "problemas"):
- "contexto_incoerente": [MAIS IMPORTANTE] a resposta NÃO tem a ver com o que o lead ACABOU de dizer — ignora a pergunta/assunto dele ou responde outra coisa. A resposta tem que conversar com a última mensagem do lead.
- "nao_explora_necessidade": a real dor/necessidade do lead ainda NÃO está clara e a resposta não avança nessa descoberta (deixou de fazer a pergunta de SPIN que revelaria o que ele realmente precisa).
- "pulou_etapa": furou a ordem do roteiro (boas-vindas/rapport → SPIN → explicar solução → convidar p/ reunião → propor horário). Ex.: foi direto pra qualificação dura no 1º contato, ou propôs horário sem ter convidado e o lead topado.
- "agendou_cedo": ofereceu/empurrou horário sem qualificação suficiente, ou o lead NÃO demonstrou interesse claro em marcar (ex.: só respondeu uma pergunta de qualificação).
- "pulou_acolhida": é primeiro contato e a IA já disparou qualificação dura, sem acolher/entender o motivo.
- "nao_pediu_nome": não sabemos o nome e a IA tinha espaço pra perguntar "como posso te chamar?" e não perguntou (nem usou o nome porque não tem).
- "empilhou_perguntas": fez 2 ou mais perguntas na mesma mensagem.
- "textao": mensagem longa demais / parágrafo pesado (não é bate-papo de WhatsApp).
- "inventou": afirmou preço, link, horário, política, prazo ou certificação que NÃO foi dado nas instruções/histórico.
- "agendamento_fake": disse "agendei/confirmado/marquei/reservei" sem o sistema ter criado o evento.
- "inconsistente": contradiz o estado (ex.: já agendado e reoferece horário; repete "vou ver os horários" já ditos).
- "robotico": tom de robô cordial ("tranquilo!", "compreendo!", "estou à disposição") ou fora da persona.

Antes de decidir, raciocine em 1 linha qual é a REAL intenção/necessidade do lead agora (campo "intencao_real").
Responda SOMENTE um JSON:
{"intencao_real": "...", "ok": true|false, "problemas": ["chave1","chave2"]}
"ok" = true e "problemas":[] quando o rascunho está adequado (coerente com o lead e no passo certo do roteiro). "ok" = false quando houver pelo menos um problema grave.`;

        // Juiz = modelo rápido por padrão (classificação barata). SUPERVISOR_MODELO=cerebro sobe o
        // poder de análise (pega incoerência de contexto mais sutil) ao custo de + latência/token.
        const modeloJuiz = process.env.SUPERVISOR_MODELO === 'cerebro' ? MODELOS.cerebro : MODELOS.rapido;
        const raw = (await chamarLLM({ messages: [{ role: 'user', content: prompt }], model: modeloJuiz, maxTokens: 260 }) || '').trim();
        const parsed = _parseJsonRobusto(raw);
        if (!parsed || typeof parsed.ok !== 'boolean') return { ok: true, problemas: [] }; // fail-open
        const problemas = Array.isArray(parsed.problemas) ? parsed.problemas.filter(p => typeof p === 'string') : [];
        if (parsed.intencao_real) console.log(`🧑‍⚖️ [SUPERVISOR] Intenção real do lead: ${String(parsed.intencao_real).slice(0, 120)}`);
        return { ok: parsed.ok && problemas.length === 0, problemas, intencaoReal: parsed.intencao_real || null };
    } catch (e) {
        console.error('❌ [SUPERVISOR] revisar falhou (fail-open):', e.message);
        return { ok: true, problemas: [] };
    }
}

// Dicas de reescrita por problema → instrução concreta pro modelo forte corrigir.
const _DICAS = {
    contexto_incoerente:  'Responda ao que o lead ACABOU de dizer — foque na mensagem dele, não mude de assunto. A resposta tem que conversar com a última fala dele.',
    nao_explora_necessidade:'Faça UMA pergunta de SPIN pra entender a real dor/necessidade do lead (o que ele precisa resolver hoje), antes de seguir. Nada de propor solução/horário ainda.',
    pulou_etapa:          'Respeite a ordem: rapport → descobrir a necessidade (SPIN) → explicar a solução → convidar pra reunião → só então horário. Volte pra etapa que foi pulada.',
    agendou_cedo:      'NÃO ofereça horário agora. Volte a qualificar/entender o lead com UMA pergunta aberta. Nada de propor reunião.',
    pulou_acolhida:    'É primeiro contato: acolha em 1 frase (quem você é + o que a empresa faz), demonstre curiosidade pelo motivo do contato. NÃO dispare qualificação dura ainda.',
    nao_pediu_nome:    'Pergunte de forma leve como pode chamar a pessoa ("ah, como posso te chamar?") — só isso de pergunta.',
    empilhou_perguntas:'Deixe NO MÁXIMO UMA pergunta. Corte as perguntas extras.',
    textao:            'Encurte para 1-2 balões curtos de WhatsApp. Sem parágrafo longo.',
    inventou:          'Remova qualquer dado que não foi informado (preço/link/horário/política). Diga que o time confirma na conversa.',
    agendamento_fake:  'NÃO diga que agendou/confirmou. Não existe reunião criada. Apenas conduza sem afirmar fechamento.',
    inconsistente:     'Alinhe com o estado real: se já está agendado, confirme o horário existente; não reofereça nem repita o que já foi dito.',
    robotico:          'Reescreva com tom humano e presença, sem frases de robô cordial ("tranquilo!", "à disposição").',
};

/**
 * CORRETOR — reescreve o rascunho corrigindo SÓ os problemas apontados. Usa o modelo FORTE
 * (gpt-oss), nunca o fraco, pra não degradar a qualidade do texto que vai pro cliente.
 * Retorna o texto corrigido ou null (se falhar → caller mantém o rascunho original).
 */
async function corrigir({ draft = '', problemas = [], historico = [], promptBase = '' } = {}) {
    try {
        if (!draft || !problemas.length) return null;
        const instrucoes = problemas.map(p => _DICAS[p]).filter(Boolean).map((d, i) => `${i + 1}. ${d}`).join('\n');
        if (!instrucoes) return null;

        const prompt = `${promptBase ? promptBase + '\n\n' : ''}Você escreveu este rascunho de resposta no WhatsApp:
"""${draft}"""

Um supervisor apontou estes problemas. Reescreva a resposta corrigindo SOMENTE isto, mantendo sua persona e o contexto da conversa. NÃO invente informação nova. Responda APENAS com a mensagem final (sem explicações, sem aspas, sem tags):
${instrucoes}`;

        const raw = (await chamarLLM({
            messages: [...historico.slice(-6), { role: 'user', content: prompt }],
            model: MODELOS.cerebro, maxTokens: 260,
        }) || '').trim();
        const limpo = raw.replace(/^"+|"+$/g, '').trim();
        return limpo || null;
    } catch (e) {
        console.error('❌ [SUPERVISOR] corrigir falhou:', e.message);
        return null;
    }
}

module.exports = { revisar, corrigir };
