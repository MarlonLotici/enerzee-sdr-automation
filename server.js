const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// --- IMPORTAÇÃO DOS MÓDULOS ---
const { iniciarVarredura } = require('./1_scraper');
const { processarLimpeza } = require('./2_clean');
const { enriquecerLeadIndividual } = require('./3_enrich');
const { iniciarSDR, processarLeadEntrada } = require('./4_sdr');
const db = require('./database'); // <--- NOVO: Importação do Banco de Dados

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let shouldStop = false;

io.on('connection', (socket) => {
    console.log(`🔌 Conexão ativa: ${socket.id}`);
    
    // Conecta o módulo de WhatsApp automaticamente ao abrir o navegador
    iniciarSDR(socket); 

    socket.on('conectar_whatsapp', () => {
        console.log("📲 Reconexão manual solicitada...");
        iniciarSDR(socket);
    });

    // ... restante dos seus socket.on (start_scraping, etc)

    // --- MOTOR DE BUSCA (SCRAPING) ---
    socket.on('start_scraping', async (params) => {
        console.log('🏁 Pipeline Master Iniciado com Persistência em Nuvem.');
        shouldStop = false;
        let leadsProcessados = 0;

        const cidadeLimpa = params.city.replace(/🎯|Alvo no Mapa|Minha Localização Atual|\(.*\)/g, '').trim() || "";
        const paramsLimpos = { ...params, city: cidadeLimpa };

        socket.emit('notification', `🚀 Motor iniciado: Buscando em ${cidadeLimpa}`);

        try {
            await iniciarVarredura(paramsLimpos, async (evento) => {
                if (shouldStop) return;

                if (evento.type === 'status') {
                    socket.emit('notification', evento.message);
                } 
                
                else if (evento.type === 'lead') {
                    try {
                        let leadBruto = evento.data;
                        leadBruto.name = leadBruto.name || leadBruto.nome;
                        leadBruto.phone = leadBruto.phone || leadBruto.telefone;
                        leadBruto.city = leadBruto.city || cidadeLimpa;

                        console.log(`[SERVER] Processando: ${leadBruto.name}`);

                        const leadsLimpos = processarLimpeza([leadBruto]);
                        
                        if (leadsLimpos.length > 0) {
                            let leadFinal = leadsLimpos[0];

                            if (leadFinal.valido) {
                                // --- FASE 3: ENRIQUECIMENTO ---
                                socket.emit('notification', `💎 Inteligência: Buscando dados de ${leadFinal.name}...`);
                                
                                try {
                                    leadFinal = await enriquecerLeadIndividual(leadFinal); 
                                } catch (e) {
                                    console.log(`[AVISO] Falha no enriquecimento de ${leadFinal.name}.`);
                                }

                                // --- NOVO: FASE DE PERSISTÊNCIA (SUPABASE) ---
                                // Salvamos no banco ANTES de mandar para o SDR ou Frontend
                                try {
                                    const { error } = await db.saveLead(leadFinal);
                                    if (error) throw error;
                                    console.log(`[DB] ✅ Lead salvo no Supabase: ${leadFinal.name}`);
                                } catch (dbError) {
                                    console.error(`[DB ERROR] Falha ao salvar no Supabase: ${dbError.message}`);
                                }

                                // --- FASE 4: FILA SDR ---
                                if (leadFinal.type === 'mobile') {
                                    // Passamos o lead para o SDR, que agora também lerá/atualizará o banco
                                    processarLeadEntrada(leadFinal, socket);
                                }

                                // --- FASE 5: ENTREGA AO FRONTEND ---
                                socket.emit('new_lead', leadFinal);
                                leadsProcessados++;
                                
                                const feedbackMsg = leadFinal.dono 
                                    ? `✅ Sócio Identificado: ${leadFinal.dono}` 
                                    : `📍 Lead capturado: ${leadFinal.name}`;
                                
                                socket.emit('progress_update', { message: feedbackMsg });
                            }
                        }
                    } catch (err) {
                        console.error("Erro no processamento individual:", err.message);
                    }
                }
            });

            if (!shouldStop) {
                socket.emit('bot_finished');
                socket.emit('notification', `✅ Varredura completa. ${leadsProcessados} leads na nuvem.`);
            }

        } catch (error) {
            console.error("Erro Crítico no Scraper:", error);
            socket.emit('notification', "❌ Falha no motor de busca.");
            socket.emit('bot_finished');
        }
    });

    socket.on('stop_scraping', () => {
        shouldStop = true;
        socket.emit('notification', '🛑 Parada solicitada.');
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR ONLINE NA PORTA ${PORT}`);
});