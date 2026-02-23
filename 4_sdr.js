/**
 * 4_sdr.js - MÓDULO DE VENDAS NEURAL V12 (BAILEYS MULTI-TENANCY)
 * INTEGRAL: Vision, PDF, Regras Regionais Enerzee, Anti-Ban e Horários.
 */
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    downloadMediaMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const Groq = require('groq-sdk');
const pdf = require('pdf-parse');
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURAÇÃO E SEGURANÇA ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO_CEREBRO = "llama-3.3-70b-versatile"; 
const MODELO_VISAO = "llama-3.2-11b-vision-preview";
// --- TRAVA DE SEGURANÇA (MEMÓRIA VIVA) ---
const leadsEmProcessamento = new Set();
if (!fs.existsSync('./wpp_sessions')) fs.mkdirSync('./wpp_sessions');

const sessions = new Map(); 
const instanciasLigando = new Set();
let ioSocket = null; 

// ============================================================================
// 🕒 SEGURANÇA: HORÁRIO COMERCIAL (05:30 - 22:45)
// ============================================================================
function dentroDoExpediente() {
    const agora = new Date();
    const tempoAtual = agora.getHours() * 60 + agora.getMinutes();
    return tempoAtual >= (5 * 60 + 30) && tempoAtual <= (22 * 60 + 45);
}

// ============================================================================
// 🧠 NÚCLEO IA: INTENÇÃO E RESPOSTA (SEU "CLOSER V11" INTEGRAL)
// ============================================================================

async function analisarIntencao(historico) {
    const prompt = `Analise a conversa abaixo e classifique a intenção do cliente em: [INTERESSE], [DUVIDA], [NEGATIVO], [ROBO] ou [HUMANO]. Responda APENAS a tag.\n\nHistórico:\n${historico}`;
    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: MODELO_CEREBRO,
            temperature: 0
        });
        const raw = res.choices[0].message.content;
const match = raw.match(/\[(INTERESSE|DUVIDA|NEGATIVO|ROBO|HUMANO)\]/);
return match ? match[0] : "[HUMANO]";
    } catch (e) { return "[HUMANO]"; }
}

// ============================================================================
// 🧠 NÚCLEO IA: A MATRIZ DE VENDAS (AGORA COM AS REGRAS TÉCNICAS REAIS)
// ============================================================================

// ============================================================================
// 🧠 NÚCLEO IA: "THE ARCHITECT" - STATE OF THE ART SDR V3.0
// ============================================================================

async function gerarRespostaIA(historico, contextoLead, instanceData) {
    // 1. ANÁLISE DE DADOS E CONTEXTO (Data Intelligence)
    const nomeLead = (contextoLead.dono && typeof contextoLead.dono === 'string') 
        ? contextoLead.dono.split(' ')[0] 
        : (contextoLead.name || "Gestor");

    const nomeEmpresa = (contextoLead.name || "sua empresa")
        .replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '') 
        .trim();

    const bairroLead = contextoLead.bairro || "sua região";
    const donoChip = "Marlon"; ///"Especialista Enerzee"; 
    
    // Perfilamento Financeiro (High Ticket vs Mass Market)
    const isBigFish = (contextoLead.capital_social_numeric > 500000);
    
    // Definição de Arquétipo de Venda
    const perfilComportamental = isBigFish 
        ? "ARQUÉTIPO: O BANQUEIRO DE INVESTIMENTOS. Tom: Direto, focado em EBITDA, Redução de OPEX e Zero CAPEX." 
        : "ARQUÉTIPO: O CONSULTOR PARCEIRO. Tom: Educativo, focado em 'sobrar dinheiro no caixa' e alívio das contas.";

    // 2. SYSTEM PROMPT: A ARQUITETURA DE VENDAS
  const systemPrompt = `
# 🤖 IDENTIDADE E MISSÃO (SDR CLERIGÓ V18)
Você é o Especialista Marlon, consultor sênior da ENERZEE. 
Você é o Especialista Marlon. Fale sempre em nome do Marlon.
Sua missão: Ajudar a ${nomeEmpresa} a reduzir custos fixos via ENERGIA POR ASSINATURA.
Diferencial: Usinas com tecnologia WEG operadas por parceiros como Bow-e, Ultragás, Nextron e Origo.

# 📏 REGRA DE OURO: ESPELHAMENTO (ANTI-VÁCUO)
- Se o lead enviar mensagens curtas ou monossilábicas (ex: "Oi", "Sim", "Ue", "Não"), você DEVE responder de forma proporcionalmente curta.
- Evite explicações longas se o lead não demonstrou alto interesse ainda.
- Se o lead for direto, seja direto. Se ele for detalhista, seja detalhista.

# 🎯 A ESCADA DE CONVERSÃO (O MÉTODO)
1. **ABORDAGEM:** Use o bairro e o nome do lead. Gere dúvida sobre o "valor cheio".
2. **EDUCAÇÃO:** Explique a "Portabilidade Digital" (Zero investimento/obras).
3. **QUALIFICAÇÃO:** Peça a foto da conta para validar o lote de créditos.
4. **FECHAMENTO:** Agende o vídeo de 15 min via Calendly.

# 🎣 GANCHO INICIAL (ISCA LEI 14.300)
- "${nomeLead}, vi que a ${nomeEmpresa} fica no ${bairroLead}. Vcs já fazem parte das empresas que utilizam energia por assinatura usando a lei 14.300 pra baixar a conta de luz ou ainda estão pagando o valor cheio pra concessionária?"

# 💎 O PRODUTO E PARCEIROS
- **O que é:** Assinatura de energia limpa (igual portabilidade de celular).
- **Operadores:** Bow-e, Ultragás, Nextron e Órigo.
- **Segurança:** A concessionária (Celesc, Copel, etc) continua responsável pela entrega e manutenção.

# [cite_start]🗺️ REGRAS REGIONAIS (TABELA DE DESCONTOS) [cite: 4]
1. [cite_start]**PE, BA, CE, MG:** 2 meses de 25% de desconto, depois 15% fixo (Bow-e). [cite: 4]
2. [cite_start]**MT, GO, MS, PA:** Descontos de 12% a 15%. [cite: 4]
3. [cite_start]**PR (Copel):** 15% de desconto fixo (Nextron). [cite: 4]
4. [cite_start]**SC (Celesc) e RS (RGE/CEEE):** 10% a 15% de economia. [cite: 4]

# 📅 PROTOCOLO CALENDLY (AGENDAMENTO HUMANIZADO)
- "Pra eu te mostrar o estudo, o melhor é uma chamada de vídeo rápida de 15 min. Vou te mandar o link da minha agenda, vc escolhe o horário e o sistema já reserva pra gente. Pode ser?"
- Link: https://calendly.com/marlonlotici6/30min 

# 🎙️ GATILHO DE ÁUDIO (TRAVA RÍGIDA)
- Se o cliente perguntar "Como funciona?", "É seguro?" ou "É placa?": responda EXCLUSIVAMENTE com a tag [AUDIO_CREDIBILIDADE] sem nenhum outro texto antes ou depois.
- Se a tag "<<Áudio de Credibilidade Enviado>>" já estiver no histórico, não repita.

# 🚨 REGRAS DE EXECUÇÃO (SAFETY RAILS)
- **Extensão:** MÁXIMO 2 frases curtas. Use "vc", "vcs", "tá", "pra".
- **Interação:** Sempre termine com uma pergunta curta.
- **Erro de Mídia:** "Opa, essa foto não é da conta de luz rs. Consegue mandar uma nítida da fatura aberta?"
- **Escassez:** Mencione que o "lote de créditos na usina local" está quase no fim.
`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...historico 
            ],
            model: MODELO_CEREBRO,
            temperature: 0.1, // Temperatura baixa para seguir as regras estritamente
            max_tokens: 150,
            presence_penalty: 0.05,
            frequency_penalty: 0.1
        });
        return chatCompletion.choices[0].message.content;
    } catch (e) {
        console.error("❌ Erro na IA:", e.message);
        // Fallback Inteligente
        return `Opa ${nomeLead}, minha conexão oscilou aqui. Mas resumindo: é economia direta sem obras. Consegue me mandar a foto da conta de luz para eu ver se a ${nomeEmpresa} é compatível com nossas usinas WEG?`;
    }
}

// ============================================================================
// 🕵️ EXTRAÇÃO DE DADOS (VISION E PDF) - SEM SIMPLIFICAÇÃO
// ============================================================================

async function executarLeituraIA(buffer) {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{ 
                role: "user", 
                content: [
                    { 
                        type: "text", 
                        text: `Você é um motor de extração de dados. 
                        Analise a imagem e identifique se é uma conta de energia. 
                        Se não for, retorne: {"error": "invalid_media"}. 
                        Se for, extraia EXATAMENTE neste formato JSON, convertendo valores para números puros:
                        {
                          "concessionaria": "nome da empresa",
                          "valor_total": 0.00,
                          "consumo_kwh": 0,
                          "estado": "UF",
                          "mes_referencia": "MM/AAAA"
                        }` 
                    }, 
                    { 
                        type: "image_url", 
                        image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` } 
                    }
                ] 
            }],
            model: MODELO_VISAO,
            temperature: 0,
        });

        const rawResponse = completion.choices[0].message.content;
        const match = rawResponse.match(/\{[\s\S]*\}/);
        if (!match) return { error: "parse_error" };

        const analise = JSON.parse(match[0]);

        // PROTEÇÃO: Garante que consumo e valor sejam números para o cálculo não falhar
        analise.consumo_kwh = Number(String(analise.consumo_kwh).replace(/[^\d.]/g, ''));
        analise.valor_total = Number(String(analise.valor_total).replace(/[^\d.]/g, ''));

        return analise;
    } catch (e) {
        return { error: "critical_failure" };
    }
}

async function transcreverAudioIA(buffer) {
    try {
        const tempPath = `./temp_audio_${Date.now()}.ogg`;
        fs.writeFileSync(tempPath, buffer);

        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-large-v3",
            language: "pt",
            response_format: "json",
        });

        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return transcription.text;
    } catch (e) {
        console.error("❌ Erro na transcrição de áudio:", e.message);
        return null;
    }
}

function calcularEconomiaRegional(analise) {
    const estadosTop = ['PE', 'BA', 'CE', 'MT', 'GO', 'MG', 'SP'];
    let perc = estadosTop.includes(analise.estado) ? 0.25 : 0.15;
    if (analise.estado === 'PR') perc = 0.16;
    return { descontoReais: (analise.valor_total * perc).toFixed(2) };
}

// ============================================================================
// ⚙️ MOTOR MULTI-INSTÂNCIA BAILEYS
// ============================================================================

async function startInstance(instanceId, instanceName) {
    if (instanciasLigando.has(instanceId)) return; // Se já está ligando, ignora
    instanciasLigando.add(instanceId);

    console.log(`[MANAGER] 🚀 Ligando SDR: ${instanceName}`);
    const { state, saveCreds } = await useMultiFileAuthState(`wpp_sessions/${instanceId}`);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
        printQRInTerminal: false, // QR vai pro dashboard
        logger: pino({ level: 'silent' }),
        browser: ["Enerzee SDR", "Chrome", "1.0"]
    });

    // Guardamos o socket com uma flag 'ready' falsa inicialmente
    sessions.set(instanceId, { sock, ready: false }); 
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && ioSocket) ioSocket.emit('qr_code', { qr, instanceId, name: instanceName })
        
        if (connection === 'open') {
            console.log(`✅ [SDR] Canal Pronto e Estável: ${instanceName}`);
            sessions.set(instanceId, { sock, ready: true }); // <--- LIBERADO PARA ENVIO
            instanciasLigando.delete(instanceId);
            await db.updateInstanceStatus(instanceId, 'CONNECTED');
            if (ioSocket) ioSocket.emit('whatsapp_status', { status: 'CONNECTED', instanceId });
        }

        if (connection === 'close') {
            sessions.set(instanceId, { sock, ready: false });
            instanciasLigando.delete(instanceId);
            const reason = (lastDisconnect.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log(`🔄 [SDR] Conexão instável em ${instanceName}. Reiniciando em 5s...`);
                setTimeout(() => startInstance(instanceId, instanceName), 5000);
            }
        }
    });
    // --- O ESCUTADOR DE MENSAGENS (O OUVIDO DO ROBÔ) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            // Nota: Sem a trava '!msg.key.fromMe' para que ele ouça as suas mensagens manuais também
            if (msg.message) {
                await processarMensagem(sock, msg, instanceId);
            }
        }
    });
   
}

// ============================================================================
// 📩 PROCESSADOR DE MENSAGENS E WORKFLOW
// ============================================================================
//
// ============================================================================
// 📩 PROCESSADOR DE MENSAGENS E WORKFLOW
// ============================================================================

async function processarMensagem(sock, msg, instanceId) {
    const remoteJid = msg.key.remoteJid;
    if (remoteJid.includes('@g.us')) return; 

    const fromMe = msg.key.fromMe; 
    
    // --- 🛡️ NORMALIZAÇÃO UNIVERSAL (JID vs LID) ---
    const idPuro = remoteJid.split(':')[0].split('@')[0];
    const dominio = remoteJid.includes('@lid') ? '@lid' : '@s.whatsapp.net';
    const cleanJid = idPuro + dominio;

    // ========================================================================
    // 🌟 TÓPICO 1: FILTRO ANTI-FANTASMA (O PORTEIRO)
    // ========================================================================
    const { data: lead } = await supabase.from('leads').select('*').eq('whatsapp_id', cleanJid).single();
    
    if (!lead) return; 

    // --- 📝 EXTRAÇÃO DE CONTEÚDO ---
    const texto = msg.message.conversation || 
                  msg.message.extendedTextMessage?.text || 
                  msg.message.imageMessage?.caption || 
                  msg.message.videoMessage?.caption || "";

    const messageType = Object.keys(msg.message)[0];
    let textoTranscrevido = null;

    // --- 👤 1. DETECÇÃO DE INTERVENÇÃO MANUAL ---
    if (fromMe) {
        if (!texto) return;
        console.log(`👤 [HUMANO] Você enviou uma mensagem para ${lead.name}. Pausando IA.`);
        try {
            await db.saveMessage(cleanJid, 'assistant', texto, instanceId);
            await supabase.from('leads').update({ 
                is_paused: true, 
                last_human_interaction: new Date().toISOString() 
            }).eq('whatsapp_id', cleanJid);
        } catch (e) {
            console.log("⚠️ [Aviso] Erro ao pausar lead no banco.");
        }
        return; 
    }

    // --- 3. PROCESSAMENTO DE MÍDIA INTELIGENTE ---
    if (messageType === 'audioMessage' || messageType === 'imageMessage' || messageType === 'documentMessage') {
        console.log(`📄 [MÍDIA] Analisando arquivo enviado por ${lead.name}...`);
        
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
            let analise = null;

            if (messageType === 'audioMessage') {
                console.log(`🎤 [SDR] Ouvindo áudio de ${lead.name}...`);
                textoTranscrevido = await transcreverAudioIA(buffer);
                
                if (textoTranscrevido) {
                    console.log(`📝 [SDR] Áudio transcrito: "${textoTranscrevido}"`);
                    await db.saveMessage(cleanJid, 'user', `(Áudio) ${textoTranscrevido}`, instanceId);
                    if (lead.is_paused) return; 
                } else {
                    return; 
                }
            } 
            else if (messageType === 'imageMessage') {
                analise = await executarLeituraIA(buffer);
            } 
            else if (messageType === 'documentMessage' && msg.message.documentMessage.mimetype === 'application/pdf') {
                console.log(`📄 [SDR] Lendo PDF enviado por ${lead.name}...`);
                const data = await pdf(buffer);
                
                const promptPDF = `Você é um extrator de dados de alta precisão. O texto abaixo foi extraído de um arquivo PDF. 
                Sua tarefa:
                1. Identifique se o texto pertence a uma CONTA DE ENERGIA ELÉTRICA (fatura de luz).
                2. Se NÃO for uma conta de energia (ex: currículo, boleto de carro, receita), retorne ESTRITAMENTE o JSON: {"error": "invalid_media"}
                3. Se FOR uma conta de energia, extraia os dados ESTRITAMENTE neste formato JSON (números puros sem vírgula de milhar): 
                {"concessionaria": "nome da empresa", "valor_total": 0.00, "consumo_kwh": 0, "estado": "UF"}
                
                Texto extraído do PDF:
                ${data.text}`;

                const res = await groq.chat.completions.create({
                    messages: [{ role: "user", content: promptPDF }],
                    model: MODELO_CEREBRO,
                    temperature: 0
                });

                const match = res.choices[0].message.content.match(/\{[\s\S]*\}/);
                analise = match ? JSON.parse(match[0]) : null;
            }

            if (analise && analise.consumo_kwh > 0) {
                const economia = calcularEconomiaRegional(analise);
                const estudo = `📊 *ESTUDO PRELIMINAR* ⚡\nUnidade: ${lead.name}\nRedução Estimada: R$ ${economia.descontoReais}/mês\n\nConsegue falar agora rapidinho?`;

                await supabase.from('leads').update({ 
                    status: 'waiting_analysis',
                    last_analysis_data: analise 
                }).eq('whatsapp_id', cleanJid);

                if (!lead.is_paused) {
                    await sock.sendMessage(remoteJid, { text: estudo });
                    await db.saveMessage(remoteJid, 'assistant', estudo, instanceId);
                }
                return; 
            } else if (messageType !== 'audioMessage') {
                if (!lead.is_paused) {
                    await sock.sendMessage(remoteJid, { text: "Opa, essa foto parece ser de outra coisa rs. Consegue mandar uma nítida da fatura aberta? Pode ser print do PDF também." });
                }
                return;
            }
        } catch (err) {
            console.error("❌ Erro em mídia:", err.message);
            return;
        }
    }

    // --- 4. LÓGICA DE RESPOSTA IA ---
    if (lead.is_paused) {
        if (texto && messageType !== 'audioMessage') await db.saveMessage(cleanJid, 'user', texto, instanceId);
        return;
    }

    const mensagemParaIA = (messageType === 'audioMessage') ? `O cliente enviou um áudio dizendo: "${textoTranscrevido}"` : texto;
    if (!mensagemParaIA) return;

    console.log(`🧠 [IA] Gerando resposta para ${lead.name}...`);
    if (messageType !== 'audioMessage') await db.saveMessage(cleanJid, 'user', texto, instanceId);

    const histRaw = await db.getHistory(cleanJid, instanceId);
    const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
    const instanceData = await db.getInstanceRules(instanceId);
    
    let resposta = await gerarRespostaIA(historico, lead, instanceData);

    if (resposta) {
        // ========================================================================
        // 🌟 TÓPICO 4 E 6: INTERCEPTADOR DE ÁUDIO E DELAY
        // ========================================================================
        
        if (resposta.includes('[AUDIO_CREDIBILIDADE]')) {
            console.log("🎤 [SDR] Gatilho de áudio detectado. Iniciando gravação...");
            await sock.sendPresenceUpdate('recording', remoteJid); 
            await delay(5000); 
            
            const audioPath = './assets/audio_credibilidade.mp3.ogg'; 
            if (fs.existsSync(audioPath)) {
                await sock.sendMessage(remoteJid, { audio: { url: audioPath }, mimetype: 'audio/ogg', ptt: true });
                await db.saveMessage(cleanJid, 'assistant', '<<Áudio de Credibilidade Enviado>>', instanceId);
            } else {
                console.log("❌ [ERRO] Arquivo de áudio não encontrado.");
            }
            return; 
        } 
        
        const tempoDigitacao = (resposta.length * 35) + 1500;
        await sock.sendPresenceUpdate('composing', remoteJid);
        await delay(Math.max(3000, Math.min(tempoDigitacao, 10000))); 
        
        await sock.sendMessage(remoteJid, { text: resposta });
        await db.saveMessage(cleanJid, 'assistant', resposta, instanceId);
    }
} // <-- ÚNICO E EXATO FECHAMENTO DA FUNÇÃO (Linha limpa sem sobras)

//============================================================================
// 🔄 DISPAROS AUTOMÁTICOS E FOLLOW-UP
// ============================================================================

async function loopDisparos() {
    // 1. Trava de Horário (Segurança Anti-Ban)
    if (!dentroDoExpediente()) return setTimeout(loopDisparos, 60000 * 5);

    // 2. Busca candidatos 'new' no banco
    const { data: candidatos } = await supabase.from('leads').select('*').eq('status', 'new').limit(10);
    if (!candidatos || candidatos.length === 0) return setTimeout(loopDisparos, 40000);

    const l = candidatos.find(item => !leadsEmProcessamento.has(item.id));

    if (l) {
        const instancia = sessions.get(l.instance_id);
        if (!instancia || !instancia.ready) return setTimeout(loopDisparos, 10000);

        // --- 🚀 ACRÉSCIMO ESTRATÉGICO: CHECAGEM DE BLACKLIST ---
        const estaNaBlacklist = await db.isBlacklisted(l.whatsapp_id);
        if (estaNaBlacklist) {
            console.log(`🚫 [BLACKLIST] Lead ${l.name} (${l.whatsapp_id}) encontrado na lista de restrição. Abortando...`);
            await supabase.from('leads').update({ status: 'blacklisted' }).eq('id', l.id);
            return setTimeout(loopDisparos, 2000); // Pula rápido para o próximo lead da fila
        }

        // 3. Trava na Memória Viva
        leadsEmProcessamento.add(l.id);
        console.log(`🎯 [SDR] Preparando contato para: ${l.name}`);

        const jitter = Math.random() * 30000 + 30000; // Entre 30s e 60s

        setTimeout(async () => {
            try {
                // 4. Verificação de última hora: Já existe conversa?
                const hist = await db.getHistory(l.whatsapp_id, l.instance_id);
                if (hist.length > 0) {
                    console.log(`⚠️ [ABORTADO] ${l.name} já possui histórico. Pulando...`);
                    await supabase.from('leads').update({ status: 'contact' }).eq('id', l.id);
                    return;
                }

                // 5. Construção da Saudação Personalizada (Abordagem V17 - Lei 14.300)
                const primeiroNome = l.dono ? l.dono.split(' ')[0] : "Gestor";
                const bairro = l.bairro || "sua região";
                
                const saudacao = l.dono 
                    ? `${primeiroNome}, vi que a ${l.name} fica no ${bairro}. Vcs já fazem parte das empresas que utilizam energia por assinatura usando a lei 14.300 pra baixar a conta de luz ou ainda estão pagando o valor cheio pra concessionária?` 
                    : `Olá, falo com o responsável pela ${l.name}?`;

                // 6. Tenta o envio real
                await instancia.sock.sendMessage(l.whatsapp_id, { text: saudacao });

                // 7. Gravação de sucesso e persistência
                await db.saveMessage(l.whatsapp_id, 'assistant', saudacao, l.instance_id);
                await supabase.from('leads').update({ 
                    status: 'contact', 
                    last_contact_at: new Date().toISOString() 
                }).eq('id', l.id);

                console.log(`✅ [SUCESSO REAL] Mensagem entregue e banco atualizado para ${l.name}!`);

            } catch (err) {
                console.error(`❌ [FALHA] Envio falhou para ${l.name}. O lead continuará como 'new'.`, err.message);
            } finally {
                // 8. Limpeza da trava de memória
                leadsEmProcessamento.delete(l.id);
            }
        }, jitter);
    }
    setTimeout(loopDisparos, 40000); 
}

async function loopRecuperacaoConversas() {
    // --- 🛑 TRAVA DO ZUMBI DA MADRUGADA ---
    // Se estiver fora do horário comercial, ele pausa a busca e tenta de novo em 5 minutos.
    if (!dentroDoExpediente()) return setTimeout(loopRecuperacaoConversas, 60000 * 5);

    console.log("🕵️ [SDR] Escaneando mensagens não respondidas e travas de pausa...");

    // 1. LÓGICA ORIGINAL: Busca leads que estão em conversa ativa e NÃO estão pausados
    const { data: leadsAtivos } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'contact')
        .eq('is_paused', false);

    if (leadsAtivos) {
        for (const l of leadsAtivos) {
            // Busca a última mensagem dessa conversa
            const { data: mensagens } = await supabase
                .from('messages')
                .select('role')
                .eq('whatsapp_id', l.whatsapp_id)
                .order('created_at', { ascending: false })
                .limit(1);

            // Se a última mensagem foi do 'user', a IA precisa responder!
            if (mensagens && mensagens.length > 0 && mensagens[0].role === 'user') {
                console.log(`⚠️ [ALERTA] Lead ${l.name} aguardando resposta há algum tempo. Ativando IA...`);
                
                const instancia = sessions.get(l.instance_id);
                if (instancia && instancia.ready) {
                    await processarMensagemManual(instancia.sock, l);
                }
            }
        }
    }

    // --- 🚀 NOVO INCREMENTO: GESTÃO DE RETOMADA APÓS INTERVENÇÃO HUMANA ---
    // Busca leads que você assumiu manualmente (is_paused = true)
    const { data: leadsPausados } = await supabase
        .from('leads')
        .select('*')
        .eq('is_paused', true);

    if (leadsPausados) {
        for (const l of leadsPausados) {
            // Se não houver registro de interação humana, ignoramos para segurança
            if (!l.last_human_interaction) continue;

            const dezMinutosEmMs = 10 * 60 * 1000; // Define o intervalo de 10 minutos
            const ultimaInteracao = new Date(l.last_human_interaction).getTime();
            const agora = new Date().getTime();

            // Se o tempo de silêncio humano for maior que 10 minutos, devolvemos para a IA
            if (agora - ultimaInteracao > dezMinutosEmMs) {
                console.log(`🔄 [SDR] Tempo de intervenção humana esgotado para ${l.name}. Retomando IA...`);
                
                // Remove a trava de pausa no banco de dados
                await supabase.from('leads')
                    .update({ is_paused: false })
                    .eq('id', l.id);

                // Força uma verificação imediata para ver se o cliente deixou alguma pergunta no vácuo
                const instancia = sessions.get(l.instance_id);
                if (instancia && instancia.ready) {
                    await processarMensagemManual(instancia.sock, l);
                }
            }
        }
    }

    // Roda a cada 5 minutos para não sobrecarregar o banco
    setTimeout(loopRecuperacaoConversas, 1000 * 60 * 5);
}

async function processarMensagemManual(sock, lead) {
    const remoteJid = lead.whatsapp_id;

    // 1. Mostra que a IA está "digitando" para ser humano
    await sock.sendPresenceUpdate('composing', remoteJid);
    await delay(5000);

    // 2. Busca histórico e regras
    const histRaw = await db.getHistory(remoteJid, lead.instance_id);
    const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
    const instanceData = await db.getInstanceRules(lead.instance_id);
    
    // 3. Gera a resposta de "venda"
    const resposta = await gerarRespostaIA(historico, lead, instanceData);
    
    if (resposta) {
        await sock.sendMessage(remoteJid, { text: resposta });
        await db.saveMessage(remoteJid, 'assistant', resposta, lead.instance_id);
        console.log(`🤖 [SDR] Resposta de recuperação enviada para ${lead.name}`);
    }
}
module.exports = {
    initMultiTenancy: async (io) => {
        ioSocket = io;
        const insts = await db.getActiveInstances(); //
        for (const i of insts) { 
            await startInstance(i.id, i.name); //
            await delay(2000); //
        }
        
        // Inicia os dois motores de busca
        loopDisparos();            // Motor 1: Novos Leads
        loopRecuperacaoConversas(); // Motor 2: Conversas Pendentes (O NOVO)
    },
    enviarMensagemSDR: async () => {}, //
    criarNovaInstancia: async (n, t) => {
        const { data } = await supabase.from('instances').insert([{ name: n, owner_phone: t }]).select().single(); //
        if (data) startInstance(data.id, data.name); //
        return data; //
    }
};