const { OpenAI } = require('openai');
const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});

const MODELO_CEREBRO = "meta-llama/Llama-3.3-70B-Instruct-Turbo";

async function gerarAuditoria(historico, lead) {
    const prompt = `Você é um Analista de Qualidade Sênior (QA) de Vendas B2B.
    Sua missão é ler o histórico de uma conversa encerrada pelo nosso SDR de IA e extrair dados cruciais para o nosso dashboard de métricas.
    
    Analise a conversa e retorne ESTRITAMENTE um objeto JSON válido (sem markdown, sem texto antes ou depois) com a seguinte estrutura:
    {
      "desfecho": "AGENDADO" | "PERDIDO_SOLAR" | "PERDIDO_CARO" | "PERDIDO_SILENCIO" | "PERDIDO_ROBO" | "PERDIDO_OUTRO",
      "nota_ia": <numero de 0 a 10 avaliando o quão bem a IA seguiu o script e soou humana>,
      "erro_critico_ia": "<Se a IA errou (ex: foi repetitiva, alucinou), descreva em 1 frase. Se foi perfeita, retorne nulo>",
      "resumo_executivo": "<1 frase resumindo o que aconteceu>"
    }`;

    try {
        const res = await together.chat.completions.create({
            messages: [
                { role: 'system', content: prompt },
                ...historico.map(m => ({ role: m.role, content: m.content }))
            ],
            model: MODELO_CEREBRO,
            temperature: 0.1, // Temperatura quase zero para JSON estrito
            max_tokens: 150,
            response_format: { type: "json_object" } // Força a saída JSON na API da Together
        });

        const resposta = res.choices[0]?.message?.content;
        return JSON.parse(resposta); // Retorna um objeto JavaScript pronto para o banco
    } catch (error) {
        console.error(`❌ [QA AUDITOR] Falha ao auditar ${lead.name}:`, error.message);
        return null;
    }
}

module.exports = { gerarAuditoria };