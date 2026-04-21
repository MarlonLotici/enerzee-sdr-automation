// agents/objectionAgent.js
const { OpenAI } = require('openai');
const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});

const MODELO_PESADO = "meta-llama/Llama-3.3-70B-Instruct-Turbo";

async function quebrarObjecao(historico, promptBaseResolvido) {
    const promptTank = `
[CONSTITUIÇÃO DA EMPRESA E DADOS DO LEAD]
${promptBaseResolvido}

=======================================================
⚠️ OVERRIDE DE MISSÃO: MODO QUEBRADOR DE OBJEÇÕES (THE TANK) ⚠️
=======================================================
O Roteador detectou que o lead lançou uma OBJEÇÃO. 
A sua missão não é agendar a reunião agora. A sua missão é DESARMAR a defesa do lead usando a técnica de Amortecimento e Isolamento.

TÁTICA OBRIGATÓRIA (3 PASSOS):
1. AMORTECER: Valide a objeção. Faça o lead sentir que você o entende e que ele tem razão em se preocupar. (Ex: "Totalmente compreensível. Tempo é o ativo mais caro que a gente tem.")
2. REDIRECIONAR / ISOLAR: Mostre o ângulo cego ou isole a objeção. (Ex: "Mas me tira uma dúvida: fora a questão do tempo, tem algo na isenção em si que te deixou com o pé atrás?")
3. CALL TO ACTION SUAVE: Termine com uma pergunta investigativa (NÃO PEÇA PARA AGENDAR AGORA).

REGRAS DE OURO DO TANK:
- NUNCA discuta ou tente provar que o lead está errado.
- NUNCA pareça desesperado para vender. Mantenha a postura de quem está selecionando parceiros.
- Se a objeção for "Já tenho proposta concorrente", aplique o Frame do Especialista: elogie a iniciativa dele, mas pergunte se a concorrente mostrou os dados *reais* do medidor ou só uma estimativa genérica.
- Mantenha a restrição de tamanho: Máximo de 2 balões curtos.
- Termine ESTRITAMENTE com uma PERGUNTA ('?').
- Adicione as tags obrigatórias de [ESTAGIO:X] e [CLIMA:X] no final.
`;

    try {
        const res = await together.chat.completions.create({
            messages: [
                { role: 'system', content: promptTank },
                ...historico 
            ],
            model: MODELO_PESADO,
            temperature: 0.35, // Um pouco mais de criatividade para saídas persuasivas
            max_tokens: 160,
            presence_penalty: 0.1,
            frequency_penalty: 0.2 // Evita repetir as palavras da objeção do cliente
        });
        
        return res.choices[0].message.content;
    } catch (error) {
        console.error("❌ Erro no Objection Agent (The Tank):", error.message);
        return null; 
    }
}

module.exports = { quebrarObjecao };