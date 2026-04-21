// agents/profilerAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function analisarPerfil(ultimaMsg) {
    const prompt = `
    Você é um Profiler de Vendas B2B.
    Leia a mensagem do lead e identifique o Perfil Comportamental e o Clima Emocional.

    MENSAGEM: "${ultimaMsg}"

    SAÍDA EXIGIDA (Gere apenas um parágrafo curto instruindo o Closer, sem explicações extras):
    1. Identifique se o lead é: PRAGMÁTICO (seco, direto), AFÁVEL (educado, usa emojis/rsrs) ou ANALÍTICO (faz perguntas lógicas).
    2. Identifique o clima: CURIOSO, IRRITADO, APRESSADO ou NEUTRO.
    3. Dê a instrução de tom de voz. Exemplo: "Lead pragmático e apressado. Responda em uma linha. Corte cordialidades."
    `;

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "llama3-8b-8192", // Rápido e barato
            temperature: 0.1,
            max_tokens: 60,
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ Erro no Profiler Agent:", e.message);
        return "Mantenha o tom profissional e direto.";
    }
}

module.exports = { analisarPerfil };