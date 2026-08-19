// agents/objectionAgent.js
const { chamarLLM, MODELOS } = require('../lib/llm');

/**
 * Agente especialista em quebra de objeções (The Tank).
 * @param {Array} historico - O histórico de mensagens podado.
 * @param {string} promptBaseResolvido - A Constituição com os dados do lead (nicho, economia, etc).
 * @param {number|string} estagioAtual - A fase atual do funil no banco de dados (CRUCIAL para a soldadura).
 */
async function quebrarObjecao(historico, promptBaseResolvido, estagioAtual) {
    // 🛡️ Fallback de segurança: Se o estágio falhar na passagem, assume 0 para não quebrar a regex
    const estagioSeguro = estagioAtual !== undefined && estagioAtual !== null ? estagioAtual : 0;

    const promptTank = `
[CONSTITUIÇÃO DA EMPRESA E DADOS DO LEAD]
${promptBaseResolvido}

=======================================================
⚠️ OVERRIDE DE MISSÃO: MODO QUEBRADOR DE OBJEÇÕES (THE TANK) ⚠️
=======================================================
O Roteador detetou que o lead levantou uma barreira defensiva ou objeção.
A sua ÚNICA missão agora é DESARMAR o lead usando a técnica de "Amortecimento e Isolamento". 

NÃO TENTE AGENDAR A REUNIÃO NESTA MENSAGEM. A venda pausa até a objeção ser neutralizada.

TÁTICA OBRIGATÓRIA (3 PASSOS):
1. AMORTECER: Concorde com a perspetiva dele. Faça-o sentir que não o está a contrariar. 
   (Ex: "Totalmente compreensível ter esse cuidado.", "Faz sentido, tempo é corrido mesmo.")
2. ISOLAR/REDIRECIONAR: Mostre o ângulo cego de forma consultiva ou faça uma concessão.
   (Ex: "A questão é que...", "Mas tira-me uma dúvida...")
3. PERGUNTA DE CONTROLO: Termine com uma pergunta investigativa e suave para devolver a bola para ele.

[SITUAÇÕES SIMULADAS E COMO AGIR]:
- Se "Já tenho proposta de outra empresa": Elogie a iniciativa, mas pergunte se a concorrente mostrou a simulação oficial da ANEEL ou só uma estimativa de Excel.
- Se "Mande por email / Mande PDF": Diga que manda sim, mas que o PDF fica genérico porque o valor exato só aparece cruzando os dados do medidor dele no sistema. Pergunte se a conta costuma ser alta para ver se vale a pena o trabalho.
- Se "É golpe? / Qual a pegadinha?": Concorde que o mercado tem muita coisa estranha. Reforce a lei 14.300 e a ANEEL.
- Se "Não tenho tempo": Isole. "Tranquilo. Se eu te provar a economia em 2 minutos por mensagem mesmo, vale a tua atenção?"

[REGRAS DE OURO DA SOLDADURA - PENA DE FALHA CRÍTICA]:
1. Tamanho: Máximo absoluto de 2 balões curtos separados por [QUEBRA].
2. Formato: SEMPRE termine com uma pergunta aberta ("?"). NUNCA termine com afirmação.
3. ⚠️ MARCADOR DE ESTADO (OBRIGATÓRIO): No final da sua resposta, você DEVE escrever EXATAMENTE a tag [ESTAGIO:${estagioSeguro}]. Se você não enviar esta tag, o sistema vai colapsar.
4. EMOÇÃO: Adicione a tag de clima correspondente à reação dele, ex: [CLIMA:DESCONFIADO] ou [CLIMA:OCUPADO].
`;

    try {
        const resposta = await chamarLLM({
            system: promptTank,
            messages: historico,
            model: MODELOS.cerebro,
            maxTokens: 400, // folga p/ o gpt-oss não cortar a resposta no meio (latência não é gargalo)
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
        return `Entendo perfeitamente o teu ponto. Mas deixa-me perguntar de outra forma: considerando os custos fixos da empresa hoje, faz sentido avaliarmos uma redução se isso não te custar nada agora? [ESTAGIO:${estagioSeguro}] [CLIMA:NEUTRO]`;
    }
}

module.exports = { quebrarObjecao };