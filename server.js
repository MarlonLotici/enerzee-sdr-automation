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
const { alertaCalendly } = require('./notifier');

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



// Estado do scraper isolado por usuário — cada cliente tem o seu próprio
const scraperState = new Map(); // userId → { running, shouldStop, logs }

function getScraperState(userId) {
    if (!scraperState.has(userId)) {
        scraperState.set(userId, { running: false, shouldStop: false, logs: [] });
    }
    return scraperState.get(userId);
}

// emitLog é criado por sessão — nunca vaza logs entre usuários
function criarEmitLog(socket, userId) {
    return (message) => {
        const state = getScraperState(userId);
        state.logs.push(message);
        if (state.logs.length > 50) state.logs.shift();
        socket.emit('notification', message);
    };
}
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
    const userId = socket.user.id;
    socket.join(`user:${userId}`); // garante que eventos do SDR cheguem só ao dono
    console.log(`🔐 Acesso autorizado para: ${socket.user.email}`);

    // emitLog isolado por socket — nunca vaza entre usuários
    const emitLog = criarEmitLog(socket, userId);

    const atualizarListaInstancias = async () => {
        const list = await db.getActiveInstances();
        const userList = list.filter(i => i.user_id === socket.user.id);
        socket.emit('instances_list', userList);
    };

    socket.on('get_instances', async () => {
        await atualizarListaInstancias();
    });

    socket.on('create_instance', async (data) => {
        const resultado = await sdr.criarNovaInstancia(data.name, data.phone, socket.user.id);
        if (!resultado) {
            socket.emit('notification', '❌ Falha ao criar chip. Verifique os logs do Railway.');
        }
        await atualizarListaInstancias();
    });

    socket.on('remove_instance', async (instanceId) => {
        const inst = await db.getInstanceRules(instanceId);
        if (!inst || inst.user_id !== userId) return console.warn(`⛔ [SEGURANÇA] ${socket.user.email} tentou remover chip de outro usuário.`);
        sdr.encerrarInstancia(instanceId);
        await db.removeInstance(instanceId);
        await atualizarListaInstancias();
        console.log(`🗑️ Chip ${instanceId} removido e sessão encerrada.`);
    });

    socket.on('reconnect_instance', async (instanceId) => {
        const inst = await db.getInstanceRules(instanceId);
        if (!inst || inst.user_id !== userId) return console.warn(`⛔ [SEGURANÇA] ${socket.user.email} tentou reconectar chip de outro usuário.`);
        await sdr.reconectarInstancia(instanceId);
        await atualizarListaInstancias();
    });

    socket.on('check_scraper_status', () => {
        const state = getScraperState(userId);
        socket.emit('scraper_status', { isRunning: state.running, recentLogs: state.logs });
    });

    socket.on('start_scraping', async (params) => {
        const userState = getScraperState(userId);
        userState.shouldStop = false;
        
        // 🧱 1. O MURO DE ISOLAMENTO: Descobre qual é o produto desta conta
        const { data: profile } = await supabase
            .from('profiles')
            .select('default_product_type')
            .eq('id', socket.user.id)
            .maybeSingle();
        const userProductType = profile?.default_product_type || 'solar';

        // 🧱 2. FILTRO BLINDADO: Só pega chips deste usuário E que vendam este produto
        const allChips = await db.getActiveInstances();
        const activeChips = allChips.filter(c => 
            c.whatsapp_status === 'CONNECTED' && 
            c.user_id === socket.user.id && 
            c.product_type === userProductType
        );
        let chipCounter = 0;

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
                cidadeResolvida = geoData.address?.city || geoData.address?.town || geoData.address?.municipality || params.city;
                console.log(`🗺️ [GEO] Coordenada resolvida: ${cidadeResolvida}`);
            } catch(e) {
                console.log(`⚠️ [GEO] Falha ao resolver cidade, usando coordenada`);
            }
        }

        const payloadCorrigido = { ...params, city: cidadeResolvida, mode: isMapMode ? 'map' : 'city' };

        console.log(`🚀 [RADAR] Modo: ${payloadCorrigido.mode.toUpperCase()}`);
        console.log(`📍 Alvo: ${params.city} | 🎲 Distribuindo entre ${activeChips.length} chips (${userProductType}).`);
        
        userState.running = true;
        userState.logs = [];

        if (activeChips.length === 0) {
            emitLog(`⚠️ Aviso: Nenhum chip conectado para o produto '${userProductType}'. Os leads serão raspados e guardados na fila de espera.`);
        } else {
            emitLog(`📡 Radar ativado em ${params.city}! O motor está rodando na nuvem. Pode fechar a página se quiser.`);
        }
        
        socket.emit('scraper_status', { isRunning: true, recentLogs: userState.logs });

        try {
            const stopCheck = () => getScraperState(userId).shouldStop;

            iniciarVarredura(payloadCorrigido, async (evento) => {
                if (getScraperState(userId).shouldStop) return;

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

                        // 🧱 3. FALLBACK DE ÓRFÃOS: Se não tem chip, salva como null
                        let chipSorteadoId = null;
                        let chipSorteadoName = "Fila de Espera (Nenhum chip online)";

                        if (activeChips.length > 0) {
                            const chipSorteado = activeChips[chipCounter % activeChips.length];
                            chipSorteadoId = chipSorteado.id;
                            chipSorteadoName = chipSorteado.name;
                            chipCounter++; 
                        }

                        emitLog(`🎲 Lead ${leadFinal.name} extraído. Destino: ${chipSorteadoName}`);

                        // Salva o lead amarrado ao usuário, mesmo que o chip seja null
                        const { error: dbError } = await db.saveLead(leadFinal, chipSorteadoId, socket.user.id);
                        
                        if (dbError) {
                            console.error(`❌ Erro DB (${leadFinal.name}):`, dbError.message);
                            if (!dbError.message.includes('unique')) {
                                emitLog(`⚠️ Erro ao registrar: ${leadFinal.name}`);
                            }
                        } else {
                            socket.emit('new_lead', leadFinal);
                            socket.emit('background_lead_saved');
                            if (chipSorteadoId) {
                                sdrEvents.emit('NOVO_LEAD_DISPONIVEL', chipSorteadoId);
                            }
                        }
                    }
                }
            }, stopCheck).then(() => {
                getScraperState(userId).running = false;
                emitLog("✅ Varredura concluída com sucesso na nuvem.");
                io.to(`user:${userId}`).emit('scraper_status', { isRunning: false, recentLogs: getScraperState(userId).logs });
                io.to(`user:${userId}`).emit('scraping_stopped');
            }).catch(err => {
                console.error("🔥 Crash no processo de varredura:", err.message);
                getScraperState(userId).running = false;
                emitLog('❌ O Radar parou devido a uma falha de conexão com a Receita/Google.');
                io.to(`user:${userId}`).emit('scraper_status', { isRunning: false, recentLogs: getScraperState(userId).logs });
                io.to(`user:${userId}`).emit('scraping_stopped');
            });

        } catch (errGeral) {
            console.error("Erro geral na rota:", errGeral);
            getScraperState(userId).running = false;
            io.to(`user:${userId}`).emit('scraping_stopped');
        }
    });

    socket.on('stop_scraping', () => {
        const state = getScraperState(userId);
        state.shouldStop = true;
        state.running = false;
        emitLog("🛑 Comando: Parar Radar Recebido.");
        socket.emit('scraper_status', { isRunning: false, recentLogs: state.logs });
    });
});
// ============================================================================
// 📅 WEBHOOK CALENDLY — FASE 2 (TRAVA ATÔMICA + NORMALIZAÇÃO BR)
// ============================================================================

// Retorna JIDs do WhatsApp com ambas as variações do 9º dígito (salvo/não-salvo no banco).
function normalizarTelefoneBR(raw) {
    const digits = raw.replace(/\D/g, '');
    const base = digits.startsWith('55') ? digits : '55' + digits;

    const variacoes = new Set([base]);

    if (base.length === 12) {
        // 55+DDD+8 dígitos → variação COM 9º dígito inserido após o DDD
        variacoes.add(base.slice(0, 4) + '9' + base.slice(4));
    } else if (base.length === 13) {
        // 55+DDD+9+8 dígitos → variação SEM 9º dígito
        variacoes.add(base.slice(0, 4) + base.slice(5));
    }

    return Array.from(variacoes).map(n => `${n}@s.whatsapp.net`);
}

app.post('/webhook/calendly', express.json(), async (req, res) => {
    try {
        const evento = req.body;

        if (evento?.event !== 'invitee.created') {
            return res.status(200).json({ ok: true, ignorado: true });
        }

        // Extração defensiva do payload — falha aqui não deve derrubar a rota
        let emailConvidado, telefoneRaw, dataEvento, nomeEvento;
        try {
            const payload  = evento.payload ?? {};
            emailConvidado = payload.email?.toLowerCase?.()?.trim() ?? null;
            telefoneRaw    = payload.text_reminder_number ?? '';
            dataEvento     = payload.scheduled_event?.start_time ?? new Date().toISOString();
            nomeEvento     = payload.event_type?.name ?? 'Consultoria';
        } catch (parseErr) {
            console.error('❌ [CALENDLY] Erro ao parsear payload:', parseErr.message);
            return res.status(200).json({ ok: true, erro: 'payload_invalido' });
        }

        console.log(`📅 [CALENDLY] Agendamento recebido — fone: ${telefoneRaw}, email: ${emailConvidado}`);

        let lead = null;

        // 1. Busca pelo JID do WhatsApp cobrindo as duas variações do 9º dígito
        if (telefoneRaw.replace(/\D/g, '').length >= 10) {
            const jids = normalizarTelefoneBR(telefoneRaw);
            for (const jid of jids) {
                const { data } = await supabase
                    .from('leads')
                    .select('id, name, whatsapp_id, instance_id, dono, niche')
                    .eq('whatsapp_id', jid)
                    .maybeSingle();
                if (data) { lead = data; break; }
            }
        }

        // 2. Fallback por e-mail
        if (!lead && emailConvidado) {
            const { data } = await supabase
                .from('leads')
                .select('id, name, whatsapp_id, instance_id, dono, niche')
                .eq('email', emailConvidado)
                .maybeSingle();
            if (data) lead = data;
        }

        if (!lead) {
            console.warn(`⚠️ [CALENDLY] Lead não encontrado — fone: ${telefoneRaw}, email: ${emailConvidado}`);
            return res.status(200).json({ ok: true, encontrado: false });
        }

        // 3. Trava atômica: desliga o motor de follow-up e registra o agendamento
        await supabase.from('leads').update({
            status:              'closed',
            calendly_booked:     true,
            calendly_event_at:   dataEvento,
            calendly_event_name: nomeEvento,
            is_paused:           true,
            current_stage:       5,
        }).eq('id', lead.id);

        console.log(`✅ [CALENDLY] Lead ${lead.name} travado — is_paused=true, status=closed.`);

        // 4. Alertas: Discord canal comercial + Socket.io para HandoffQueue do frontend
        alertaCalendly({ leadName: lead.dono || lead.name, empresa: lead.name, niche: lead.niche, dataEvento, nomeEvento }).catch(() => {});
        io.emit('handoff_detected', {
            leadId:    lead.id,
            name:      lead.dono || lead.name,
            business:  lead.name,
            niche:     lead.niche || '—',
            reason:    `Reunião confirmada: ${nomeEvento}`,
            instanceId: lead.instance_id,
            pausadoEm: new Date().toISOString(),
        });

        // 5. Acorda o SDR para enviar o feedback humanizado ao lead
        sdrEvents.emit('AGENDAMENTO_CONFIRMADO', { lead, dataEvento, instanceId: lead.instance_id });

        return res.status(200).json({ ok: true, lead: lead.name });

    } catch (err) {
        console.error('❌ [CALENDLY] Erro:', err.message);
        return res.status(500).json({ erro: err.message });
    }
});

// ============================================================
// 🔍 DIAGNÓSTICO DE CHIP FANTASMA
// ============================================================
app.get('/api/debug-chip/:instanceId', autenticarMiddleware, async (req, res) => {
    try {
        if (!sdr?.getDiagnosticoChip)
            return res.status(503).json({ error: 'Motor SDR não inicializado.' });

        const diagnostico = await sdr.getDiagnosticoChip(req.params.instanceId);
        const temProblema = Object.values(diagnostico.causas).some(Boolean);

        res.json({ ok: !temProblema, diagnostico });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// 👤 CRIAÇÃO DE CONTA (ADMIN) — POST /api/admin/criar-conta
// ============================================================================
// Protegida por x-admin-secret. Usa service_role para chamar auth.admin.createUser,
// que cria o usuário sem precisar de confirmação de e-mail. Logo em seguida faz
// upsert explícito em public.profiles para contornar qualquer trigger ausente/defeituoso
// que causaria o erro "Database error creating new user".
// ----------------------------------------------------------------------------
app.post('/api/admin/criar-conta', express.json(), async (req, res) => {
    try {
        // Guard: chave de master — define ADMIN_SECRET no Railway/env
        const secret = req.headers['x-admin-secret'];
        if (!secret || secret !== process.env.ADMIN_SECRET) {
            return res.status(403).json({ error: 'Acesso negado: x-admin-secret inválido.' });
        }

        const { email, password, nome_empresa, produto } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Campos obrigatórios ausentes: email, password.' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Senha precisa ter no mínimo 8 caracteres.' });
        }

        // 1. Criação do usuário no Supabase Auth via service_role (bypass de RLS + email confirm)
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (authError) {
            // Loga o erro completo para diagnóstico — o campo authError.message normalmente
            // é genérico ("Database error creating new user") mas o .status e o .cause
            // revelam a causa real (trigger faltando coluna, FK violada, etc).
            console.error('[ADMIN] Falha ao criar usuário Auth:', {
                message: authError.message,
                status:  authError.status,
                cause:   authError.cause,
                raw:     JSON.stringify(authError),
            });
            return res.status(400).json({
                error:  authError.message,
                code:   authError.status,
                detail: authError.cause || 'Verifique se a tabela public.profiles tem todas as colunas esperadas pelo trigger handle_new_user (id, default_product_type, etc.) e se RLS não está bloqueando o INSERT do trigger.',
            });
        }

        const userId = authData.user.id;
        console.log(`✅ [ADMIN] Usuário Auth criado: ${email} → ${userId}`);

        // 2. Upsert explícito em public.profiles — tolera trigger já existente (onConflict: 'id')
        //    e garante que o perfil exista mesmo se o trigger estiver desabilitado/ausente.
        const { error: profileError } = await supabase.from('profiles').upsert({
            id:                   userId,
            default_company_name: nome_empresa || null,
            default_product_type: produto      || 'solar',
        }, { onConflict: 'id' });

        if (profileError) {
            console.error(`[ADMIN] Erro ao criar perfil para ${userId}:`, {
                message: profileError.message,
                code:    profileError.code,
                details: profileError.details,
                hint:    profileError.hint,
            });
            // Não faz rollback: usuário Auth foi criado com sucesso.
            // Perfil incompleto pode ser preenchido depois via settings.
            return res.status(207).json({
                ok:               false,
                user_id:          userId,
                email,
                aviso:            'Usuário criado no Auth, mas houve erro ao criar o perfil.',
                profile_error:    profileError.message,
                profile_hint:     profileError.hint,
            });
        }

        console.log(`✅ [ADMIN] Perfil criado para ${userId} (empresa: ${nome_empresa || '—'}, produto: ${produto || 'solar'})`);
        return res.status(201).json({ ok: true, user_id: userId, email });

    } catch (err) {
        console.error('[ADMIN] Falha crítica na rota de criação de conta:', err);
        return res.status(500).json({ error: 'Erro interno do servidor.', detail: err.message });
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

        if (!instanceId || !whatsappId || !text)
            return res.status(400).json({ success: false, error: "Faltam parâmetros obrigatórios." });

        if (!sdr || !sdr.enviarMensagemSDR)
            return res.status(500).json({ success: false, error: "Motor SDR não está pronto." });

        // Verifica que o chip pertence ao usuário autenticado
        const instOwner = await db.getInstanceRules(instanceId);
        if (!instOwner || instOwner.user_id !== req.user.id)
            return res.status(403).json({ success: false, error: "Acesso negado." });

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