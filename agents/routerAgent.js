// agents/routerAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELO_ROTEADOR = "llama-3.1-8b-instant";

async function classificarMensagem(ultimaMensagemLead) {
    // 🛡️ Blindagem: se vier vazio, devolve LIXO sem gastar token
    if (!ultimaMensagemLead || ultimaMensagemLead.trim().length === 0) {
        return 'LIXO';
    }

const prompt = `
Você é um classificador de intenções ultra-rápido de vendas B2B no WhatsApp.
Leia a mensagem do cliente e classifique ESTRITAMENTE em UMA destas 5 opções:

COMPRA - Cliente demonstra interesse claro, concorda em avançar, aceita reunião, diz "sim", "pode ser", "amanhã", "quero", "fechado", "vamos", escolhe horário.

DUVIDA - Cliente faz perguntas genuínas sobre o produto/processo: "como funciona?", "o que é?", "pq tá falando isso?", "quem é você?", "de onde veio meu número?", "do que se trata?", pergunta por valor, prazo, segurança.

OBJECAO - Cliente resiste ativamente: "tá caro", "sem tempo", "é golpe?", "vou pensar", "não quero", "já tenho proposta", "tô sem grana", "não é o momento", "manda por email".

ENCERRAMENTO - Cliente está se despedindo ou finalizando cordialmente SEM perguntar nada: "obrigado", "boa semana", "desejo o mesmo", "fica com Deus", "até logo", "abraço", "bom dia pra vc também". 
IMPORTANTE: Se a mensagem é claramente uma despedida/resposta cordial a uma despedida anterior, classifique como ENCERRAMENTO — NÃO como DUVIDA nem COMPRA.

LIXO - Mensagens sem conteúdo acionável: "oi", "opa", "ok", "legal", "entendi", "tá", emojis isolados, monossílabos sem contexto específico.

MENSAGEM DO CLIENTE: "${ultimaMensagemLead}"

Responda APENAS com a palavra da classificação em maiúsculas. Sem pontuação, sem explicação.
    `.trim();


    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: MODELO_ROTEADOR,
            temperature: 0.1,
            max_tokens: 10,
        });

        const resposta = res.choices[0].message.content.trim().toUpperCase();

        // Ordem importa: checa COMPRA antes porque "COMPRA" não contém outras palavras,
        // mas se a LLM devolver algo tipo "É COMPRA", pega certo.
        if (resposta.includes('COMPRA')) return 'COMPRA';
        if (resposta.includes('OBJECAO') || resposta.includes('OBJEÇÃO')) return 'OBJECAO';
         if (resposta.includes('ENCERRAMENTO')) return 'ENCERRAMENTO';  
        if (resposta.includes('DUVIDA') || resposta.includes('DÚVIDA')) return 'DUVIDA';
        if (resposta.includes('LIXO')) return 'LIXO';

        // Se a LLM devolveu algo inesperado, default seguro é DUVIDA
        // (manda pro Closer, que é mais educado que tratar como lixo)
        console.warn(`⚠️ [ROTEADOR] Resposta inesperada da LLM: "${resposta}". Fallback → DUVIDA`);
        return 'DUVIDA';
    } catch (error) {
        console.error("❌ Erro no Roteador:", error.message);
        return 'DUVIDA'; // Em falha de API, assume dúvida (não ignora o lead)
    }
}

module.exports = { classificarMensagem };