// agents/conciergeAgent.js
// 🤝 MODO CONCIERGE (PÓS-AGENDAMENTO). O lead JÁ marcou a reunião — está convertido. Aqui a IA
// TROCA DE CHAPÉU: deixa de ser vendedora (SPIN, CTA, propor horário) e vira recepção/concierge.
// Só confirma, tira dúvidas e ajuda a remarcar/cancelar. As AÇÕES de agenda (remarcar/cancelar/
// confirmar com horário) são tratadas de forma determinística no orquestrarAgendamento (4_sdr.js)
// ANTES de chegar aqui; este agente responde o resto (dúvidas, agradecimentos, conversa solta).
const { chamarLLM, MODELOS } = require('../lib/llm');
const { alertaDegradacaoIA } = require('../notifier');

/**
 * @param {Array}  historico           - [{role, content}]
 * @param {Object} lead                - dados do lead (já booked)
 * @param {string} promptPersonalidade - Constituição já resolvida (quem é a IA, empresa, etc.)
 * @param {Object} opcoes              - { quando?: string, instanceType?: string }
 *   quando: rótulo do horário marcado (ex.: "amanhã às 10h") — pra confirmar com segurança.
 */
async function gerarRespostaConcierge(historico, lead, promptPersonalidade, opcoes = {}) {
    const quando = opcoes.quando || 'no horário combinado';
    // jaPassou: o horário marcado já ficou no passado. Confirmar "tá tudo certo pra hoje às 9h" às 14h soa robótico.
    const jaPassou = opcoes.jaPassou === true;
    const agora = opcoes.agora ? ` Agora é ${opcoes.agora}.` : '';
    const situacao = jaPassou
        ? `A reunião estava marcada para ${quando}, e esse horário JÁ PASSOU.${agora} Você não sabe se ela aconteceu.`
        : `A reunião está marcada para: ${quando}.${agora}`;
    const comoConfirmar = jaPassou
        ? `- Se ele der um "oi", NÃO trate a reunião como futura. Pergunte com leveza se conseguiram conversar com o consultor ou se ele quer remarcar.`
        : `- Se ele der um "oi" ou perguntar do horário, CONFIRME com segurança: tá tudo certo pra ${quando}.`;

    const blocoConcierge = `
=======================================================
🤝 MODO CONCIERGE — PÓS-AGENDAMENTO (LEIA E OBEDEÇA)
=======================================================
O lead JÁ AGENDOU a reunião — ele está CONVERTIDO. ${situacao}
Seu papel MUDOU: você NÃO é mais vendedora. Agora é a recepção/concierge que cuida de quem já marcou.

O QUE FAZER:
- Responder dúvidas (sobre a reunião ou o produto) de forma breve, clara e calorosa.
${comoConfirmar}
- Se ele quiser REMARCAR ou CANCELAR, apenas acolha — o sistema cuida do resto (não proponha horário você mesma).
- Deixe a porta aberta: "qualquer dúvida, é só me chamar".

PROIBIDO (CRÍTICO — quebrar isto irrita um cliente já conquistado):
- Tentar vender, qualificar (SPIN), reabrir o funil ou criar urgência.
- Perguntar "faz sentido marcarmos uma conversa?" — ELE JÁ MARCOU.
- Propor ou oferecer horário por conta própria.
- Empurrar CTA, pedir dados de qualificação, ou insistir em qualquer coisa.
- Terminar toda mensagem com pergunta de venda. Aqui pode encerrar com algo acolhedor, sem "?".

TOM: leve, prestativo, sem pressão nenhuma. Como uma boa recepcionista que já sabe que você vem.

[FORMATO]
- No máximo 2 balões curtos (~10-20 palavras cada). Use [QUEBRA] pra separar balões.
- Texto puro: sem asteriscos, sem markdown, sem placeholders entre colchetes.
- NÃO precisa de tags [ESTAGIO]/[CLIMA] aqui.`;

    const promptFinal = `${promptPersonalidade}
${blocoConcierge}`;
    const fallback = jaPassou
        ? 'Oi! 😊 Conseguiu conversar com o consultor? Se quiser remarcar, é só me falar!'
        : `Oi! 😊 Tá tudo certo pra nossa conversa ${quando}. Qualquer dúvida até lá, é só me chamar!`;

    try {
        const resposta = await chamarLLM({
            system: promptFinal,
            messages: historico,
            model: MODELOS.conversa,
            maxTokens: Number(process.env.LLM_MAXTOKENS_CLOSER) || 400,
        });
        if (!resposta || resposta.trim().length < 3) {
            console.warn(`⚠️ [CONCIERGE] LLM devolveu resposta vazia para ${lead?.name}.`);
            return fallback;
        }
        return resposta;
    } catch (error) {
        console.error(`❌ Erro no Concierge Agent:`, error.message);
        alertaDegradacaoIA('conciergeAgent', error).catch(() => {});
        return fallback;
    }
}

module.exports = { gerarRespostaConcierge };
