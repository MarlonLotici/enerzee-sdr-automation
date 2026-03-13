require('dotenv').config();

/**
 * SERVER.JS - ORQUESTRADOR MESTRE MULTI-TENANCY 2026
 * Versão Final: Scraper + Clean + Enrich + SDR + Estabilidade
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
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

// ============================================================================
// 👇 1. MOTOR DO FRONTEND (REACT/VITE) ADICIONADO AQUI 👇
// Isso faz o backend entregar a tela visual do seu painel
// ============================================================================
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/(.*)', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
// ============================================================================


// 2. INICIALIZAÇÃO DO SISTEMA
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
        console.log('🚀 SISTEMA ENERZEE SDR MULTI-CHIP ONLINE');
    // Inicia os chips 05:30 - 22:45 automaticamente conforme regras do 4_sdr.js
    await initMultiTenancy(io); 
});

// 3. BLOCO ÚNICO DE CONEXÃO SOCKET
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