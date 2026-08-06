// agents/profilerAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { alertaDegradacaoIA } = require('../notifier');

async function analisarPerfil(ultimaMsg) {
    const prompt = `
    Você é um Profiler de Vendas B2B.
    Leia a mensagem do lead e identifique internamente o Perfil Comportamental (pragmático, afável, analítico) e o Clima Emocional (curioso, irritado, apressado, neutro).

    MENSAGEM: "${ultimaMsg}"

    [SAÍDA EXIGIDA - REGRA ABSOLUTA]
    NÃO use números (1., 2., 3.). NÃO explique os motivos da sua análise.
    Gere APENAS UMA FRASE curta de instrução direta para o tom de voz do Closer.
    
    Exemplo de saída perfeita: "Lead pragmático e apressado. Responda em uma única linha direta, corte cordialidades e vá direto ao número."
    `;

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "llama-3.1-8b-instant", // Rápido e barato
            temperature: 0.1,
            max_tokens: 60,
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ Erro no Profiler Agent:", e.message);
        alertaDegradacaoIA('profilerAgent', e).catch(() => {});
        return "Mantenha o tom profissional e direto.";
    }
}

module.exports = { analisarPerfil };