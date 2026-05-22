// agents/routerAgent.js
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Usando o modelo mais rápido para latência zero na triagem
const MODELO_ROTEADOR = "llama-3.1-8b-instant";

async function classificarMensagem(ultimaMensagemLead) {
    // 🛡️ NÍVEL 1: Blindagem de Custo Zero (Bypass Cego)
    if (!ultimaMensagemLead || ultimaMensagemLead.trim().length === 0) {
        return 'LIXO';
    }

    // 🛡️ NÍVEL 2: Detecção de Robô/Autoresposta (Regex — custo zero, latência zero)
    const padraoRobo = (
        /^(olá|oi|hello|bom dia|boa tarde|boa noite)[,!.\s]*\s*(como posso (ajudar|te atender)|em que posso|no que posso)/i.test(ultimaMensagemLead) ||
        /\b(atendimento automático|assistente virtual|chatbot|robô|este é um serviço automático|resposta automática|fora do horário de atendimento|horário de funcionamento)\b/i.test(ultimaMensagemLead) ||
        /^\s*\d+[\s\-–\.]\s*.{2,40}(\n\s*\d+[\s\-–\.]\s*.{2,40}){2,}/m.test(ultimaMensagemLead) || // menu numerado com 3+ itens
        /begin:vcard/i.test(ultimaMensagemLead) === false && /\[AUTORESPOSTA\]/.test(ultimaMensagemLead)
    );
    if (padraoRobo) {
        console.log("🤖 [ROTEADOR] Autoresposta/robô detectado. Bypass para ROBO.");
        return 'ROBO';
    }

    // 🛡️ NÍVEL 2b: Deteção de Repasse Direto (Regex — custo zero, latência zero)

    // 2a. Número de telefone isolado
    const textoLimpo = ultimaMensagemLead.replace(/[\s\-\(\)\+]/g, '');
    if (textoLimpo.length >= 8 && textoLimpo.length <= 13 && /^\d+$/.test(textoLimpo)) {
        console.log("⚡ [ROTEADOR] Número isolado detetado. Bypass automático para REPASSE.");
        return 'REPASSE';
    }

    // 2b. E-mail — lead passou contato por e-mail, é repasse direto
    if (/\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b/i.test(ultimaMensagemLead)) {
        console.log("⚡ [ROTEADOR] E-mail detetado. Bypass automático para REPASSE.");
        return 'REPASSE';
    }

    // 🧠 NÍVEL 3: Análise Semântica de Alta Precisão
    const prompt = `
Você é o classificador de intenções ultra-rápido de um sistema SDR B2B de alta performance.
A sua ÚNICA função é ler a mensagem do cliente e devolver ESTRITAMENTE UMA das 6 palavras-chave abaixo.

[REGRAS DE CLASSIFICAÇÃO]

1. COMPRA
- O lead ESTÁ PRONTO PARA AGENDAR ou deu sinal claro de aceite.
- Exemplos de aceite EXPLÍCITO: escolhe horário ("pode ser às 14h", "amanhã de manhã"), pede o link ("manda o link", "que link é esse?").
- Exemplos de aceite SUAVE (também é COMPRA): "pode ser", "combinado", "bora", "vamos lá", "pode marcar", "pode agendar", "tô dentro", "ok amanhã", "qualquer hora serve", "me chama amanhã".
- ⚠️ ALERTA: Dizer apenas "sim", "isso" ou "sou eu" NO INÍCIO da conversa NÃO É COMPRA, é CONTINUAR. Mas "sim" após uma proposta de horário específica É COMPRA.

2. CONTINUAR
- O lead confirmou uma informação ("sim", "sou eu", "correto", "exato", "👍").
- O lead mandou uma saudação ("opa", "bom dia", "pode falar").
- O lead respondeu positivamente a uma pergunta de qualificação ("a conta dá uns 1000 reais", "gasto muito").
- O lead fez perguntas genuínas ("como funciona?", "quem é vc?", "de onde tirou meu número?", "tem obra?").
- Esta é a intenção padrão para manter a conversa a fluir no funil.

3. REPASSE
- O lead indica outra pessoa ou passa um contacto (número, e-mail, ou nome).
- Exemplos directos: "fala com o meu sócio", "chama a Maria no 9999-9999", "não cuido disso", "não sou eu que trato disso aqui".
- Exemplos indirectos (SEM número/e-mail explícito): "vou te encaminhar o contato", "te passo o e-mail do responsável", "fala com o meu gerente", "a pessoa certa é o João", "manda pra quem cuida disso que não sou eu".
- ⚠️ CRÍTICO: Se o lead disse que VAI passar um contato (futuro), isso também é REPASSE — não confunda com CONTINUAR.

4. OBJECAO
- O lead resiste ativamente à abordagem ("tá caro", "sem tempo", "é golpe?", "já tenho energia solar", "não quero", "manda por email e eu leio depois").

5. ENCERRAMENTO
- O lead despede-se cordialmente sem intenção de continuar ("obrigado", "boa semana", "valeu", "fica com Deus").

6. LIXO
- Mensagens completamente ininteligíveis (ex: "asdfg", batidas no teclado) ou xingamentos sem contexto. 
- ⚠️ ALERTA: Respostas curtas como "ok", "tá", "entendi" NÃO SÃO LIXO, são CONTINUAR.

MENSAGEM DO CLIENTE: "${ultimaMensagemLead}"

Retorne APENAS a palavra da intenção. Nada de pontuação, aspas ou justificações.
`.trim();

    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: "system", content: prompt }],
            model: MODELO_ROTEADOR,
            temperature: 0.0, // Zero criatividade, queremos classificação determinística
            max_tokens: 10,
        });

        const resposta = res.choices[0].message.content.trim().toUpperCase();

        // Mapeamento à prova de balas
        if (resposta.includes('COMPRA')) return 'COMPRA';
        if (resposta.includes('OBJECAO') || resposta.includes('OBJEÇÃO')) return 'OBJECAO';
        if (resposta.includes('ENCERRAMENTO')) return 'ENCERRAMENTO';  
        if (resposta.includes('REPASSE')) return 'REPASSE';
        
        // 🎯 O SEGREDO DA SOLDADURA: 
        // O Roteador devolve "CONTINUAR" ou "DUVIDA" para a intenção de fluxo natural.
        // O código mapeia ambas para 'DUVIDA', pois no closerAgent.js, o modo 'DUVIDA' 
        // é o motor consultivo que faz a qualificação do maquinário (Estágio 1 e 2).
        if (resposta.includes('CONTINUAR') || resposta.includes('DUVIDA')) return 'DUVIDA';
        
        if (resposta.includes('LIXO')) return 'LIXO';
        
        // Fallback de segurança: se a LLM tiver um colapso e devolver um texto aleatório, 
        // assumimos que o lead está a continuar a conversa para não o perder.
        console.warn(`⚠️ [ROTEADOR] Resposta atípica da LLM: "${resposta}". Acionando Fallback (DUVIDA/CONTINUAR).`);
        return 'DUVIDA';
        
    } catch (error) {
        console.error("❌ Erro de processamento no Roteador (API Groq):", error.message);
        return 'DUVIDA'; 
    }
}

module.exports = { classificarMensagem };