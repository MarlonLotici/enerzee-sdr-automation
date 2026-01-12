// 1. CARREGAMENTO DE CONFIGURAÇÕES (PROFISSIONAL)
require('dotenv').config();
const express = require('express');
const http = require('http'); 
const { Server } = require("socket.io");
const cors = require('cors');
const helmet = require('helmet'); // Segurança de headers
const { Client, LocalAuth } = require('whatsapp-web.js');
const { spawn } = require('child_process');
const qrcode = require('qrcode-terminal'); 
const { iniciarVarredura } = require('./1_scraper'); 
const db = require('./database'); 

const app = express();
const server = http.createServer(app); 

// 2. SEGURANÇA E MIDDLEWARES
app.use(helmet()); // Protege contra vulnerabilidades web comuns
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS || "*", // Em produção, limite ao seu domínio
    methods: ["GET", "POST"]
}));
app.use(express.json());

// 3. CONFIGURAÇÃO DO SOCKET.IO
const io = new Server(server, { 
    cors: { 
        origin: process.env.ALLOWED_ORIGINS || "*",
        methods: ["GET", "POST"]
    } 
});

const PORT = process.env.PORT || 3001; 

// 4. INICIALIZAÇÃO RESILIENTE DO BANCO
(async () => {
    try {
        await db.initDb();
        console.log("💾 Banco de dados pronto.");
    } catch (e) {
        console.error("❌ Erro fatal ao iniciar Banco:", e.message);
        // Em produção, você pode querer encerrar o processo aqui
    }
})();

// 5. CLIENTE WHATSAPP COM TRATAMENTO DE ERROS
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true 
    }
});

// Eventos do WhatsApp com logs profissionais
client.on('qr', (qr) => {
    console.log('📲 QR Code gerado em:', new Date().toISOString());
    qrcode.generate(qr, { small: true });
    io.emit('qr_code', qr); 
});

client.on('ready', async () => {
    console.log('✅ WhatsApp Conectado com sucesso!');
    io.emit('whatsapp_status', 'CONNECTED');
});

// RECONEXÃO AUTOMÁTICA (ESTABILIDADE)
client.on('disconnected', (reason) => {
    console.log('❌ WhatsApp Desconectado:', reason);
    io.emit('whatsapp_status', 'DISCONNECTED');
    // Tenta reinicializar após 5 segundos
    setTimeout(() => client.initialize(), 5000);
});

client.initialize().catch(err => console.error("Erro ao iniciar WPP:", err));

// 6. GERENCIAMENTO DE LOGS E EVENTOS (SOCKET.IO)
io.on('connection', (socket) => {
    console.log(`⚡ Cliente conectado: ${socket.id}`);

    // LOGICA DE VARREDURA COM TRY/CATCH GLOBAL
    socket.on('start_scraping', async (data) => {
        try {
            const cidade = data.city || "Localização Padrão";
            const nichos = Array.isArray(data.niche) ? data.niche : [data.niche];
            
            const resultados = await iniciarVarredura(cidade, nichos); 

            for (const lead of resultados) {
                const leadData = {
                    nome: lead.nome || lead.titulo || 'Sem Nome',
                    telefone: lead.telefone || lead.phone || '',
                    categoria: lead.categoria || nichos[0],
                    link: lead.link || lead.link_maps || ''
                };

                // Salva no banco de forma assíncrona sem travar o loop
                db.salvarLead(leadData, "Mapa", nichos[0])
                  .catch(e => console.error("Erro DB Lead:", e.message));
                
                socket.emit('new_lead', leadData);
                await new Promise(r => setTimeout(r, 150));
            }
            socket.emit('bot_finished');
        } catch (error) {
            console.error("🚨 Erro no Scraping:", error);
            socket.emit('notification', "Erro na varredura. Tente novamente.");
            socket.emit('bot_finished');
        }
    });

    // Outros eventos...
});

// 7. TRATAMENTO DE EXCEÇÕES NÃO ESPERADAS (CRÍTICO)
process.on('uncaughtException', (err) => {
    console.error('❌ Erro não tratado:', err);
    // Aqui você enviaria um log para um serviço externo
});

server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR PROFISSIONAL RODANDO NA PORTA ${PORT}`);
});