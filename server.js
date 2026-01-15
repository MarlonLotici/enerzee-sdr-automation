const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- IMPORTAÇÃO DOS MÓDULOS DA ARQUITETURA MASTER ---
const { iniciarVarredura } = require('./1_scraper');
const { processarLimpeza } = require('./2_clean');
const { enriquecerLeadIndividual } = require('./3_enrich');
const { iniciarSDR, processarLeadEntrada } = require('./4_sdr');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permite conexão do React (qualquer porta)
        methods: ["GET", "POST"]
    }
});

// Variável de controle global para interrupção imediata
let shouldStop = false;

// --- ORQUESTRAÇÃO DE EVENTOS ---
io.on('connection', (socket) => {
    console.log(`🔌 Nova conexão estabelecida: ${socket.id}`);

    // 1. Inicializa o Módulo SDR (WhatsApp) assim que o frontend conecta
    // Isso garante que o QR Code seja gerado e enviado ao frontend imediatamente
    iniciarSDR(socket);

    // 2. Evento: Iniciar Varredura (O Pipeline Completo)
    socket.on('start_scraping', async (params) => {
        console.log('🏁 Pipeline Master Iniciado. Parâmetros:', params);
        shouldStop = false;
        let leadsProcessados = 0;

        // Notifica início no terminal do frontend
        socket.emit('notification', `🚀 Iniciando motor em modo: ${params.mode === 'map' ? 'GEO-PRECISÃO' : 'TEXTUAL'}`);

        // --- FASE 1: SCRAPING (1_scraper.js) ---
        // O scraper roda e emite eventos 'lead' para cada item encontrado
        await iniciarVarredura(params, async (evento) => {
            // Verifica bandeira de parada a cada iteração para abortar rápido
            if (shouldStop) return;

            // Feedback de Status (Log Hacker no Terminal do Frontend)
            if (evento.type === 'status') {
                socket.emit('notification', evento.message);
            } 
            
            // Lead Encontrado -> Inicia Processamento em Cascata
            else if (evento.type === 'lead') {
                try {
                    const leadBruto = evento.data;

                    // --- FASE 2: LIMPEZA (2_clean.js) ---
                    // Sanitiza telefones e nomes. Retorna array (pegamos o 1º pois o fluxo é unitário)
                    const leadsLimpos = processarLimpeza([leadBruto]);
                    
                    if (leadsLimpos.length > 0) {
                        let leadFinal = leadsLimpos[0];

                        // Filtro de Qualidade: Só avança se o lead for minimamente válido
                        if (leadFinal.clean_status === 'valid') {
                            
                            // --- FASE 3: ENRIQUECIMENTO (3_enrich.js) ---
                            // Busca CNPJ, Sócio e Capital Social.
                            // Estratégia: Enriquecer apenas Celulares (leads acionáveis) ou Scores Altos para economizar recursos
                            if (leadFinal.type === 'mobile' || leadFinal.quality_score > 60) {
                                socket.emit('notification', `💎 Analisando dados corporativos: ${leadFinal.name}...`);
                                leadFinal = await enriquecerLeadIndividual(leadFinal);
                            }

                            // --- FASE 4: SDR / WHATSAPP (4_sdr.js) ---
                            // Envia para o "Cérebro" decidir a abordagem e colocar na fila de disparo
                            if (leadFinal.type === 'mobile') {
                                processarLeadEntrada(leadFinal, socket);
                            }

                            // --- FASE 5: ENTREGA AO FRONTEND ---
                            // Envia o lead pronto (rico e limpo) para aparecer no Kanban/CRM
                            socket.emit('new_lead', leadFinal);
                            
                            leadsProcessados++;
                            // Atualiza logs de progresso
                            socket.emit('progress_update', { message: `Processado: ${leadFinal.name} (${leadFinal.niche})` });
                        }
                    }
                } catch (err) {
                    console.error("Erro no pipeline individual:", err);
                }
            }
        });

        // Finalização do Processo
        if (!shouldStop) {
            socket.emit('bot_finished');
            socket.emit('notification', `✅ Varredura completa. ${leadsProcessados} leads processados com sucesso.`);
        }
    });

    // 3. Evento: Parar Varredura
    socket.on('stop_scraping', () => {
        console.log('🛑 Solicitação de parada recebida.');
        shouldStop = true;
        socket.emit('notification', '🛑 Interrompendo motor de busca...');
    });

    // 4. Evento: Mensagem Manual (Opcional - Chat Híbrido)
    socket.on('send_message', (data) => {
        // A lógica real de envio manual pode ser implementada aqui se expusermos o client do SDR
        // Por enquanto, logamos a intenção
        console.log(`💬 [MANUAL] Enviar para ${data.chatId}: ${data.text}`);
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`
    ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
    █ 🚀 SERVER MASTER v5.0 - ORCHESTRATOR ONLINE    █
    █ 📡 PORTA: ${PORT}                                 █
    █ 🧠 MÓDULOS CARREGADOS: SCRAPER, CLEAN, ENRICH, SDR █
    ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
    `);
});