require('dotenv').config();

/**
 * SERVER.JS - ORQUESTRADOR MESTRE MULTI-TENANCY 2026
 * Versão Final: Scraper + Clean + Enrich + SDR + Estabilidade
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { spawn } = require('child_process');
const qrcode = require('qrcode-terminal'); 
const { iniciarVarredura } = require('./1_scraper'); 
const db = require('./database'); 

const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Servir frontend buildado (produção / Railway)
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

app.post('/webhook/calendly', (req, res) => {
    const payload = req.body?.payload || {};
    const name = payload?.invitee?.name || req.body?.name || '';
    const email = payload?.invitee?.email || req.body?.email || '';
    const phone = req.body?.phone || '';
    io.emit('lead_prebooked', { name, email, phone });
    res.json({ ok: true });
});

// Variável global para controle de interrupção
let shouldStop = false;

// =======================================================
// 1. CONFIGURAÇÃO DO WHATSAPP (whatsapp-web.js)
// =======================================================
const fs = require('fs');

function findChromePath() {
    // 1. Variável de ambiente (Railway, Docker, CI)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

    // 2. Caminhos conhecidos por OS
    const candidates = process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return undefined; // deixa o puppeteer tentar o Chrome bundled
}

const chromePath = findChromePath();
console.log(`🔄 Inicializando Cliente WhatsApp... (Chrome: ${chromePath || 'bundled'})`);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
        ...(chromePath && { executablePath: chromePath })
    }
});

client.on('qr', (qr) => {
    console.log('📲 QR Code gerado!');
    qrcode.generate(qr, { small: true });
    io.emit('qr_code', qr); 
});

client.on('ready', async () => {
    console.log('✅ WhatsApp Conectado!');
    io.emit('whatsapp_status', 'CONNECTED');
    
    // Carrega histórico recente
    try {
        const chats = await client.getChats();
        const formattedChats = chats.map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            lastMessage: c.lastMessage ? c.lastMessage.body : '',
            lastTime: c.timestamp ? new Date(c.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '',
        })).slice(0, 15);
        
        io.emit('all_chats', formattedChats);
    } catch (e) {
        console.error("Erro ao carregar chats:", e);
    }
});

// Listener de Status para atualizar o botão do Front
client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Desconectado:', reason);
    io.emit('whatsapp_status', 'DISCONNECTED');
});

client.on('message', async msg => {
    // Ignora mensagens de status
    if(msg.from === 'status@broadcast') return;

    console.log(`📩 Nova mensagem de ${msg.from}: ${msg.body}`);
    
    io.emit('message_received', {
        chatId: msg.from,
        body: msg.body,
        fromMe: false,
        timestamp: new Date().toLocaleTimeString()
    });
});

client.initialize();

// =======================================================
// 2. SOCKET.IO (COMUNICAÇÃO REAL-TIME)
// =======================================================
io.on('connection', (socket) => {
    console.log(`🔌 Dashboard conectado: ${socket.id}`);

    // --- GESTÃO DE INSTÂNCIAS (CHIPS) ---
    const atualizarListaInstancias = async () => {
        const list = await db.getActiveInstances();
        io.emit('instances_list', list); 
    };

    socket.on('get_instances', async () => {
        await atualizarListaInstancias();
    });

    socket.on('create_instance', async (data) => {
        await criarNovaInstancia(data.name, data.phone);
        await atualizarListaInstancias();
    });

   // --- MOTOR DE PROSPECÇÃO (RADAR COM DISTRIBUIÇÃO AUTOMÁTICA) ---
    socket.on('start_scraping', async (params) => {
        shouldStop = false;
        
        // 🎲 1. Busca todos os chips que estão ativos/conectados no banco
        const activeChips = await db.getActiveInstances();
        let chipCounter = 0; // O nosso "carteador"

        if (activeChips.length === 0) {
            return socket.emit('notification', '❌ Erro: Nenhum chip ativo encontrado para distribuir os leads.');
        }

        // [PROTEÇÃO 2] Garantia de Nicho
        if (!params.niche || (Array.isArray(params.niche) && params.niche.length === 0)) {
            params.niche = ["Comércio"];
            console.log("⚠️ Nicho veio vazio do front. Usando 'Comércio'.");
        }

        // [FUNCIONALIDADE ORIGINAL] Lógica de Detecção de Modo (📍 = Mapa)
        const isMapMode = params.city && params.city.startsWith('📍');
        const payloadCorrigido = {
            ...params,
            mode: isMapMode ? 'map' : 'city'
        };

        console.log(`🚀 [RADAR] Modo: ${payloadCorrigido.mode.toUpperCase()}`);
        console.log(`📍 Alvo: ${params.city} | 🎲 Distribuindo entre ${activeChips.length} chips conectados.`);
        socket.emit('notification', `📡 Radar ativado! Distribuindo leads para ${activeChips.length} chips...`);

        // [EXECUÇÃO DO MOTOR]
        try {
            await iniciarVarredura(payloadCorrigido, async (evento) => {
                // [FUNCIONALIDADE ORIGINAL] Botão Parar
                if (shouldStop) return;

                if (evento.type === 'lead') {
                    let lead = evento.data;
                    
                    // [FUNCIONALIDADE ORIGINAL] 2_clean.js
                    const limpos = processarLimpeza([lead]);
                
                    if (limpos.length > 0 && limpos[0].valido) {
                        let leadFinal = limpos[0];
                        
                        // [FUNCIONALIDADE ORIGINAL] 3_enrich.js
                        try { 
                            leadFinal = await enriquecerLeadIndividual(leadFinal); 
                        } catch(e) { 
                            console.log(`⚠️ Silenciando erro de API no lead: ${leadFinal.name}`);
                        }

                        // 🎲 A MÁGICA ACONTECE AQUI (Round-Robin)
                        const chipSorteado = activeChips[chipCounter % activeChips.length];
                        chipCounter++; 

                        console.log(`🎲 [DISTRIBUIÇÃO] Lead ${leadFinal.name} entregue para o chip: ${chipSorteado.name}`);

                        // Salva no banco com o ID do chip sorteado
                        const { error: dbError } = await db.saveLead(leadFinal, chipSorteado.id);

                        if (dbError) {
                            console.error(`❌ Erro DB (${leadFinal.name}):`, dbError.message);
                            if (!dbError.message.includes('unique')) {
                                socket.emit('notification', `⚠️ Erro ao registrar: ${leadFinal.name}`);
                            }
                        } else {
                            console.log(`📡 Enviando lead persistido para o front: ${leadFinal.name}`);
                            socket.emit('new_lead', leadFinal);
                        }
                    }
                }
            });
        } catch (err) {
            console.error("🔥 Crash no processo de varredura:", err.message);
            socket.emit('notification', '❌ O Radar parou devido a uma falha de conexão.');
        }
    });
    // [FUNCIONALIDADE ORIGINAL] Parar Radar
    socket.on('stop_scraping', () => { 
        console.log("🛑 Comando: Parar Radar.");
        shouldStop = true; 
    });
});

// Fallback SPA — qualquer rota não-API devolve o index.html
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`\n🚀 SERVIDOR SDR RODANDO NA PORTA ${PORT}`);
});
