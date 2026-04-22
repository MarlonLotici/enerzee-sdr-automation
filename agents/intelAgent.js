// agents/intelAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function analisarEmpresa(historico, lead) {
    // 🛡️ Blindagem 1: histórico muito curto = não tem o que analisar
    const mensagensUsuario = historico.filter(m => m.role === 'user');
    if (mensagensUsuario.length < 2) {
        return `Conversa muito inicial. Sem dados comportamentais ainda. Mantenha abordagem padrão da Constituição.`;
    }

    // 🛡️ Blindagem 2: usa só últimas 6 mensagens (foco no presente)
    const historicoRecente = historico
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'Cliente' : 'Vendedor'}: ${m.content}`)
        .join('\n');

    const prompt = `
Você é um Analista de Inteligência B2B ULTRA RIGOROSO. Sua função é cruzar dados de CNPJ com o que o lead REALMENTE DISSE no chat.

REGRA ABSOLUTA DE HONESTIDADE:
- Você NÃO PODE inventar fatos. Se o lead não mencionou algo, NÃO ESCREVA que ele mencionou.
- Se a conversa não tem sinais táticos claros, responda APENAS: "Sem sinais táticos relevantes. Seguir Constituição padrão."
- É MELHOR dizer "sem dados" do que inventar.

[DADOS OFICIAIS DO CRM]
- Empresa: ${lead.name || 'não informado'}
- Nicho: ${lead.niche || 'não informado'}
- Estado: ${lead.estado || 'não informado'}
- Capital Social: R$ ${lead.capital_social_numeric || 0}

[O QUE O LEAD REALMENTE ESCREVEU]
${historicoRecente}

[ANÁLISE INTERNA OBRIGATÓRIA]
Antes de responder, pergunte a si mesmo:
1. O lead mencionou explicitamente algum equipamento, valor, turno, problema, concorrente?
2. O lead expressou alguma dor específica (conta alta, desperdício)?
3. Há alguma congruência ou incongruência entre o CNPJ e a fala dele?

Se a resposta pra TODAS as 3 for "não", responda:
"Sem sinais táticos relevantes. Seguir Constituição padrão."

Se houver sinal REAL e EXPLÍCITO (citado pelo lead), gere UMA frase de até 25 palavras com a instrução tática.

[SAÍDA EXIGIDA]
Uma única frase curta. Sem tópicos, sem explicação, sem inventar.
    `.trim();

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: "llama-3.1-8b-instant",
            temperature: 0,  // 🎯 ZERO criatividade — evita alucinação
            max_tokens: 80,
        });
        return res.choices[0].message.content.trim();
    } catch (e) {
        console.error("❌ Erro no Intel Agent:", e.message);
        return `Sem dados adicionais. Seguir Constituição padrão.`;
    }
}

module.exports = { analisarEmpresa };