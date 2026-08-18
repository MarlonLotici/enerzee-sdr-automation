// agents/profilerAgent.js
const { chamarLLM, MODELOS } = require('../lib/llm');
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
        const res = await chamarLLM({ messages: [{ role: 'user', content: prompt }], model: MODELOS.rapido, maxTokens: 60 });
        return (res || '').trim() || "Mantenha o tom profissional e direto.";
    } catch (e) {
        console.error("❌ Erro no Profiler Agent:", e.message);
        alertaDegradacaoIA('profilerAgent', e).catch(() => {});
        return "Mantenha o tom profissional e direto.";
    }
}

module.exports = { analisarPerfil };