// agents/objectionAgent.js
const { chamarLLM, MODELOS } = require('../lib/llm');

/**
 * Agente especialista em quebra de objeções (The Tank).
 * @param {Array} historico - O histórico de mensagens podado.
 * @param {string} promptBaseResolvido - A Constituição do tenant (única fonte de argumentos) + dados do lead.
 * @param {number|string} estagioAtual - A fase atual do funil no banco de dados (CRUCIAL para a soldadura).
 */
async function quebrarObjecao(historico, promptBaseResolvido, estagioAtual) {
    // 🛡️ Fallback de segurança: Se o estágio falhar na passagem, assume 0 para não quebrar a regex
    const estagioSeguro = estagioAtual !== undefined && estagioAtual !== null ? estagioAtual : 0;

    const promptTank = `
[CONSTITUIÇÃO DA EMPRESA E DADOS DO LEAD]
${promptBaseResolvido}

=======================================================
⚠️ MODO OBJEÇÃO: A PESSOA LEVANTOU UMA BARREIRA OU UM RECEIO
=======================================================
Sua única missão agora é acolher o receio e entender o que está por trás dele. Escreva em português do Brasil, como uma pessoa no WhatsApp.

NÃO TENTE AGENDAR A REUNIÃO NESTA MENSAGEM. A venda pausa até o receio ser tratado.

COMO RESPONDER (3 passos):
1. ACOLHER: concorde com o ponto de vista dela, sem contrariar. (Ex.: "Faz todo sentido ter esse cuidado.", "É verdade, a rotina é corrida mesmo.")
2. MOSTRAR O OUTRO LADO: traga o ângulo que ela não está vendo, de forma consultiva, usando a resposta que a Constituição dá para essa objeção. (Ex.: "O que muda é que...", "Me tira uma dúvida...")
3. DEVOLVER COM UMA PERGUNTA: termine com uma pergunta suave para entender melhor o receio.

[ARGUMENTOS]:
- Use SOMENTE argumentos, provas e respostas que estejam na CONSTITUIÇÃO acima.
- Se a Constituição não traz resposta para essa objeção, NÃO invente dado, lei, certificação, cliente ou número: acolha, entenda melhor o receio e devolva com uma pergunta.

[REGRAS]:
1. Tamanho: no máximo 2 balões curtos separados por [QUEBRA].
2. Termine com UMA pergunta ("?").
3. Sem abreviação (a mensagem pode virar áudio): "você", "também", "30 minutos".
4. No final, escreva EXATAMENTE a tag [ESTAGIO:${estagioSeguro}] e a tag de clima da reação dela, ex.: [CLIMA:DESCONFIADO] ou [CLIMA:OCUPADO].
`;

    try {
        const resposta = await chamarLLM({
            system: promptTank,
            messages: historico,
            model: MODELOS.cerebro,
            // Mesma folga do closer: modelo de raciocínio (DeepSeek V4 Pro) gasta tokens pensando antes de responder.
            maxTokens: Number(process.env.LLM_MAXTOKENS_CLOSER) || 400,
        });

        // 🛡️ BLINDAGEM DE ALTA PERFORMANCE: A IA esqueceu a tag? Nós injetamos à força via código.
        if (resposta && !resposta.includes('[ESTAGIO:')) {
            console.warn(`⚠️ [THE TANK] A IA esqueceu a tag de estado. Injetando [ESTAGIO:${estagioSeguro}] à força para manter a soldadura.`);
            return `${resposta} [ESTAGIO:${estagioSeguro}]`;
        }

        return resposta;
    } catch (error) {
        console.error("❌ Erro Crítico no Objection Agent (The Tank):", error.message);
        
        // Em caso de falha da API, devolve um fallback humano para não deixar o cliente no vácuo
        return `Faz sentido o seu cuidado. Me conta, o que te deixou com o pé atrás? [ESTAGIO:${estagioSeguro}] [CLIMA:NEUTRO]`;
    }
}

module.exports = { quebrarObjecao };