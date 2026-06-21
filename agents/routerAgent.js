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
        /^\s*\d+[\s\-–\.]\s*.{2,40}(\n\s*\d+[\s\-–\.]\s*.{2,40}){2,}/m.test(ultimaMensagemLead) ||
        /begin:vcard/i.test(ultimaMensagemLead) === false && /\[AUTORESPOSTA\]/.test(ultimaMensagemLead) ||
        // Expanded bot patterns
        /\b(mensagem automática|sistema automático|bot de atendimento|atendente virtual|agente virtual|resposta gerada automaticamente)\b/i.test(ultimaMensagemLead) ||
        /\b(para falar com (um atendente|nossa equipe|um humano)|pressione \d|digite \d|selecione (uma opção|abaixo))\b/i.test(ultimaMensagemLead) ||
        /\b(ticket (aberto|criado|gerado)|protocolo n[oº°]?\.?\s*\d+|número do chamado)\b/i.test(ultimaMensagemLead) ||
        /\b(nosso horário de atendimento|estamos (disponíveis|online) (de|das|entre)|atendemos (de|das))\b/i.test(ultimaMensagemLead) ||
        /\b(obrigad[oa] por entrar em contato|sua mensagem foi recebida|em breve retornaremos|retornaremos em até)\b/i.test(ultimaMensagemLead) ||
        /\b(para (suporte|dúvidas|informações|compras|vendas|financeiro|cancelamento), (acesse|clique|vá|visite))\b/i.test(ultimaMensagemLead) ||
        /\b(este (número|canal|contato) (não recebe|não aceita) (respostas|mensagens))\b/i.test(ultimaMensagemLead) ||
        /\b(powered by|via (zendesk|intercom|freshdesk|hubspot|salesforce|rdstation))\b/i.test(ultimaMensagemLead) ||
        /\u{1F916}|\u{1F4AC}/u.test(ultimaMensagemLead) && /\b(automático|bot|virtual)\b/i.test(ultimaMensagemLead) ||
        // Padrões de bots imobiliários / chatbots comerciais
        /j[aá]\s+recebi\s+(?:sua|a\s+sua)\s+mensagem/i.test(ultimaMensagemLead) ||
        /logo\s+retorno\s+com\s+as\s+informa/i.test(ultimaMensagemLead) ||
        /seja\s+bem[\s-]?vind[oa]\s+[aà]/i.test(ultimaMensagemLead) ||
        /agradecemos\s+(?:o\s+)?(?:seu|sua)?\s*contato/i.test(ultimaMensagemLead) ||
        /em\s+breve\s+(?:um\s+de\s+)?(?:nosso|nossa)s?\s+(?:consultor|atendente|corretor|especialista)/i.test(ultimaMensagemLead) ||
        /logo\s+(?:um\s+de\s+)?(?:nosso|nossa)s?\s+(?:consultor|atendente|corretor)\s+entr/i.test(ultimaMensagemLead)
    );
    if (padraoRobo) {
        console.log("🤖 [ROTEADOR] Autoresposta/robô detectado. Bypass para ROBO.");
        return 'ROBO';
    }

    // 🛡️ NÍVEL 2b: Detecção de Engano / Número Errado (Regex — custo zero, latência zero)
    const padraoEngano = (
        /\bnúmero\s+(errado|incorreto|trocado)\b/i.test(ultimaMensagemLead) ||
        /\b(é\s+um?\s+)?engano\b/i.test(ultimaMensagemLead) ||
        /\b(esse|este)\s+(número|contato|celular|zap|whatsapp)\s+(é|foi|era)\s+(da|do|de)\s+\w/i.test(ultimaMensagemLead) ||
        /\b(não\s+)?(sou|somos)\s+mais\s+(de\s+|dessa\s+|desta\s+)?(empresa|loja|estabelecimento)\b/i.test(ultimaMensagemLead) ||
        /\bex[-\s]?sócio\b/i.test(ultimaMensagemLead) ||
        /\b(aqui|isso)\s+(não\s+)?(é|tem)\s+(empresa|negócio|loja|estabelecimento)\b/i.test(ultimaMensagemLead)
    );
    if (padraoEngano) {
        console.log("🚫 [ROTEADOR] Engano/número errado detectado. Bypass para ENGANO.");
        return 'ENGANO';
    }

    // 🛡️ NÍVEL 2c: Detecção de Já Tem Solar / Geração Ativa (Regex — custo zero, latência zero)
    const padraoSolar = (
        /\bjá\s+(ten[hm]o?s?|tem[oa]s?)\s+(placa|painel|sistema\s+solar|energia\s+solar|usina|geração|fotovoltai)/i.test(ultimaMensagemLead) ||
        /\b(placa|painel|sistema)\s+solar\s+(instalad|colocad|funcionando|ativo)/i.test(ultimaMensagemLead) ||
        /\bgeração\s+(própria|ativa|distribuída|solar)\b/i.test(ultimaMensagemLead) ||
        /\bjá\s+(somos?|sou)\s+(cliente|assinante|parceiro)\s+(da\s+usina|de\s+energia\s+solar|do\s+consórcio)/i.test(ultimaMensagemLead) ||
        /\bjá\s+(compensamos?|geramos?|produzimos?)\s+energ/i.test(ultimaMensagemLead) ||
        /\btemos?\s+(noss[ao]\s+)?(própri[ao]\s+)?(usina|geração|painel|placa)\b/i.test(ultimaMensagemLead)
    );
    if (padraoSolar) {
        console.log("☀️ [ROTEADOR] Lead já tem solar/geração ativa. Bypass para SOLAR.");
        return 'SOLAR';
    }

    // 🛡️ NÍVEL 2d: Deteção de Repasse Direto (Regex — custo zero, latência zero)

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
A sua ÚNICA função é ler a mensagem do cliente e devolver ESTRITAMENTE UMA das 7 palavras-chave abaixo.

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
- O lead resiste ativamente à abordagem ("tá caro", "sem tempo", "é golpe?", "não quero", "manda por email e eu leio depois").
- ⚠️ NÃO use OBJECAO para "já tenho solar/painel/geração" — esse caso é tratado antes desta análise.

5. ENCERRAMENTO
- O lead despede-se cordialmente sem intenção de continuar ("obrigado", "boa semana", "valeu", "fica com Deus").

6. LIXO
- Mensagens completamente ininteligíveis (ex: "asdfg", batidas no teclado) ou xingamentos sem contexto.
- ⚠️ ALERTA: Respostas curtas como "ok", "tá", "entendi" NÃO SÃO LIXO, são CONTINUAR.

7. AGENDA_RETORNO
- O lead quer ser contactado num dia ou hora específica futura, sem aceitar a conversa agora.
- Exemplos: "me chama segunda", "me liga amanhã", "só na terça às 14h", "depois do feriado", "semana que vem tô disponível", "não posso agora, me manda mensagem amanhã cedo".
- ⚠️ DIFERENÇA DE COMPRA: COMPRA = lead aceita agendar AGORA (confirma horário, pede o link). AGENDA_RETORNO = lead empurra para um momento futuro sem se comprometer agora.

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
        if (resposta.includes('AGENDA_RETORNO') || resposta.includes('AGENDA')) return 'AGENDA_RETORNO';
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