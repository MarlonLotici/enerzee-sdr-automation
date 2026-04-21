// agents/auditorAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function gerarAuditoria(historico, lead) {
    // Formata o histórico de forma legível para a IA
    const textoHistorico = historico.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');

    const prompt = `
    Você é um Auditor de Vendas B2B (Quality Assurance).
    Sua missão é ler a transcrição exata de uma conversa finalizada entre a nossa IA (ASSISTANT) e um cliente (USER).
    
    REGRA DE OURO: Você NÃO deve sugerir alterações no código ou nos prompts. Sua função é APENAS gerar um relatório analítico dos FATOS ocorridos na conversa.

    [DADOS DO LEAD]
    - Nome: ${lead.name}
    - Nicho: ${lead.niche}
    - Status Final: ${lead.status === 'booked' ? '✅ SUCESSO (Agendou)' : '❌ PERDIDO (Ignorou/Recusou)'}

    [TRANSCRIÇÃO DA CONVERSA]
    ${textoHistorico}

    [SUA TAREFA]
    Gere um relatório ESTRITAMENTE neste formato (seja muito curto e direto, máximo 2 frases por tópico):

    🔍 MOTIVO DO DESFECHO: (Explique por que a venda foi ganha ou perdida).
    🏆 PONTO FORTE DA IA: (Qual argumento a IA usou que funcionou bem?).
    ⚠️ OBJEÇÃO/FALHA: (Qual foi a objeção real do cliente ou onde a IA se perdeu?).
    `;

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "llama-3.1-8b-instant",
            temperature: 0.1, // Frio e calculista
            max_tokens: 300,
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ Erro no Auditor Agent:", e.message);
        return "Erro ao gerar auditoria.";
    }
}

module.exports = { gerarAuditoria };