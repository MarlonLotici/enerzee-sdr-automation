// agents/closerAgent.js
const { OpenAI } = require('openai');
const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});

const MODELO_PESADO = "meta-llama/Llama-3.3-70B-Instruct-Turbo";

/**
 * @param {Array} historico - Mensagens formatadas [{role, content}]
 * @param {Object} lead - Dados do lead
 * @param {string} promptPersonalidade - Constituição já resolvida (com variáveis substituídas)
 * @param {string} intencao - 'COMPRA' | 'DUVIDA' | 'LIXO' (vindo do Router)
 */
async function gerarRespostaCloser(historico, lead, promptPersonalidade, intencao = 'DUVIDA') {
    // 🧠 Injeção tática por intenção — evita conflito de instruções
    let overrideTatico = '';

    if (intencao === 'COMPRA') {
        overrideTatico = `
=======================================================
⚡ MODO OPERACIONAL: SINAL DE COMPRA DETECTADO
=======================================================
O lead demonstrou interesse claro em avançar (disse sim, aceitou horário, ou confirmou reunião).

AÇÃO OBRIGATÓRIA:
- Confirme de forma curta e seca (máx 15 palavras).
- Envie o link: https://calendly.com/marlonlotici6/30min
- Peça para ele ter uma fatura de luz em mãos na hora da call.
- Adicione [ESTAGIO:4] no final.
- NÃO explique novamente o benefício. NÃO faça rapport. APENAS trave o horário.
`;
    } else if (intencao === 'DUVIDA') {
        overrideTatico = `
=======================================================
🔍 MODO OPERACIONAL: DÚVIDA GENUÍNA
=======================================================
O lead fez uma pergunta real sobre o produto, processo, origem do contato, ou "do que se trata?".

AÇÃO OBRIGATÓRIA:
- Responda a dúvida específica dele em UM balão curto (máx 25 palavras).
- Use [QUEBRA] e em seguida devolva a conversa ao funil com UMA pergunta que faça sentido pro estágio atual do lead.
- Siga O ESTÁGIO ATUAL da Constituição acima. NÃO pule pro fechamento se o lead ainda está descobrindo.
- Se a pergunta for "como conseguiu meu número?" ou "quem é vc?", use EXATAMENTE as respostas da Regra de Ouro #7 e #9 da Constituição.
`;
    } else {
        // LIXO — lead mandou algo sem conteúdo ("oi", "opa", "ok", "sim" solto fora de contexto)
        overrideTatico = `
=======================================================
💬 MODO OPERACIONAL: MENSAGEM DE BAIXO CONTEÚDO
=======================================================
O lead enviou algo curto e sem intenção clara (ex: "oi", "opa", "ok", "entendi", "sim" isolado).

AÇÃO OBRIGATÓRIA:
- NÃO assuma que é sinal de compra. NÃO mande Calendly.
- Siga EXATAMENTE o estágio atual do funil conforme a Constituição acima.
- Se for primeiro contato (Estágio 0), execute o quebra-gelo e confirmação de decisor.
- Se estiver no meio da conversa, reformule sua última pergunta com ângulo diferente (Regra 12 da Constituição — Checagem de Histórico).
- NUNCA repita a mesma pergunta que já fez antes.
- Máximo 2 balões, termine com pergunta.
`;
    }

    const promptFinal = `${promptPersonalidade}

${overrideTatico}

[REGRAS ABSOLUTAS DE ALTA PERFORMANCE]
1. Máximo 35 palavras por balão. Máximo 2 balões separados por [QUEBRA].
2. Termine SEMPRE com uma pergunta ("?"). Nunca afirmação final.
3. Nunca faça duas perguntas na mesma mensagem.
4. Adicione as tags [ESTAGIO:N] e [CLIMA:X] no final (marcadores invisíveis).
5. Texto puro: sem asteriscos, sem markdown.
`;

    try {
        const res = await together.chat.completions.create({
            messages: [
                { role: 'system', content: promptFinal },
                ...historico
            ],
            model: MODELO_PESADO,
            temperature: 0.35,
            max_tokens: 200,
            presence_penalty: 0.1,
            frequency_penalty: 0.15
        });

        const resposta = res.choices[0]?.message?.content;

        // 🛡️ Blindagem contra resposta vazia da LLM
        if (!resposta || resposta.trim().length < 3) {
            console.warn(`⚠️ [CLOSER] LLM devolveu resposta vazia ou muito curta. Intenção: ${intencao}`);
            return null;
        }

        return resposta;
    } catch (error) {
        console.error(`❌ Erro no Closer Agent (intenção: ${intencao}):`, error.message);
        return null;
    }
}

module.exports = { gerarRespostaCloser };