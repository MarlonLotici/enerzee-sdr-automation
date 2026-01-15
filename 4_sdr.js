/**
 * 4_sdr.js - MÓDULO DE VENDAS NEURAL V5 (MASTER ARCHITECTURE)
 * Focado em: Abordagem Sniper, Gestão de Estado e Negociação Autônoma via LLM.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal'); // Para dev local (terminal)
const Groq = require('groq-sdk');
const fs = require('fs');
require('dotenv').config();

// --- CONFIGURAÇÃO DE INTELIGÊNCIA ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO_CEREBRO = "llama-3.3-70b-versatile"; // O melhor custo-benefício atual

// --- BANCO DE DADOS EM MEMÓRIA (Persistência Leve) ---
// Em produção SaaS, isso seria substituído por chamadas SQL/Redis
const DB_FILE = 'sdr_db.json';
let db = {
    leads: {},          // Dados ricos dos leads (by ID)
    conversations: {},  // Histórico de mensagens
    blacklist: [],      // Números bloqueados
    queue: [],          // Fila de disparo
    stats: { sent: 0, replied: 0, converted: 0 }
};

// Carrega DB se existir
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch(e) {}
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- CLIENTE WHATSAPP ---
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './wpp_session' }), // Salva sessão
    puppeteer: {
        headless: true, // "new"
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// --- VARIÁVEIS DE CONTROLE ---
let isReady = false;
let socketRef = null; // Referência para comunicar com o Frontend
const PROCESS_INTERVAL = 45000; // 45s a 90s entre disparos (Humanizado)

// ============================================================================
// 🧠 NÚCLEO DE INTELIGÊNCIA ARTIFICIAL
// ============================================================================

/**
 * O JUIZ: Analisa a intenção do cliente sem responder.
 * Classifica em: INTERESSE, DUVIDA, NEGATIVO, ROBO, HUMANO_REQ
 */
async function analisarIntencao(historico) {
    const prompt = `
    Analise a conversa abaixo. Você é um classificador de leads para energia solar.
    Classifique a última intenção do cliente em UMA das categorias:
    [INTERESSE] - Quer saber mais, perguntou preço, disse sim.
    [DUVIDA] - Fez uma pergunta técnica ou sobre a empresa.
    [NEGATIVO] - Disse não, não tenho interesse, pare, já tenho.
    [ROBO] - Mensagem automática, URA, "digite 1".
    [HUMANO] - Pede para falar com atendente real ou está muito confuso.

    Histórico:
    ${historico}
    
    Responda APENAS a tag.
    `;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: MODELO_CEREBRO,
            temperature: 0,
            max_tokens: 10
        });
        return chatCompletion.choices[0].message.content.trim();
    } catch (e) {
        return "[HUMANO]"; // Fallback seguro
    }
}

/**
 * O CLOSER: Gera a resposta de negociação.
 */
async function gerarResposta(historico, contextoLead) {
    const nomeLead = contextoLead.dono || contextoLead.name || "Gestor";
    const nomeEmpresa = contextoLead.name || "sua empresa";
    
    const systemPrompt = `
    Você é o Assistente Comercial Sênior da Enerzee. Seu objetivo é agendar uma reunião de consultoria energética.
    Seu tom é: Profissional, breve e direto. Sem "gírias de bot", sem "Prezado". Aja como um executivo ocupado.
    
    DADOS DO LEAD:
    Nome: ${nomeLead}
    Empresa: ${nomeEmpresa}
    Contexto: Empresa com provável alto consumo de energia.

    REGRAS:
    1. Responda em no máximo 2 frases curtas.
    2. Se o cliente mostrar interesse, o objetivo é enviar este link: https://calendly.com/seu-link
    3. Se perguntarem preço: "Depende da média de consumo, preciso simular. Posso te mandar o link da agenda?"
    4. Se disserem que já têm: "Show! O sistema atende 100% ou ainda paga algo pra concessionária?" (Tente cavar expansão).
    `;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...historico
            ],
            model: MODELO_CEREBRO,
            temperature: 0.3, // Leve criatividade
            max_tokens: 150
        });
        return chatCompletion.choices[0].message.content;
    } catch (e) {
        return "Desculpe, estou em trânsito agora. Pode me chamar em 10min?"; // Disfarce
    }
}

// ============================================================================
// 🎮 MOTOR DE FLUXO (WORKFLOW)
// ============================================================================

/**
 * Recebe um lead do pipeline (Scraper -> Clean -> Enrich -> SDR)
 */
function processarLeadEntrada(lead, socket) {
    if (!socketRef && socket) socketRef = socket; // Guarda ref do socket

    // 1. Validação de Elegibilidade
    if (lead.type !== 'mobile') {
        if(socketRef) socketRef.emit('notification', `⏩ Lead ${lead.name} pulado (Fixo).`);
        return;
    }
    
    if (db.blacklist.includes(lead.whatsappId)) return;
    if (db.leads[lead.whatsappId]) return; // Já existe/processado

    // 2. Salva no DB
    db.leads[lead.whatsappId] = lead;
    db.queue.push(lead.whatsappId);
    saveDB();

    if(socketRef) socketRef.emit('notification', `📥 Lead ${lead.name} na fila de disparo.`);
}

/**
 * Loop de Disparo (Cronjob interno)
 */
async function loopDisparos() {
    if (!isReady || db.queue.length === 0) return;

    // Pega o próximo
    const zapId = db.queue.shift();
    const lead = db.leads[zapId];

    if (!lead) return;

    try {
        // --- ESTRATÉGIA SNIPER (ABORDAGEM) ---
        // Se temos o nome do sócio (Enrichment), usamos. Se não, usamos genérico.
        let msgInicial = "";
        
        if (lead.dono) {
            // Abordagem Hiper-Personalizada
            const primeiroNome = lead.dono.split(' ')[0];
            msgInicial = `Olá ${primeiroNome}, tudo bem? Sou da Enerzee.\n\nEncontrei a *${lead.name}* aqui nos nossos registros de potencial energético. Vocês já geram a própria energia aí?`;
        } else {
            // Abordagem Genérica (mas educada)
            msgInicial = `Olá, bom dia. Gostaria de falar com o responsável pela *${lead.name}*.\n\nÉ sobre a redução de custos fixos da unidade via Lei 14.300. É por aqui?`;
        }

        console.log(`⚡ Enviando para ${lead.name} (${zapId})...`);
        
        // Simula digitação
        const chat = await client.getChatById(zapId);
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, 3000)); // 3s digitando

        await client.sendMessage(zapId, msgInicial);
        
        // Registra histórico
        db.conversations[zapId] = [
            { role: 'assistant', content: msgInicial }
        ];
        db.stats.sent++;
        saveDB();

        if(socketRef) socketRef.emit('notification', `🚀 Mensagem enviada para: ${lead.name}`);

    } catch (e) {
        console.error(`Erro ao enviar para ${zapId}:`, e.message);
        // Se erro de número inválido, joga na blacklist
        if (e.message.includes('inválido') || e.message.includes('wid')) {
            db.blacklist.push(zapId);
        }
    } finally {
        saveDB();
        // Agenda o próximo loop com tempo aleatório para evitar ban
        const randomDelay = Math.floor(Math.random() * (90000 - 30000) + 30000); // 30s a 90s
        setTimeout(loopDisparos, randomDelay);
    }
}

// ============================================================================
// 📡 EVENTOS DO WHATSAPP
// ============================================================================

client.on('qr', (qr) => {
    console.log('QR Code recebido!');
    // Se tiver socket, manda pro front. Se não, mostra no terminal.
    if (socketRef) socketRef.emit('qr_code', qr);
    else qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Conectado e Pronto!');
    isReady = true;
    if (socketRef) socketRef.emit('whatsapp_status', 'CONNECTED');
    // Inicia o loop de disparos
    loopDisparos();
});

client.on('message', async (msg) => {
    if (msg.fromMe || msg.isGroupMsg) return;

    const zapId = msg.from;
    const lead = db.leads[zapId];

    // Só responde se for um lead conhecido (evita responder mãe/amigos se usar zap pessoal)
    if (!lead) return; 

    console.log(`📩 Resposta de ${lead.name}: ${msg.body}`);
    if(socketRef) socketRef.emit('message_received', { chatId: zapId, body: msg.body, name: lead.name });

    // Adiciona ao histórico
    if (!db.conversations[zapId]) db.conversations[zapId] = [];
    db.conversations[zapId].push({ role: 'user', content: msg.body });

    // 1. Analisa Intenção
    const intencao = await analisarIntencao(db.conversations[zapId].map(m => `${m.role}: ${m.content}`).join('\n'));
    console.log(`⚖️ Intenção: ${intencao}`);

    if (intencao.includes('NEGATIVO') || intencao.includes('ROBO')) {
        db.blacklist.push(zapId); // Para de falar
        saveDB();
        return;
    }

    if (intencao.includes('HUMANO')) {
        if(socketRef) socketRef.emit('notification', `⚠️ INTERVENÇÃO HUMANA: ${lead.name}`);
        return; // Deixa para você responder manual
    }

    // 2. Gera Resposta (Se for Interesse ou Duvida)
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    
    // Delay de "pensamento" (5s a 10s)
    await new Promise(r => setTimeout(r, Math.random() * 5000 + 5000));

    const resposta = await gerarResposta(db.conversations[zapId], lead);
    
    if (resposta) {
        await client.sendMessage(zapId, resposta);
        db.conversations[zapId].push({ role: 'assistant', content: resposta });
        saveDB();
    }
});

// ============================================================================
// 🔌 EXPORTAÇÃO E INICIALIZAÇÃO
// ============================================================================

function iniciarSDR(socket) {
    socketRef = socket;
    if (!isReady) {
        console.log('Iniciando Cliente WPP...');
        client.initialize().catch(err => console.error("Erro init WPP:", err));
    } else {
        socket.emit('whatsapp_status', 'CONNECTED');
    }
}

module.exports = { iniciarSDR, processarLeadEntrada };