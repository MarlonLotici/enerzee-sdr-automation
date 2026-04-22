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

⚠️ REGRA DE OURO: Respeite o ESTÁGIO ATUAL da Constituição acima.
Se o lead está no Estágio 1 (descobrindo a dor), NÃO pule pro Estágio 3 (fechamento).
Se o lead está no Estágio 2 (implicação), NÃO mande Calendly.

AÇÃO OBRIGATÓRIA:
- Responda a dúvida com confiança e CONTEXTO (20-30 palavras por balão).
- Use linguagem ACESSÍVEL primeiro. "Lei 14.300" só se o lead pedir detalhes técnicos.
- Em vez de "Lei 14.300", diga: "um benefício oficial", "uma isenção que virou lei em 2022", "um desconto regulamentado".
- Depois de responder, faça UMA pergunta que volte pro estágio atual do funil.
- Se o estágio atual é 1 (quebra-gelo/dor), volte perguntando sobre o VALOR da conta.
- Se o estágio atual é 2 (implicação), volte perguntando sobre o IMPACTO no caixa.
- Se a pergunta for "como conseguiu meu número?" ou "quem é vc?", use EXATAMENTE as respostas das Regras #7 e #9 da Constituição.

PROIBIDO:
- Pular direto pro CTA de "5 minutinhos" se o lead ainda não validou a dor.
- Usar jargão técnico (ANEEL, compensação, geração distribuída) antes do lead pedir.
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
1. Máximo 15 a 35 palavras por balão. Máximo 2 balões separados por [QUEBRA].
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