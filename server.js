require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const EventEmitter = require('events');
const sdrEvents = new EventEmitter(); // 🔔 Nosso Alarme de RAM

// ⚙️ IMPORTAÇÕES DA ESTEIRA DE DADOS MESTRE
const { iniciarVarredura } = require('./1_scraper'); 
const { processarLimpeza } = require('./2_clean'); 
const { enriquecerLeadIndividual } = require('./3_enrich'); 
const db = require('./database'); 

const { Worker } = require('bullmq');
const { redisConnection } = require('./queue');
// Importe aqui a sua função que processa a IA (ajuste o nome para o que você usa hoje)
const { processarMensagemIA } = require('./4_sdr'); 

// === INICIA O WORKER DE MENSAGENS ===
const workerMensagens = new Worker('FilaMensagensIA', async (job) => {
    console.log(`⏳ [BULLMQ] Processando job ${job.id}: Mensagem de ${job.data.whatsapp_id}`);
    
    try {
        // Chama o motor pesadão (Llama + TTS) de forma controlada
        await processarMensagemIA(job.data.lead, job.data.mensagem);
        console.log(`✅ [BULLMQ] Job ${job.id} finalizado com sucesso!`);
    } catch (error) {
        console.error(`❌ [BULLMQ] Erro no job ${job.id}:`, error.message);
        throw error; // Lança o erro para o BullMQ tentar novamente
    }
}, { 
    connection: redisConnection,
    concurrency: 5 // Processa no máximo 5 leads ao mesmo tempo para não explodir a RAM
});

// 🚀 O NOVO MOTOR V12 (BAILEYS MULTI-TENANCY)
let sdr = null;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
// Camada de Segurança: Verifica o Token do Supabase
const autenticarMiddleware = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Acesso negado.' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Sessão inválida.' });

    req.user = user;
    next();
};
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));



let shouldStop = false;

// 👇 NOVA MEMÓRIA GLOBAL DO SCRAPER 👇
let isScraperRunning = false;
let recentScraperLogs = [];

// Função auxiliar para gravar os logs e gritar no megafone (io.emit)
const emitLog = (message) => {
    recentScraperLogs.push(message);
    if (recentScraperLogs.length > 50) recentScraperLogs.shift(); // Guarda só os últimos 50
    io.emit('notification', message); 
};
// 👆 FIM DA MEMÓRIA GLOBAL 👆
// 🔥 LIGA A IGNIÇÃO DO MOTOR MULTI-CHIP (Modo Assíncrono Anti-Crash)
import('./4_sdr.js').then((moduloSdr) => {
    // O Node 22 entende isso perfeitamente, independentemente das bibliotecas
    sdr = moduloSdr.default || moduloSdr; 
    sdr.initMultiTenancy(io, sdrEvents);
    console.log("✅ Motor SDR V12 carregado via Import Dinâmico sem curtos-circuitos!");
}).catch(err => {
    console.error("🔥 Crash evitado! Erro ao carregar o Módulo SDR:", err);
});

// =======================================================
// 2. SOCKET.IO (COMUNICAÇÃO REAL-TIME)
// =======================================================
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Não autenticado"));
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return next(new Error("Sessão expirada"));
    
    socket.user = user;
    next();
});

io.on('connection', (socket) => {
    console.log(`🔐 Acesso autorizado para: ${socket.user.email}`);

    const atualizarListaInstancias = async () => {
        const list = await db.getActiveInstances();
        io.emit('instances_list', list); 
    };

    socket.on('get_instances', async () => {
        await atualizarListaInstancias();
    });

    socket.on('create_instance', async (data) => {
        await sdr.criarNovaInstancia(data.name, data.phone, socket.user.id);
        await atualizarListaInstancias();
    });

    socket.on('remove_instance', async (instanceId) => {
        sdr.encerrarInstancia(instanceId);
        await db.removeInstance(instanceId);
        await atualizarListaInstancias();
        console.log(`🗑️ Chip ${instanceId} removido e sessão encerrada.`);
    });

    socket.on('reconnect_instance', async (instanceId) => {
        await sdr.reconectarInstancia(instanceId);
        await atualizarListaInstancias();
    });

    // 👇 O listener que responde à pergunta do Front-end quando a página reabre 👇
    socket.on('check_scraper_status', () => {
        socket.emit('scraper_status', { 
            isRunning: isScraperRunning, 
            recentLogs: recentScraperLogs 
        });
    });

    socket.on('start_scraping', async (params) => {
        shouldStop = false;
        
        const allChips = await db.getActiveInstances();
        const activeChips = allChips.filter(c => c.whatsapp_status === 'CONNECTED');
        let chipCounter = 0;

        if (activeChips.length === 0) {
            return socket.emit('notification', '❌ Erro: Nenhum chip CONECTADO encontrado. Verifique o status dos chips antes de raspar.');
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
        
        // Seta a memória global dizendo que começou
        isScraperRunning = true;
        recentScraperLogs = []; 
        
        emitLog(`📡 Radar ativado em ${params.city}! O motor está rodando na nuvem. Pode fechar a página se quiser.`);
        io.emit('scraper_status', { isRunning: true, recentLogs: recentScraperLogs });

        try {
            const stopCheck = () => shouldStop;
            
            // 👇 FIRE-AND-FORGET: SEM O AWAIT, ELE RODA SOLTO 👇
            iniciarVarredura(payloadCorrigido, async (evento) => {
                if (shouldStop) return;

                if (evento.type === 'log') emitLog(evento.data);

                if (evento.type === 'lead') {
                    let lead = evento.data;
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

                        emitLog(`🎲 Lead ${leadFinal.name} extraído e entregue para o chip: ${chipSorteado.name}`);

                        const { error: dbError } = await db.saveLead(leadFinal, chipSorteado.id, chipSorteado.user_id);
                        
                        if (dbError) {
                            console.error(`❌ Erro DB (${leadFinal.name}):`, dbError.message);
                            if (!dbError.message.includes('unique')) {
                                emitLog(`⚠️ Erro ao registrar: ${leadFinal.name}`);
                            }
                        } else {
                            // 👇 EMITE PARA TODAS AS ABAS: O lead foi salvo!
                            io.emit('new_lead', leadFinal);
                            io.emit('background_lead_saved');

                            // 🔔 O GRITO NO CORREDOR: Avisa o SDR que tem lead novo no banco!
                            sdrEvents.emit('NOVO_LEAD_DISPONIVEL', chipSorteado.id);

                            
                        }
                    }
                }
            }, stopCheck).then(() => {
                // Finalizou 100%
                isScraperRunning = false;
                emitLog("✅ Varredura concluída com sucesso na nuvem.");
                io.emit('scraper_status', { isRunning: false, recentLogs: recentScraperLogs });
                io.emit('scraping_stopped');
            }).catch(err => {
                console.error("🔥 Crash no processo de varredura:", err.message);
                isScraperRunning = false;
                emitLog('❌ O Radar parou devido a uma falha de conexão com a Receita/Google.');
                io.emit('scraper_status', { isRunning: false, recentLogs: recentScraperLogs });
                io.emit('scraping_stopped');
            });
            
        } catch (errGeral) {
            console.error("Erro geral na rota:", errGeral);
            isScraperRunning = false;
            io.emit('scraping_stopped');
        }
    });

    socket.on('stop_scraping', () => { 
        emitLog("🛑 Comando: Parar Radar Recebido.");
        shouldStop = true; 
        isScraperRunning = false;
        io.emit('scraper_status', { isRunning: false, recentLogs: recentScraperLogs });
    });
});
// ============================================================================
// 📅 WEBHOOK CALENDLY — ÚNICA VERSÃO OFICIAL (INTEGRADA AO SDR V12)
// ============================================================================
app.post('/webhook/calendly', express.json(), async (req, res) => {
    try {
        const evento = req.body;

        // Filtra apenas agendamentos criados
        if (evento?.event !== 'invitee.created') {
            return res.status(200).json({ ok: true, ignorado: true });
        }

        const payload = evento.payload;
        const emailConvidado = payload?.email?.toLowerCase()?.trim();
        const telefoneRaw    = payload?.text_reminder_number || '';
        const dataEvento     = payload?.scheduled_event?.start_time || new Date().toISOString();
        const nomeEvento     = payload?.event_type?.name || 'Consultoria';
        const telefoneLimpo  = telefoneRaw.replace(/\D/g, '');

        console.log(`📅 [CALENDLY] Agendamento recebido — fone: ${telefoneLimpo}`);

        let lead = null;

        // 1. Busca pelo WhatsApp ID (JID)
        if (telefoneLimpo.length >= 10) {
            const variacoes = [
                `${telefoneLimpo}@s.whatsapp.net`,
                `55${telefoneLimpo}@s.whatsapp.net`,
                telefoneLimpo.length === 11 ? `55${telefoneLimpo.slice(0,2)}${telefoneLimpo.slice(3)}@s.whatsapp.net` : null
            ].filter(Boolean);

            for (const jid of variacoes) {
                const { data } = await supabase.from('leads').select('id, name, whatsapp_id, instance_id, dono').eq('whatsapp_id', jid).maybeSingle();
                if (data) { lead = data; break; }
            }
        }

        // 2. Fallback por Email
        if (!lead && emailConvidado) {
            const { data } = await supabase.from('leads').select('id, name, whatsapp_id, instance_id, dono').eq('email', emailConvidado).maybeSingle();
            if (data) lead = data;
        }

        if (!lead) {
            console.log(`⚠️ [CALENDLY] Lead não encontrado no banco.`);
            return res.status(200).json({ ok: true, encontrado: false });
        }

        // 3. Atualiza o banco (Garante que o SDR saiba que agendou)
        await supabase.from('leads').update({
            calendly_booked: true,
            calendly_event_at: dataEvento,
            calendly_event_name: nomeEvento,
            status: 'closed' 
        }).eq('id', lead.id);

        console.log(`✅ [CALENDLY] Lead ${lead.name} atualizado.`);
        
        // 🔔 ACORDA O SDR PARA O FEEDBACK
        sdrEvents.emit('AGENDAMENTO_CONFIRMADO', { lead, dataEvento, instanceId: lead.instance_id });

        return res.status(200).json({ ok: true, lead: lead.name });

    } catch (err) {
        console.error('❌ [CALENDLY] Erro:', err.message);
        return res.status(500).json({ erro: err.message });
    }
});

// Entrega o Frontend (Sempre depois das rotas de API)
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

    // ============================================================================
// 💬 ROTA DE DISPARO MANUAL (PAINEL FRONT-END -> WHATSAPP)
// ============================================================================
app.post('/api/send-message', autenticarMiddleware, async (req, res) => {
    try {
        const { instanceId, whatsappId, text } = req.body;

        // 1. Trava de segurança: Verifica se os dados chegaram do front
        if (!instanceId || !whatsappId || !text) {
            return res.status(400).json({ success: false, error: "Faltam parâmetros obrigatórios." });
        }

        // 2. Trava de segurança: Verifica se o motor 4_sdr foi importado corretamente
        if (!sdr || !sdr.enviarMensagemSDR) {
            return res.status(500).json({ success: false, error: "Motor SDR não está pronto." });
        }

        console.log(`📡 [API] Ordem de disparo manual recebida para: ${whatsappId}`);

        // 3. Chama a função que criamos no 4_sdr.js
        const resultado = await sdr.enviarMensagemSDR(instanceId, whatsappId, text);

        if (resultado.success) {
            return res.status(200).json(resultado);
        } else {
            return res.status(500).json(resultado);
        }

    } catch (error) {
        console.error("❌ [API] Falha crítica na rota de envio:", error);
        return res.status(500).json({ success: false, error: "Falha interna no servidor." });
    }
});

// LIGA O MOTOR (A última linha do sistema)
server.listen(PORT, () => {
    console.log(`\n🚀 SERVIDOR SDR RODANDO NA PORTA ${PORT}`);
});