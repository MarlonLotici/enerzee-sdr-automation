// agents/closerAgent.js
const { OpenAI } = require('openai');
const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});

// Mantemos o modelo de 70B porque o fecho exige alta inteligência emocional
const MODELO_PESADO = "meta-llama/Llama-3.3-70B-Instruct-Turbo";

async function gerarRespostaCloser(historico, lead, promptPersonalidade) {
    // A Mágica Híbrida: Unimos o cérebro do Supabase com a estratégia "Caminho do Meio"
  const promptSocratico = `
[CONSTITUIÇÃO DA EMPRESA E REGRAS DE FORMATAÇÃO]
${promptPersonalidade} // <-- AQUI ENTRA O SEU TEXTO GIGANTE DO SUPABASE INTACTO

=======================================================
⚠️ OVERRIDE DE MISSÃO: MODO CLOSER SOCRÁTICO ATIVADO ⚠️
=======================================================
O Roteador já classificou que o lead tem intenção de avançar (Dúvida ou Interesse).
IGNORE as instruções de quebra-gelo ou Estágio 0 e 1 da constituição acima.

A SUA ÚNICA MISSÃO AGORA É O FECHAMENTO (Estágio 3/4) USANDO A TÁTICA ABAIXO:

1. Não atire o link do Calendly de imediato.
2. Exponha uma "ferida" estratégica sobre a taxa de distribuição.
3. Termine forçando o lead a aceitar uma chamada de 10 minutos amanhã (Manhã ou Tarde).
4. MANTENHA as regras absolutas de formato do Supabase (Máx 2 balões, tag [ESTAGIO], tag [CLIMA], e terminar com '?').
`;

    try {
        const res = await together.chat.completions.create({
            messages: [
                { role: 'system', content: promptSocratico },
                ...historico // O histórico podado que o Maestro já preparou
            ],
            model: MODELO_PESADO,
            temperature: 0.3,
            max_tokens: 160,
            presence_penalty: 0.1,
            frequency_penalty: 0.15
        });
        
        return res.choices[0].message.content;
    } catch (error) {
        console.error("❌ Erro no Closer Agent:", error.message);
        return null; // O Maestro (4_sdr.js) sabe lidar com o null se a API falhar
    }
}

module.exports = { gerarRespostaCloser };