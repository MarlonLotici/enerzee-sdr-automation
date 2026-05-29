const { OpenAI } = require('openai');
const Groq = require('groq-sdk');

const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELO_LEVE    = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const MODELO_DECISOR = "llama-3.3-70b-versatile";

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
        const res = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: MODELO_DECISOR,
            temperature: 0.0,
            max_tokens: 60,
        });

        const raw = res.choices[0]?.message?.content?.trim() || '{}';
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

module.exports = { gerarResumoHandoff, extrairDadosDecisor };