// agents/intelAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function analisarEmpresa(historico, lead) {
    // Pega apenas as últimas 6 mensagens para não sobrecarregar o modelo rápido
    // e focar no que é relevante AGORA.
    const historicoRecente = historico
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'Cliente' : 'Vendedor'}: ${m.content}`)
        .join('\n');

    const prompt = `
    Você é um Analista de Inteligência B2B (Data Enrichment). 
    Sua missão é cruzar os dados frios e oficiais do CNPJ com o que o cliente REALMENTE está dizendo no WhatsApp agora, gerando um BRIEFING TÁTICO para o vendedor (Closer).

    [DADOS OFICIAIS DO CRM]
    - Empresa: ${lead.name}
    - Nicho: ${lead.niche}
    - Estado: ${lead.estado}
    - Capital Social: R$ ${lead.capital_social_numeric || 0}

    [A REALIDADE NO CHAT AGORA]
    ${historicoRecente || "Nenhuma conversa ainda (Primeiro contato)."}

    [SUA TAREFA]
    1. CONGRUÊNCIA: O que ele diz no chat bate com o CNPJ? (Ex: o CNPJ diz padaria, mas ele falou de máquinas de solda?).
    2. OURO TÁTICO: Ele revelou algum detalhe operacional? (Ex: turnos, equipamentos pesados, filiais, contas altas).
    3. GERE O BRIEFING: Escreva no máximo 50 palavras instruindo o Vendedor sobre como se posicionar baseando-se nessa fusão de dados. Seja cirúrgico.

    RESPOSTA ESTRITAMENTE EM PORTUGUÊS (Direto ao ponto, formato de ordem militar):
    `;

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "llama3-8b-8192", // Rápido, leve e analítico
            temperature: 0.1, // Quase zero alucinação, foco em fatos
            max_tokens: 120,
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ Erro no Intel Agent:", e.message);
        // Fallback blindado caso a API falhe
        return `Aborde como uma empresa do ramo de ${lead.niche || 'varejo'}. Foco em redução de custos operacionais.`;
    }
}

module.exports = { analisarEmpresa };