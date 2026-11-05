'use strict';
/**
 * CHECAGEM POR CONTEXTO antes de propor horário. A palavra-chave ("agendar", "horário"...) ou o
 * roteador (COMPRA) viram só GATILHO: antes de oferecer slots, a IA lê as ÚLTIMAS 3 mensagens do
 * lead + a última fala da Sofia + o tempo de resposta e decide se é mesmo uma PESSOA pedindo pra
 * marcar CONOSCO.
 *
 * Bug 2026-11-05 (Andreia Freitas): a saudação automática do WhatsApp Business dela ("Obrigado pelo
 * contato. Para agendar, escolha o serviço e o horário por aqui") chegou 7s depois da nossa
 * apresentação; a palavra "agendar" disparou a oferta de horários pra um robô.
 *
 * Puro (sem I/O): monta o prompt e interpreta a resposta. A chamada ao LLM fica no 4_sdr.js.
 */

const CLASSES = ['pedido_agendamento', 'resposta_automatica', 'outro'];

const _aspas = (t) => `"${String(t || '').replace(/\s+/g, ' ').trim().slice(0, 400)}"`;

/**
 * @param {object} p
 * @param {Array}  p.historico  [{role, content}] em ordem cronológica
 * @param {number|null} p.segundosDesdeNossaFala  tempo entre a última fala da IA e a resposta do lead
 */
function montarPromptSinalAgendamento({ historico = [], segundosDesdeNossaFala = null } = {}) {
    const doLead = historico.filter(m => m?.role === 'user').slice(-3).map(m => m.content);
    const ultimaIA = [...historico].reverse().find(m => m?.role === 'assistant')?.content || '(nenhuma)';
    const tempo = Number.isFinite(segundosDesdeNossaFala) ? `${Math.max(0, Math.round(segundosDesdeNossaFala))} segundos` : 'desconhecido';
    const system = 'Você analisa conversas de WhatsApp de uma empresa que atende clientes com uma assistente de IA. Responda APENAS com um JSON válido, sem texto antes ou depois.';
    const user = `Última fala da NOSSA assistente:
${_aspas(ultimaIA)}

Últimas mensagens do CONTATO (da mais antiga para a mais recente):
${doLead.map((t, i) => `${i + 1}. ${_aspas(t)}`).join('\n') || '(nenhuma)'}

Tempo entre a nossa última fala e a resposta do contato: ${tempo}.

Classifique a ÚLTIMA mensagem do contato, considerando o contexto das anteriores:
- "pedido_agendamento": uma PESSOA pedindo ou aceitando marcar uma conversa/reunião/call CONOSCO.
- "resposta_automatica": mensagem automática do WhatsApp do próprio contato (saudação, ausência, menu, link de agendamento do NEGÓCIO DELE), não escrita na hora por uma pessoa. Sinais: chega poucos segundos depois da nossa fala, texto genérico de boas-vindas ("obrigado pelo contato"), instruções como "escolha o serviço", "clique no link", "nosso horário de atendimento", e não responde ao que dissemos.
- "outro": qualquer outra coisa (dúvida, resposta de uma pergunta, conversa normal). Na dúvida entre pedido e outro, escolha "outro".

Responda só: {"classe":"pedido_agendamento|resposta_automatica|outro","motivo":"até 15 palavras"}`;
    return { system, messages: [{ role: 'user', content: user }] };
}

/** Lê a resposta do LLM. Devolve {classe, motivo} ou null se ilegível (quem chama trata null como "não propõe"). */
function interpretarSinalAgendamento(texto) {
    const bruto = String(texto || '');
    const m = bruto.match(/\{[\s\S]*\}/);
    if (m) {
        try {
            const j = JSON.parse(m[0]);
            const classe = String(j.classe || '').trim().toLowerCase();
            if (CLASSES.includes(classe)) return { classe, motivo: String(j.motivo || '').slice(0, 160) };
        } catch (_) { /* cai no fallback abaixo */ }
    }
    // Fallback: o modelo escreveu só o rótulo.
    const achada = CLASSES.find(c => bruto.toLowerCase().includes(c));
    return achada ? { classe: achada, motivo: '' } : null;
}

module.exports = { CLASSES, montarPromptSinalAgendamento, interpretarSinalAgendamento };
