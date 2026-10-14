const { chamarLLM, MODELOS } = require('../lib/llm');

// ─────────────────────────────────────────────────────────────────────────────
// EXTRAÇÃO DE DADOS DO DECISOR
// Analisa a última mensagem + histórico recente e devolve JSON estruturado
// com o nome e o telefone da pessoa indicada pelo lead para repasse.
// ─────────────────────────────────────────────────────────────────────────────
async function extrairDadosDecisor(ultimaMsg, historico) {
    const ultimasMsgs = historico.slice(-6);

    const prompt = `Você é um extrator de dados estruturado para um sistema de vendas B2B.
Analise a ÚLTIMA MENSAGEM do lead e o HISTÓRICO RECENTE da conversa.
Sua única tarefa é identificar se o lead indicou outra pessoa (decisor) para contato.

Retorne SOMENTE um JSON válido, sem texto adicional, sem markdown, sem explicação.

CAMPOS:
- "nomeDecisor": string com o nome mencionado. Se não houver nome claro, use "Responsável". NUNCA retorne null.
- "telefoneDecisor": string com APENAS os dígitos do telefone (ex: "5548999991234"). Se não houver nenhum número de telefone explícito na mensagem, retorne null.

ÚLTIMA MENSAGEM DO LEAD: "${ultimaMsg}"

HISTÓRICO RECENTE:
${ultimasMsgs.map(m => `[${m.role}]: ${m.content}`).join('\n')}

Retorne apenas o JSON. Exemplo válido: {"nomeDecisor":"Carlos","telefoneDecisor":"5548999991234"}`;

    try {
        // cerebro, não rapido (2026-10-14): MODELOS.rapido (DeepSeek) é modelo de raciocínio e
        // devolvia VAZIO neste call → sempre caía no fallback genérico "Responsável"/null, perdendo
        // nome/telefone reais que o lead informou. gpt-oss resolve com folga e sai mais barato.
        const raw = (await chamarLLM({ messages: [{ role: 'user', content: prompt }], model: MODELOS.cerebro, maxTokens: 150 }) || '').trim() || '{}';
        const parsed = JSON.parse(raw);

        return {
            nomeDecisor:    parsed.nomeDecisor    || 'Responsável',
            telefoneDecisor: parsed.telefoneDecisor || null,
        };
    } catch (err) {
        console.error('❌ [HANDOFF] Erro ao extrair dados do decisor:', err.message);
        return { nomeDecisor: 'Responsável', telefoneDecisor: null };
    }
}

async function gerarResumoHandoff(historico) {
    // 1. Extrai as últimas mensagens para análise
    const ultimasMsgs = historico.slice(-8); // Lê o final da conversa
    
    const prompt = `Você é um coordenador de vendas. O humano "Marlon" assumiu a conversa com este lead e agora vai devolver para a Inteligência Artificial continuar o atendimento.
    
    Analise o histórico recente e gere APENAS um resumo de 1 ou 2 frases dizendo:
    1. O que o Marlon combinou ou respondeu para o lead.
    2. Em qual estágio o funil parou (ex: "lead concordou com a dor", "lead pediu simulador").
    
    Seja técnico e direto. Este texto será injetado no cérebro da IA para ela não se perder. NUNCA gere fala simulada.`;

    try {
        // cerebro, não rapido (2026-10-14): mesmo motivo — DeepSeek devolvia vazio, perdendo o
        // resumo que orienta a IA depois do humano devolver a conversa.
        const res = await chamarLLM({ system: prompt, messages: ultimasMsgs, model: MODELOS.cerebro, maxTokens: 150 });
        return res || "";
    } catch (error) {
        console.error("❌ Erro no Handoff Agent:", error.message);
        return "";
    }
}

module.exports = { gerarResumoHandoff, extrairDadosDecisor };