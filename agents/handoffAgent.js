const { OpenAI } = require('openai');
const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});
const MODELO_LEVE = "meta-llama/Llama-3.3-70B-Instruct-Turbo"; // Usando o mesmo modelo pra manter coerência

async function gerarResumoHandoff(historico) {
    // 1. Extrai as últimas mensagens para análise
    const ultimasMsgs = historico.slice(-8); // Lê o final da conversa
    
    const prompt = `Você é um coordenador de vendas. O humano "Marlon" assumiu a conversa com este lead e agora vai devolver para a Inteligência Artificial continuar o atendimento.
    
    Analise o histórico recente e gere APENAS um resumo de 1 ou 2 frases dizendo:
    1. O que o Marlon combinou ou respondeu para o lead.
    2. Em qual estágio o funil parou (ex: "lead concordou com a dor", "lead pediu simulador").
    
    Seja técnico e direto. Este texto será injetado no cérebro da IA para ela não se perder. NUNCA gere fala simulada.`;

    try {
        const res = await together.chat.completions.create({
            messages: [
                { role: 'system', content: prompt },
                ...ultimasMsgs
            ],
            model: MODELO_LEVE,
            temperature: 0.1, // Quase zero, queremos fatos, não criatividade
            max_tokens: 100
        });

        return res.choices[0]?.message?.content || "";
    } catch (error) {
        console.error("❌ Erro no Handoff Agent:", error.message);
        return "";
    }
}

module.exports = { gerarResumoHandoff };