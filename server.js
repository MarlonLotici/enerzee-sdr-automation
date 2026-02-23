/**
 * SERVER.JS - ORQUESTRADOR MESTRE MULTI-TENANCY 2026
 * Versão Final: Scraper + Clean + Enrich + SDR + Estabilidade
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { iniciarVarredura } = require('./1_scraper');
const { processarLimpeza } = require('./2_clean');
const { enriquecerLeadIndividual } = require('./3_enrich');
const { initMultiTenancy, criarNovaInstancia } = require('./4_sdr');
const db = require('./database');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Variável global para controle de interrupção
let shouldStop = false;

// 1. INICIALIZAÇÃO DO SISTEMA
server.listen(3001, async () => {
    console.log('🚀 SISTEMA ENERZEE SDR MULTI-CHIP ONLINE');
    // Inicia os chips 05:30 - 22:45 automaticamente conforme regras do 4_sdr.js
    await initMultiTenancy(io); 
});

// 2. BLOCO ÚNICO DE CONEXÃO SOCKET
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

    // --- MOTOR DE PROSPECÇÃO (RADAR) ---
    socket.on('start_scraping', async (params) => {
        shouldStop = false;
        const targetInstanceId = params.instanceId; 

        // [PROTEÇÃO 1] Validação de Chip Selecionado
        if (!targetInstanceId) {
            return socket.emit('notification', '❌ Erro: Selecione um chip ativo primeiro.');
        }

        // [PROTEÇÃO 2] Garantia de Nicho (Evita o erro de toLowerCase)
        if (!params.niche || (Array.isArray(params.niche) && params.niche.length === 0)) {
            params.niche = ["Comércio"]; // Fallback seguro
            console.log("⚠️ Nicho veio vazio do front. Usando 'Comércio'.");
        }

        // [FUNCIONALIDADE ORIGINAL] Lógica de Detecção de Modo (📍 = Mapa)
        const isMapMode = params.city && params.city.startsWith('📍');
        const payloadCorrigido = {
            ...params,
            mode: isMapMode ? 'map' : 'city'
        };

        console.log(`🚀 [RADAR] Modo: ${payloadCorrigido.mode.toUpperCase()}`);
        console.log(`📍 Alvo: ${params.city} | Chip: ${targetInstanceId}`);
        socket.emit('notification', `📡 Radar ativado para ${params.niche}...`);

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
                        
                        // [FUNCIONALIDADE ORIGINAL] 3_enrich.js (Enriquecimento de Sócio/CNPJ)
                        try { 
                            leadFinal = await enriquecerLeadIndividual(leadFinal); 
                        } catch(e) { 
                            console.log(`⚠️ Silenciando erro de API no lead: ${leadFinal.name}`);
                        }

                        // [FUNCIONALIDADE ORIGINAL] db.saveLead (Persistência no Supabase)
                        const { error: dbError } = await db.saveLead(leadFinal, targetInstanceId);

                        if (dbError) {
                            // Registra erro no terminal mas não para o scraper
                            console.error(`❌ Erro DB (${leadFinal.name}):`, dbError.message);
                            
                            // Se não for erro de duplicado, avisa o Dashboard
                            if (!dbError.message.includes('unique')) {
                                socket.emit('notification', `⚠️ Erro ao registrar: ${leadFinal.name}`);
                            }
                        } else {
                            // [FUNCIONALIDADE ORIGINAL] Feedback visual no CRM
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