// agents/routerAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Usamos um modelo rápido e barato apenas para triagem
const MODELO_ROTEADOR = "llama3-8b-8192"; 

async function classificarMensagem(ultimaMensagemLead) {
    const prompt = `
    És o supervisor de tráfego de um CRM.
    Lê a mensagem do cliente e classifica-a com UMA das seguintes tags (apenas a tag, sem texto adicional):
    
    [OBJECAO] - O cliente diz que é caro, que não tem tempo, ou que já tem energia solar.
    [DUVIDA] - O cliente faz uma pergunta sobre como funciona, prazos, ou pede informações técnicas.
    [COMPRA] - O cliente demonstra interesse claro, pergunta o próximo passo, envia a fatura ou aceita ouvir a proposta.
    [LIXO] - Mensagens curtas sem intenção ("ok", "bom dia", "tá").

    Mensagem: "${ultimaMensagemLead}"
    `;

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: MODELO_ROTEADOR,
            temperature: 0.1,
            max_tokens: 10,
        });
        
        const resposta = res.choices[0].message.content.trim().toUpperCase();
        
        if (resposta.includes('OBJECAO')) return 'OBJECAO';
        if (resposta.includes('DUVIDA')) return 'DUVIDA';
        if (resposta.includes('COMPRA')) return 'COMPRA';
        return 'LIXO'; // Fallback padrão
    } catch (error) {
        console.error("❌ Erro no Roteador:", error.message);
        return 'DUVIDA'; // Em caso de falha, assume que é dúvida para não forçar vendas
    }
}

module.exports = { classificarMensagem };