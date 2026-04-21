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

    [INSTRUÇÕES DE ANÁLISE INTERNA]
    Mentalmente, avalie a congruência (O chat bate com o CNPJ?) e busque Ouro Tático (turnos, equipamentos pesados, contas altas).

    [SAÍDA EXIGIDA - REGRA ABSOLUTA]
    NÃO escreva tópicos. NÃO escreva as palavras "Congruência" ou "Ouro Tático". NÃO explique seu raciocínio.
    Gere ÚNICA e EXCLUSIVAMENTE uma frase (máx 30 palavras) instruindo o vendedor.
    
    Exemplo de saída perfeita: "Lead confirmou uso intensivo de freezers. Aumente a urgência sobre o gasto contínuo de motores 24h e ignore a objeção de tempo."
    `;

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "llama-3.1-8b-instant", // Rápido, leve e analítico
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