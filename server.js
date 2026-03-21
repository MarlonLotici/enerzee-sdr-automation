require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// ⚙️ IMPORTAÇÕES DA ESTEIRA DE DADOS MESTRE
const { iniciarVarredura } = require('./1_scraper'); 
const { processarLimpeza } = require('./2_clean'); 
const { enriquecerLeadIndividual } = require('./3_enrich'); 
const db = require('./database'); 

// 🚀 O NOVO MOTOR V12 (BAILEYS MULTI-TENANCY)
const sdr = require('./4_sdr'); 

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

app.post('/webhook/calendly', (req, res) => {
    const payload = req.body?.payload || {};
    const name = payload?.invitee?.name || req.body?.name || '';
    const email = payload?.invitee?.email || req.body?.email || '';
    const phone = req.body?.phone || '';
    io.emit('lead_prebooked', { name, email, phone });
    res.json({ ok: true });
});

let shouldStop = false;

// 🔥 LIGA A IGNIÇÃO DO MOTOR MULTI-CHIP
sdr.initMultiTenancy(io);

// =======================================================
// 2. SOCKET.IO (COMUNICAÇÃO REAL-TIME)
// =======================================================
io.on('connection', (socket) => {
    console.log(`🔌 Dashboard conectado: ${socket.id}`);

    const atualizarListaInstancias = async () => {
        const list = await db.getActiveInstances();
        io.emit('instances_list', list); 
    };

    socket.on('get_instances', async () => {
        await atualizarListaInstancias();
    });

    socket.on('create_instance', async (data) => {
        await sdr.criarNovaInstancia(data.name, data.phone);
        await atualizarListaInstancias();
    });

    socket.on('start_scraping', async (params) => {
        shouldStop = false;
        
        const activeChips = await db.getActiveInstances();
        let chipCounter = 0; 

        if (activeChips.length === 0) {
            return socket.emit('notification', '❌ Erro: Nenhum chip ativo encontrado para distribuir os leads.');
        }

        if (!params.niche || (Array.isArray(params.niche) && params.niche.length === 0)) {
            params.niche = ["Comércio"];
        }

       const isMapMode = params.city && params.city.startsWith('📍');

let cidadeResolvida = params.city;
if (isMapMode && params.lat && params.lng) {
    try {
        const geoRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${params.lat}&lon=${params.lng}&format=json`,
            { headers: { 'User-Agent': 'EnerzeeBot/1.0' } }
        );
        const geoData = await geoRes.json();
        cidadeResolvida = geoData.address?.city
            || geoData.address?.town
            || geoData.address?.municipality
            || params.city;
        console.log(`🗺️ [GEO] Coordenada resolvida: ${cidadeResolvida}`);
    } catch(e) {
        console.log(`⚠️ [GEO] Falha ao resolver cidade, usando coordenada`);
    }
}

const payloadCorrigido = { ...params, city: cidadeResolvida, mode: isMapMode ? 'map' : 'city' };

        console.log(`🚀 [RADAR] Modo: ${payloadCorrigido.mode.toUpperCase()}`);
        console.log(`📍 Alvo: ${params.city} | 🎲 Distribuindo entre ${activeChips.length} chips conectados.`);
        socket.emit('notification', `📡 Radar ativado! Distribuindo leads para ${activeChips.length} chips...`);

        try {
            const stopCheck = () => shouldStop;
            await iniciarVarredura(payloadCorrigido, async (evento) => {
            if (shouldStop) return;

                if (evento.type === 'lead') {
                    let lead = evento.data;
                    
                    // 🛡️ REINTEGRAÇÃO DA ESTEIRA DE LIMPEZA E ENRIQUECIMENTO
                    const limpos = processarLimpeza([lead]);
                
                    if (limpos.length > 0 && limpos[0].valido) {
                        let leadFinal = limpos[0];
                        
                        try { 
                            leadFinal = await enriquecerLeadIndividual(leadFinal); 
                        } catch(e) { 
                            console.log(`⚠️ Silenciando erro de API no lead: ${leadFinal.name}`);
                        }

                        const chipSorteado = activeChips[chipCounter % activeChips.length];
                        chipCounter++; 

                        console.log(`🎲 [DISTRIBUIÇÃO] Lead ${leadFinal.name} entregue para o chip: ${chipSorteado.name}`);

                        const { error: dbError } = await db.saveLead(leadFinal, chipSorteado.id);

                        if (dbError) {
                            console.error(`❌ Erro DB (${leadFinal.name}):`, dbError.message);
                            if (!dbError.message.includes('unique')) {
                                socket.emit('notification', `⚠️ Erro ao registrar: ${leadFinal.name}`);
                            }
                        } else {
                            socket.emit('new_lead', leadFinal);
                        }
                    }
                }
           
                }, () => shouldStop);
    } catch (err) {
        console.error("🔥 Crash no processo de varredura:", err.message);
        
            socket.emit('notification', '❌ O Radar parou devido a uma falha de conexão.');
            socket.emit('scraping_stopped');
        }
    });

    socket.on('stop_scraping', () => { 
        console.log("🛑 Comando: Parar Radar.");
        shouldStop = true; 
    });
    
   socket.on('remove_instance', async (instanceId) => {
    sdr.encerrarInstancia(instanceId);
    await db.removeInstance(instanceId);
    await atualizarListaInstancias();
    console.log(`🗑️ Chip ${instanceId} removido e sessão encerrada.`);
});
});

app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`\n🚀 SERVIDOR SDR RODANDO NA PORTA ${PORT}`);
});