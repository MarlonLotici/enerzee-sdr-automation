const express = require('express');
const http = require('http'); 
const { Server } = require("socket.io");
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { spawn } = require('child_process');
const qrcode = require('qrcode-terminal'); 
const { iniciarVarredura } = require('./1_scraper'); 
const db = require('./database'); 

const app = express();
const server = http.createServer(app); 

// Configuração do Socket.io
const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"]
    } 
});

const PORT = 3001; 

app.use(cors());
app.use(express.json());

app.post('/webhook/calendly', (req, res) => {
    const payload = req.body?.payload || {};
    const name = payload?.invitee?.name || req.body?.name || '';
    const email = payload?.invitee?.email || req.body?.email || '';
    const phone = req.body?.phone || '';
    io.emit('lead_prebooked', { name, email, phone });
    res.json({ ok: true });
});

// Inicia Banco de Dados (Se o arquivo database.js existir e estiver correto)
try {
    db.initDb();
} catch (e) {
    console.log("⚠️ Aviso: Banco de dados não inicializado ou arquivo database.js ausente.");
}

// =======================================================
// 1. CONFIGURAÇÃO DO WHATSAPP (whatsapp-web.js)
// =======================================================
console.log('🔄 Inicializando Cliente WhatsApp...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true 
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
    console.log('⚡ Frontend conectado:', socket.id);

    // Se o WPP já estiver on quando o front conectar, avisa
    if (client.info && client.info.wid) {
        socket.emit('whatsapp_status', 'CONNECTED');
    }

    // --- COMANDO: Iniciar Varredura ---
    socket.on('start_scraping', async (data) => {
        // O App.jsx agora manda { niche: [...keywords], city: "Nome" }
        const cidade = data.city || "Localização Padrão";
        const nichos = Array.isArray(data.niche) ? data.niche : [data.niche];
        
        console.log(`[MOTOR] Iniciando busca: [${nichos}] em [${cidade}]`);

        try {
            // Executa o seu scraper original
            // O 1_scraper.js retorna um array de leads
            const resultados = await iniciarVarredura(cidade, nichos); 

            console.log(`[MOTOR] Encontrados ${resultados.length} leads.`);

            // Efeito Pipoca: Envia um por um para o Front
            for (const lead of resultados) {
                
                // Tenta salvar no banco (opcional, não trava se falhar)
                try {
                    await db.salvarLead({
                        empresa_maps: lead.nome || lead.titulo || '',
                        telefone_maps: lead.telefone || lead.phone || '',
                        bairro_detectado: lead.bairro_detectado || '',
                        link_maps: lead.link || lead.link_maps || ''
                    }, "Mapa", nichos[0]);
                } catch(e) { console.log("Erro ao salvar DB:", e.message); }
                
                // Manda pro Front com as chaves que o App.jsx espera (nome, telefone, link)
                socket.emit('new_lead', {
                    nome: lead.nome || lead.titulo,     // Ajuste de chave
                    telefone: lead.telefone || lead.phone, // Ajuste de chave
                    categoria: lead.categoria || nichos[0],
                    link: lead.link || lead.link_maps || ''
                });
                
                // Delay visual (UX)
                await new Promise(r => setTimeout(r, 200));
            }
            
            // Avisa que acabou para destravar o botão
            socket.emit('bot_finished');

        } catch (error) {
            console.error("Erro CRÍTICO no scraping:", error);
            socket.emit('notification', "Falha ao realizar varredura. Verifique o terminal.");
            socket.emit('bot_finished'); // Destrava o botão mesmo com erro
        }
    });

    // --- COMANDO: Enviar Mensagem ---
    socket.on('send_message', async ({ chatId, text }) => {
        try {
            let targetId = chatId;
            // Garante o formato correto @c.us
            if (!targetId.includes('@')) {
                targetId = `${targetId.replace(/\D/g, '')}@c.us`;
            }

            await client.sendMessage(targetId, text);
            console.log(`📤 Enviado para ${targetId}: ${text}`);
            
            // Emite confirmação para o frontend
            socket.emit('message_sent', {
                chatId: targetId,
                body: text,
                fromMe: true,
                timestamp: new Date().toLocaleTimeString()
            });
        } catch (err) {
            console.error("Erro ao enviar WPP:", err);
            socket.emit('notification', 'Erro ao enviar mensagem');
        }
    });

    // --- COMANDO: Iniciar IA SDR ---
    socket.on('start_sdr', async () => {
        console.log('[SDR] Comando recebido para iniciar IA SDR');
        socket.emit('sdr_status', 'running');
        socket.emit('sdr_message', { message: 'IA SDR iniciada. Processando leads...' });
        
        // Aqui você pode integrar com o 4_SDR_IA.js
        // Por enquanto, apenas notifica
        // TODO: Integrar com o módulo SDR quando estiver pronto
        setTimeout(() => {
            socket.emit('sdr_message', { message: 'SDR em execução. Verifique o terminal para mais detalhes.' });
        }, 1000);
    });

    // --- COMANDO: Limpeza ---
    socket.on('run_cleanup', () => {
        const p = spawn('node', ['2_limpeza.js'], { cwd: __dirname, shell: true });
        p.on('close', (code) => {
            if (code !== 0) {
                socket.emit('notification', 'Limpeza terminou com erro. Verifique o arquivo de entrada.');
            }
            socket.emit('cleanup_finished');
        });
        p.on('error', () => {
            socket.emit('notification', 'Erro na limpeza');
        });
    });

    // --- COMANDO: Enriquecimento ---
    socket.on('run_enrich', () => {
        const p = spawn('node', ['3_enrich.js'], { cwd: __dirname, shell: true });
        p.on('close', (code) => {
            if (code !== 0) {
                socket.emit('notification', 'Enriquecimento terminou com erro. Verifique o arquivo de entrada.');
            }
            socket.emit('enrich_finished');
        });
        p.on('error', () => {
            socket.emit('notification', 'Erro no enriquecimento');
        });
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 SERVIDOR SDR RODANDO NA PORTA ${PORT}`);
});
