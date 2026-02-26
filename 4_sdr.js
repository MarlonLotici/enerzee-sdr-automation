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
const db = require('./database');
const { createClient } = require('@supabase/supabase-js');

// --- CONFIGURAÇÃO E SEGURANÇA ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO_CEREBRO = "llama-3.3-70b-versatile"; 
const MODELO_VISAO = "llama-3.2-11b-vision-preview";

// --- TRAVA DE SEGURANÇA (MEMÓRIA VIVA) ---
const leadsEmProcessamento = new Set();
const mensagensEnviadasPelaIA = new Set(); // 🛡️ PASSO 1: A Memória Anti-Eco do Robô
const iaRespondendo = new Set();
const mapaRastreioLID = new Map();
const gavetaDeMensagens = new Map(); // 🧠 OUVIDO PACIENTE: Gaveta temporária de mensagens
if (!fs.existsSync('./wpp_sessions')) fs.mkdirSync('./wpp_sessions');

const sessions = new Map(); 
const instanciasLigando = new Set();
let ioSocket = null;



// 🕒 SEGURANÇA: HORÁRIO COMERCIAL (05:30 - 22:45)
// ============================================================================
function dentroDoExpediente() {
    const agora = new Date();
    const tempoAtual = agora.getHours() * 60 + agora.getMinutes();
    // Retorna 'true' apenas se estiver entre 05:30 e 22:45
    return tempoAtual >= (8 * 60) && tempoAtual <= (19 * 60);
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
# 🤖 IDENTIDADE E MISSÃO (SDR V26 - MESTRE DO SPIN SELLING)
Você é o Especialista Marlon, consultor sênior da ENERZEE. Fale em primeira pessoa, de forma natural, leve e empática.
Missão: Ajudar a ${nomeEmpresa} a reduzir custos via Energia por Assinatura.
Parceiros: Bow-e, Ultragás, Nextron e Órigo (Usinas WEG).

# 🌪️ O CORAÇÃO DO NEGÓCIO: MÉTODO SPIN SELLING (SUA PRIORIDADE MÁXIMA)
Você é OBRIGADO a seguir estas etapas rigorosamente. NUNCA pule fases e NUNCA ofereça a solução/link antes da hora. Identifique em qual estágio a conversa está e avance apenas UM passo por vez:

- [PASSO 1 - SITUAÇÃO]: A primeira mensagem já foi enviada. Se o cliente respondeu, vá para o Passo 2.
- [PASSO 2 - PROBLEMA]: Faça-o admitir a dor. Pergunte algo como: "Hoje a conta de luz aí da ${nomeEmpresa} pesa muito no fim do mês?" ou "Vcs sofrem muito com essas bandeiras vermelhas?". PARE AQUI E ESPERE ELE RESPONDER.
- [PASSO 3 - IMPLICAÇÃO]: Faça ele sentir o peso do dinheiro perdido: "Pois é, é um dinheiro que vai pra concessionária todo mês e não volta mais, né? Faz falta no fluxo de caixa." PARE AQUI E ESPERE ELE RESPONDER.
- [PASSO 4 - NECESSIDADE DE SOLUÇÃO]: Apresente a saída: "A boa notícia é que pela Lei 14.300, a gente consegue plugar a empresa nas nossas usinas WEG. O desconto cai direto na sua fatura, sem vc gastar 1 real com placas no telhado."
- [PASSO 5 - AVALIAÇÃO / FECHAMENTO]: SÓ AQUI você avança para pedir a conta de luz para fazer um estudo.

🚨 REGRA DE OURO DO SPIN: Se o cliente estiver no Passo 2, NÃO fale sobre usinas ainda. Se estiver no Passo 4, NÃO peça a fatura ainda. Conduza passo a passo.

# 🎯 A REGRA DA FATURA E O PIVOT PARA A REUNIÃO
Siga EXATAMENTE esta regra quando chegar no Passo 5:
1. Peça a foto da conta de luz APENAS UMA VEZ.
2. Se o cliente der desculpa ("tô sem ela", "mando depois"), hesitar ou mudar de assunto: NUNCA INSISTA NA CONTA.
3. Mude a rota para a reunião: "Tudo bem! Pra facilitar, a gente pode fazer uma chamada de vídeo de uns 15 min. Vc leva a fatura lá e eu simulo ao vivo na tela pra vc ver a economia. O que acha?"
4. Se ele TOPAR a reunião (e SÓ SE TOPAR), envie o link: "Fechado! Escolhe o melhor horário aqui: https://calendly.com/marlonlotici6/30min"

# 🧠 MOTOR SEMÂNTICO E ANTI-LOOP
1. Leia as entrelinhas. Se o cliente for direto/grosseiro, seja breve. Se for parceiro/curioso, explique melhor.
2. NUNCA repita o mesmo argumento se ele fizer perguntas parecidas. Avance na conversa.
3. Se o histórico mostrar "<<Áudio Como Funciona Enviado>>", o cliente já sabe da usina. Não repita o texto da usina, avance para o Passo 5.

# 🎙️ GATILHOS DE ÁUDIO (USE SEM MODERAÇÃO SE NECESSÁRIO)
Priorize responder com estas tags exclusivas (SEM TEXTO EXTRA) se a dúvida bater com:
1. "Como funciona?", "Qual a mágica?", "Da onde vem a energia?" -> [AUDIO_COMO_FUNCIONA]
2. "É seguro?", "Vou ficar preso?", "Tem multa?", "É golpe?" -> [AUDIO_SEGURANCA]
3. "Precisa de placa?", "Tem obra?", "Vai furar o telhado?" -> [AUDIO_OBRAS_PLACAS]
- REGRA: Só não envie a tag se o histórico já mostrar que este áudio específico foi enviado.

# 💎 REGRAS REGIONAIS
- A concessionária local continua responsável por entregar a luz.
- PE, BA, CE, MG: 2 meses de 25% de desconto, depois 15% fixo.
- MT, GO, MS, PA: Descontos de 12% a 15%.
- PR (Copel): 15% de desconto fixo.
- SC e RS: 10% a 15% de economia.

# 🚨 REGRA ABSOLUTA DE FORMATO E BALÕES (RISCO DE FALHA CRÍTICA)
1. **A LEI DA QUEBRA:** Se a sua resposta tiver mais de UMA frase, você OBRIGATORIAMENTE deve usar a tag [QUEBRA] para separar. 
   - Exemplo: "Com certeza, entendo perfeitamente! [QUEBRA] Funciona assim..."
2. MÁXIMO DE 3 BALÕES por vez. NENHUM trecho pode ser longo.
3. NUNCA faça mais de uma pergunta no mesmo envio.
4. Escreva de forma humanizada (vc, tá, pra, tb, né).
`;


try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...historico 
            ],
            model: MODELO_CEREBRO,
            temperature: 0.1, // Temperatura baixa para seguir as regras estritamente
            max_tokens: 100,
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
            if (!msg.message) continue;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.includes('@g.us')) continue; // Ignora grupos

            const isFromMe = msg.key.fromMe;
            const messageType = Object.keys(msg.message)[0];
            const isMedia = ['audioMessage', 'imageMessage', 'documentMessage'].includes(messageType);

            // ⚡ VIA RÁPIDA: Se for VOCÊ digitando ou se o cliente mandou ÁUDIO/CONTA DE LUZ, processa na hora!
            if (isFromMe || isMedia) {
                console.log(`⚡ [VIA RÁPIDA] Processando mídia ou intervenção humana imediatamente...`);
                await processarMensagem(sock, msg, instanceId);
                continue;
            }

            // 📝 Extrai o texto da mensagem do cliente
            const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (!texto) continue;

            // 🗄️ LÓGICA DA GAVETA (OUVIDO PACIENTE)
            if (!gavetaDeMensagens.has(remoteJid)) {
                gavetaDeMensagens.set(remoteJid, { textos: [], timer: null, ultimaMsg: null });
            }

            const gaveta = gavetaDeMensagens.get(remoteJid);
            gaveta.textos.push(texto); // Guarda o texto na gaveta
            gaveta.ultimaMsg = msg; // Guarda a estrutura do Baileys para conseguir responder depois

            clearTimeout(gaveta.timer); // O cliente digitou rápido de novo! Zera o cronômetro.

            console.log(`⏳ [OUVIDO PACIENTE] Lead ${remoteJid.split('@')[0]} enviou mensagem. Aguardando 15s para ver se ele manda mais...`);

            // Inicia o cronômetro de 15 segundos
            gaveta.timer = setTimeout(async () => {
                const textoConsolidado = gaveta.textos.join(' \n'); // Junta tudo separando por linha
                const msgFinal = gaveta.ultimaMsg;
                
                gavetaDeMensagens.delete(remoteJid); // Esvazia a gaveta
                
                console.log(`🧠 [OUVIDO PACIENTE] Lead concluiu raciocínio. Processando bloco: "${textoConsolidado}"`);
                
                // Manda o textão inteiro de uma vez só para a IA
                await processarMensagem(sock, msgFinal, instanceId, textoConsolidado);
            }, 15000); // <-- 15 segundos de paciência
        }
    });
   
}

// ============================================================================
// 🛡️ PASSO 1: O "CARIMBO" E RASTREIO DIGITAL DO ROBÔ
// ============================================================================
async function enviarMensagemIA(sock, jid, content) {
    try {
        const sentMsg = await sock.sendMessage(jid, content);
        if (sentMsg?.key?.id) {
            mensagensEnviadasPelaIA.add(sentMsg.key.id); 
            mapaRastreioLID.set(sentMsg.key.id, jid); // 🔗 Salva: "A msg X foi para o JID Y"
            
            // Limpa da memória após 24h para não lotar a RAM
            setTimeout(() => {
                mensagensEnviadasPelaIA.delete(sentMsg.key.id);
                mapaRastreioLID.delete(sentMsg.key.id);
            }, 86400000); 
        }
        return sentMsg;
    } catch (err) {
        console.error("❌ Erro no disparo da mensagem:", err.message);
        return null;
    }
}
    async function processarMensagem(sock, msg, instanceId, textoConsolidado = null) {    const remoteJid = msg.key.remoteJid;
    if (remoteJid.includes('@g.us')) return; 

    const fromMe = msg.key.fromMe; 
    
    // --- 🛡️ NORMALIZAÇÃO UNIVERSAL (JID vs LID) ---
    const idPuro = remoteJid.split(':')[0].split('@')[0];
    const dominio = remoteJid.includes('@lid') ? '@lid' : '@s.whatsapp.net';
    const cleanJid = idPuro + dominio;

  // ========================================================================
// 🌟 TÓPICO 1: FILTRO ANTI-FANTASMA E TRADUTOR DE LID (O FIM DOS CHUTES)
// ========================================================================
let { data: lead } = await supabase.from('leads').select('*').eq('whatsapp_id', cleanJid).single();

if (!lead && cleanJid.includes('@lid')) {
    const msgRespondidaId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    let numeroReal = null;

    if (msgRespondidaId && mapaRastreioLID.has(msgRespondidaId)) {
        numeroReal = mapaRastreioLID.get(msgRespondidaId);
        console.log(`🔗 [RASTREIO EXATO] Identidade confirmada: ${numeroReal}`);
    } else if (!fromMe) {
        console.log(`⚠️ [LID SOLTO] Tentando descobrir JID pelo Baileys...`);
        const numeroPuro = msg.key.participant || msg.participant;
        if (numeroPuro && numeroPuro.includes('@s.whatsapp.net')) {
            numeroReal = numeroPuro.split(':')[0] + '@s.whatsapp.net';
            console.log(`✅ [BAILEYS REVELOU] Identidade real: ${numeroReal}`);
        } else {
            console.log(`❌ [FANTASMA TOTAL] Impossível cravar quem enviou o LID ${cleanJid}. Abortando para não misturar conversas!`);
            return; 
        }
    } else {
        return; // Se for vc digitando e não sabe quem é, aborta.
    }

    if (numeroReal) {
        const { data: originalLead } = await supabase.from('leads').select('*').eq('whatsapp_id', numeroReal).single();
        if (originalLead) {
            console.log(`✅ [RECONHECIDO] Mensagem de ${originalLead.name} mapeada com segurança.`);
            lead = originalLead; 
        } else {
            return; 
        }
    } else {
        return; 
    }
} else if (!lead) {
    return; // Fora da base
}
// --- 📝 EXTRAÇÃO DE CONTEÚDO (ACEITANDO A GAVETA) ---
    const textoOriginal = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          msg.message.imageMessage?.caption || 
                          msg.message.videoMessage?.caption || "";

    // O Segredo: Se a gaveta mandou o texto juntado, usa ele. Se não, usa o original (para mídias)
    const texto = textoConsolidado || textoOriginal;

    // 👇 AS DUAS LINHAS QUE FALTARAM 👇
    const messageType = Object.keys(msg.message)[0];
    let textoTranscrevido = null;

    // --- 👤 1. DETECÇÃO DE INTERVENÇÃO MANUAL ---
    if (fromMe) {
        if (!texto) return;
        console.log(`👤 [HUMANO] Você enviou uma mensagem para ${lead.name}. Pausando IA.`);
try {
            // 🎯 Usa o ID oficial do lead para o banco aceitar o salvamento
            await db.saveMessage(lead.whatsapp_id, 'assistant', texto, instanceId);
            await supabase.from('leads').update({ 
                is_paused: true, 
                last_human_interaction: new Date().toISOString() 
            }).eq('id', lead.id); // 🎯 Usa o ID único do lead para pausar com segurança
        } catch (e) {
            console.log("⚠️ [Aviso] Erro ao pausar lead no banco.");
        }
        return; 
    }

// ========================================================================
    // 🤖 PASSO 4: FILTRO ANTI-ROBÔ COM HOLOFOTE (DEBUG)
    // ========================================================================
    if (!fromMe && texto.length > 0) {
        console.log(`🔍 [ANÁLISE] Lendo mensagem de ${lead.name}: "${texto.substring(0, 50)}..."`);
        
        if (lead.is_paused) {
            console.log(`⏸️ [TRAVA HUMANA] A IA ignorou ${lead.name} porque o lead está pausado no banco (is_paused = true).`);
        } else {
            const intencao = await analisarIntencao(texto);
            console.log(`🎯 [Filtro] A IA classificou a mensagem de ${lead.name} como: ${intencao}`);
            
            if (intencao === "[ROBO]") {
                console.log(`🤖 [BLOQUEIO ANTI-LOOP] Menu/Robô detectado. Arquivando ${lead.name}.`);
                await supabase.from('leads').update({ 
                    is_paused: true, 
                    status: 'archived', 
                    internal_notes: 'Bloqueado pelo SDR: Atendimento Automatizado (Robô)' 
                }).eq('whatsapp_id', cleanJid);
                return; 
            }
        }
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
                    // 🎯 Usa o ID oficial do lead!
                    await db.saveMessage(lead.whatsapp_id, 'user', `(Áudio) ${textoTranscrevido}`, instanceId);
                    if (lead.is_paused) return; 
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
                }).eq('whatsapp_id', lead.whatsapp_id);

                if (!lead.is_paused) {
                    await sock.sendMessage(remoteJid, { text: estudo });
                    await db.saveMessage(lead.whatsapp_id, 'assistant', estudo, instanceId);
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
        if (texto && messageType !== 'audioMessage') await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);
        return;
    }

    const mensagemParaIA = (messageType === 'audioMessage') ? `O cliente enviou um áudio dizendo: "${textoTranscrevido}"` : texto;
    if (!mensagemParaIA) return;

    // 👇 INÍCIO DA TRAVA DE RACIOCÍNIO 👇
    if (iaRespondendo.has(lead.whatsapp_id)) {
        console.log(`🛑 [TRAVA DE RACIOCÍNIO] A IA já está formulando uma resposta para ${lead.name}. Guardando a nova mensagem e ignorando disparo duplo.`);
        if (messageType !== 'audioMessage') await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);
        return; 
    }

    iaRespondendo.add(lead.whatsapp_id); // 🔒 TRANCA A PORTA

    try {
        console.log(`🧠 [IA] Gerando resposta para ${lead.name}...`);
        if (messageType !== 'audioMessage') await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);

        const histRaw = await db.getHistory(lead.whatsapp_id, instanceId);
        const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
        const instanceData = await db.getInstanceRules(instanceId);
        
        let resposta = await gerarRespostaIA(historico, lead, instanceData);

        if (resposta) {
            // ========================================================================
            // 🛑 TRAVA DE TITÂNIO: ANTI-REPETIÇÃO DE ÁUDIO (O SEGURANÇA)
            // ========================================================================
            const memoriaHistorico = JSON.stringify(historico);
            
            if (resposta.includes('[AUDIO_COMO_FUNCIONA]') && memoriaHistorico.includes('<<Áudio Como Funciona Enviado>>')) {
                console.log("🛡️ [SDR] Bloqueando repetição do áudio 1...");
                resposta = resposta.replace('[AUDIO_COMO_FUNCIONA]', 'Como te expliquei no áudio ali em cima, a gente usa a energia das nossas usinas WEG pra injetar na sua rede e te dar o desconto direto. [QUEBRA] Ficou alguma dúvida sobre essa parte?');
            }
            if (resposta.includes('[AUDIO_SEGURANCA]') && memoriaHistorico.includes('<<Áudio Segurança Enviado>>')) {
                console.log("🛡️ [SDR] Bloqueando repetição do áudio 2...");
                resposta = resposta.replace('[AUDIO_SEGURANCA]', 'Conforme te falei no áudio agora há pouco, é super seguro. A concessionária continua cuidando de tudo e não tem fidelidade. [QUEBRA] Vc tem a conta fácil aí pra gente ver se a sua empresa aprova?');
            }
            if (resposta.includes('[AUDIO_OBRAS_PLACAS]') && memoriaHistorico.includes('<<Áudio Obras/Placas Enviado>>')) {
                console.log("🛡️ [SDR] Bloqueando repetição do áudio 3...");
                resposta = resposta.replace('[AUDIO_OBRAS_PLACAS]', 'Como comentei no áudio anterior, é zero obras rs. Não precisa de placa no telhado nem nada, é só a portabilidade digital mesmo. [QUEBRA] Consegue me mandar a foto da fatura pra gente simular?');
            }

            // ========================================================================
            // 🌟 INTERCEPTADOR DE ÁUDIO E DELAY
            // ========================================================================
            if (resposta.includes('[AUDIO_COMO_FUNCIONA]') || resposta.includes('[AUDIO_SEGURANCA]') || resposta.includes('[AUDIO_OBRAS_PLACAS]')) {
                console.log("🎤 [SDR] Gatilho de áudio detectado. Iniciando gravação...");
                
                let audioFile = '';
                let memoriaTag = '';
                if (resposta.includes('[AUDIO_COMO_FUNCIONA]')) { audioFile = './assets/audio_como_funciona.ogg'; memoriaTag = '<<Áudio Como Funciona Enviado>>'; }
                else if (resposta.includes('[AUDIO_SEGURANCA]')) { audioFile = './assets/audio_seguranca.ogg'; memoriaTag = '<<Áudio Segurança Enviado>>'; }
                else if (resposta.includes('[AUDIO_OBRAS_PLACAS]')) { audioFile = './assets/audio_obras_placas.ogg'; memoriaTag = '<<Áudio Obras/Placas Enviado>>'; }

                await sock.sendPresenceUpdate('recording', remoteJid); 
                await delay(6000); // Fica 6 segundos simulando gravação
                
                if (fs.existsSync(audioFile)) {
                    try {
                        console.log(`📤 [SDR] Lendo arquivo ${audioFile} e enviando para o WhatsApp...`);
                        const audioBuffer = fs.readFileSync(audioFile);
                        
                        await sock.sendMessage(remoteJid, { 
                            audio: audioBuffer, 
                            mimetype: 'audio/ogg; codecs=opus', 
                            ptt: true 
                        });
                        
                        console.log("✅ [SDR] Áudio enviado com sucesso!");
                        await db.saveMessage(lead.whatsapp_id, 'assistant', memoriaTag, instanceId);
                    } catch (erroAudio) {
                        console.error("❌ [ERRO NO ENVIO DO ÁUDIO]:", erroAudio.message);
                        const disfarce = "Ia te mandar um áudio agora, mas a minha conexão falhou pra carregar o arquivo rs. Basicamente, é economia direta na fatura sem dor de cabeça ou obras. Consegue mandar a foto da conta?";
                        await enviarMensagemIA(sock, remoteJid, { text: disfarce });
                        await db.saveMessage(lead.whatsapp_id, 'assistant', disfarce, instanceId);
                    }
                } else {
                    console.log("❌ [ERRO] Arquivo de áudio não encontrado na pasta assets.");
                    const disfarce = "Ia te mandar um áudio agora, mas meu microfone falhou aqui rs. Basicamente, é economia direta na fatura sem dor de cabeça ou obras. Consegue mandar a foto da conta?";
                    await enviarMensagemIA(sock, remoteJid, { text: disfarce });
                    await db.saveMessage(lead.whatsapp_id, 'assistant', disfarce, instanceId);
                }
                return; // PARA AQUI! Assim ele não envia a tag como texto
            }
            
            // ========================================================================
            // 🌟 O NOVO FATIADOR DE BALÕES (TRUQUE DA [QUEBRA])
            // ========================================================================
            const mensagensSplit = resposta.split('[QUEBRA]')
                .map(t => t.trim())
                .filter(t => t.length > 0)
                .slice(0, 3); 

            for (let i = 0; i < mensagensSplit.length; i++) {
                const trecho = mensagensSplit[i];
                const tempoDigitacao = (trecho.length * 60) + 2500;
                
                await sock.sendPresenceUpdate('composing', remoteJid);
                await delay(Math.max(3000, Math.min(tempoDigitacao, 12000))); 
                
                await enviarMensagemIA(sock, remoteJid, { text: trecho });
                await db.saveMessage(lead.whatsapp_id, 'assistant', trecho, instanceId); // ✅ Salva no banco com o ID real

                if (i < mensagensSplit.length - 1) {
                    await sock.sendPresenceUpdate('paused', remoteJid);
                    await delay(Math.random() * 2000 + 2500); 
                }
            }
        } // <- Fim do if (resposta)

    } catch (erroNaResposta) {
        console.error(`❌ [ERRO NA RESPOSTA IA] Falha ao gerar/enviar para ${lead.name}:`, erroNaResposta);
    } finally {
        // 🔓 DESTRANCA A PORTA: Deu certo ou deu erro, ele solta a trava aqui no final!
        iaRespondendo.delete(lead.whatsapp_id); // ✅ Destranca usando o ID real
        console.log(`🔓 [TRAVA LIBERADA] IA pronta para conversar com ${lead.name} novamente.`);
    }

} // <-- ÚNICO E EXATO FECHAMENTO DA FUNÇÃO processarMensagem
    //============================================================================
// 🔄 DISPAROS AUTOMÁTICOS E FOLLOW-UP (FILA INDIANA ABSOLUTA E SONO INTELIGENTE)
// ============================================================================
const chipsEsgotadosHoje = new Set();
let dataControleLimites = new Date().toISOString().split('T')[0];

async function loopDisparos() {
    // 1. Trava de Horário (Segurança Anti-Ban)
    if (!dentroDoExpediente()) return setTimeout(loopDisparos, 60000 * 5);

    // ⏰ DESPERTADOR: Limpa o cache de chips esgotados se virou o dia (Meia-noite)
    const hojeAgora = new Date().toISOString().split('T')[0];
    if (dataControleLimites !== hojeAgora) {
        chipsEsgotadosHoje.clear();
        dataControleLimites = hojeAgora;
        console.log(`🌅 [NOVO DIA] Metas diárias zeradas. Chips acordados!`);
    }

    // 🚀 CONFIGURAÇÃO DE LIMITES POR CHIP
    const CONFIG_CHIPS = {
        "2ff1fd4d-c3a4-4b2f-977b-8472eb9c80f1": { limite: 25, nome: "Chip 48 (Novo)" },
        "a5e45805-abb4-4d76-a387-5a22b34c6bb4": { limite: 55, nome: "Chip Matriz (Aquecido)" }
    };

    // 2. Busca candidatos 'new' no banco (Sempre puxa 5)
    const { data: candidatos } = await supabase.from('leads').select('*').eq('status', 'new').limit(5);
    
    // 🛡️ TRAVA MESTRA: Se não tem lead novo ou se TODOS os chips bateram a meta, o motor dorme.
    if (!candidatos || candidatos.length === 0 || chipsEsgotadosHoje.size >= Object.keys(CONFIG_CHIPS).length) {
        if (chipsEsgotadosHoje.size > 0) {
            console.log(`🌙 [SISTEMA DORMINDO] Chips atuais bateram a meta ou fila vazia. Pausando por 30 minutos.`);
            return setTimeout(loopDisparos, 1800000); 
        }
        return setTimeout(loopDisparos, 40000); 
    }

    // 🌟 AQUI COMEÇA A FILA INDIANA (O SEGREDO ANTI-BAN COM RAIO-X)
    for (const l of candidatos) {
        console.log(`\n🔎 [RAIO-X] Analisando lead: ${l.name}`);
        
        if (leadsEmProcessamento.has(l.id)) {
            console.log(`⏩ [PULO] Lead já está na fila de processamento.`);
            continue;
        }
        
        // 🤫 FILTRO SILENCIOSO: Se o chip deste lead está na lista de esgotados, ignora o lead
        if (chipsEsgotadosHoje.has(l.instance_id)) {
            console.log(`⏩ [PULO] Chip dono desse lead já esgotou a cota hoje.`);
            continue;
        }

        const instancia = sessions.get(l.instance_id);
        if (!instancia) {
            console.log(`❌ [FALHA SILENCIOSA] A sessão ID ${l.instance_id} NÃO EXISTE na memória do Node. O Chip conectou?`);
            continue;
        }
        if (!instancia.ready) {
            console.log(`❌ [FALHA SILENCIOSA] A sessão existe, mas a flag 'ready' está FALSA. O WhatsApp não conectou direito.`);
            continue;
        }

        // 🛡️ VERIFICAÇÃO DE SAÚDE E LIMITE DIÁRIO
        const chipInfo = CONFIG_CHIPS[l.instance_id] || { limite: 20, nome: "Chip Padrão" };
        const enviosHoje = await db.getDailyContactCount(l.instance_id);

        if (enviosHoje >= chipInfo.limite) {
            console.log(`🛏️ [LIMITE ATINGIDO] ${chipInfo.nome} bateu a meta de ${chipInfo.limite} envios. Colocando chip para dormir.`);
            chipsEsgotadosHoje.add(l.instance_id);
            continue; 
        }

        // --- 🚀 CHECAGEM DE BLACKLIST ---
        const estaNaBlacklist = await db.isBlacklisted(l.whatsapp_id);
        if (estaNaBlacklist) {
            console.log(`🚫 [BLACKLIST] Lead ${l.name} restrito. Abortando...`);
            await supabase.from('leads').update({ status: 'blacklisted' }).eq('id', l.id);
            continue; 
        }

        // 3. Trava na Memória Viva
        leadsEmProcessamento.add(l.id);

        // 🕒 JITTER SEQUENCIAL (5s para teste)
        const jitter = Math.random() * 120000 + 120000;
        
        console.log(`🎯 [SDR] ${chipInfo.nome} na mira para: ${l.name} (${enviosHoje + 1}/${chipInfo.limite})`);
        console.log(`⏳ [ANTI-BAN] Fila Indiana: Aguardando ${Math.round(jitter/1000)}s antes de atirar...`);

        // 🛑 A MÁGICA ESTÁ AQUI: O robô realmente PARA e espera!
        await delay(jitter);

        try {
            // 4. Verificação de última hora
            const hist = await db.getHistory(l.whatsapp_id, l.instance_id);
            if (hist.length > 0) {
                console.log(`⚠️ [ABORTADO] ${l.name} já possui histórico. O SDR não manda saudação para quem já conversou! Pulando...`);
                await supabase.from('leads').update({ status: 'contact' }).eq('id', l.id);
                continue;
            }

            console.log(`🚀 [DISPARANDO] Enviando saudação para ${l.name}...`);
// 🔍 VALIDAÇÃO DE IDENTIDADE REAL (ANTI-VÁCUO)
            // 🔍 VALIDAÇÃO DE IDENTIDADE REAL (ANTI-VÁCUO)
            const [result] = await instancia.sock.onWhatsApp(l.whatsapp_id);
            if (!result || !result.exists) {
                console.log(`🚫 [NÚMERO INVÁLIDO] ${l.whatsapp_id} não existe. Pulando...`);
                await supabase.from('leads').update({ status: 'invalid' }).eq('id', l.id);
                continue;
            }

            // 👇 AS 4 LINHAS NOVAS QUE FALTAVAM 👇
            if (l.whatsapp_id !== result.jid) {
                console.log(`🔄 [AJUSTE DE ROTA] Corrigindo 9º dígito no banco: ${l.whatsapp_id} -> ${result.jid}`);
                await supabase.from('leads').update({ whatsapp_id: result.jid }).eq('id', l.id);
            }
            
            l.whatsapp_id = result.jid; // 🎯 Aqui a mágica acontece
            // 🚀 SIMULAÇÃO DE PRESENÇA HUMANA
            await instancia.sock.sendPresenceUpdate('composing', l.whatsapp_id);
            await delay(Math.random() * 4000 + 4000); 
            await instancia.sock.sendPresenceUpdate('paused', l.whatsapp_id);

            // 5. Saudação Direta (Otimizada para Taxa de Resposta)
            const primeiroNome = l.dono ? l.dono.split(' ')[0] : "Gestor";
            const bairro = l.bairro ? `aí no ${l.bairro}` : "aí na região";
            const nomeEmpresa = l.name ? l.name.replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim() : "vcs";
            
            // 🔥 VERSÃO SNIPER: Curta e Curiosa
            const saudacao = `Opa ${primeiroNome}, Marlon aqui! [QUEBRA] Vi que a ${nomeEmpresa} é ${bairro}. [QUEBRA] Vcs já ativaram o desconto de 15% na fatura de luz de vcs ou ainda pagam o valor total pra Celpe?`;
           
           
           
            // 6. O Fatiador de Balões (Para a primeira mensagem ir separada e humana)
            const mensagensSplit = saudacao.split('[QUEBRA]').map(t => t.trim()).filter(t => t.length > 0);
            
            for (let i = 0; i < mensagensSplit.length; i++) {
                const trecho = mensagensSplit[i];
                const tempoDigitacao = (trecho.length * 60) + 2500;
                
                await instancia.sock.sendPresenceUpdate('composing', l.whatsapp_id);
                await delay(Math.max(3000, Math.min(tempoDigitacao, 8000))); 
                
                await enviarMensagemIA(instancia.sock, l.whatsapp_id, { text: trecho });
                await db.saveMessage(l.whatsapp_id, 'assistant', trecho, l.instance_id);

                if (i < mensagensSplit.length - 1) {
                    await instancia.sock.sendPresenceUpdate('paused', l.whatsapp_id);
                    await delay(Math.random() * 2000 + 2000); 
                }
            }

            // 7. Atualização de Sucesso no Banco
            await supabase.from('leads').update({ 
                status: 'contact', 
                last_contact_at: new Date().toISOString() 
            }).eq('id', l.id);

            console.log(`✅ [SUCESSO REAL] Mensagem entregue por ${chipInfo.nome} para ${l.name}!`);

        } catch (err) {
            console.error(`❌ [FALHA] Envio falhou para ${l.name}.`, err.message);
        } finally {
            leadsEmProcessamento.delete(l.id);
        }
    } // <-- Fim do loop for...of
    
    // Só agenda a próxima rodada DEPOIS que a fila toda acabar
    setTimeout(loopDisparos, 30000); 
}

async function loopRecuperacaoConversas() {
    try {
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
                try {
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
                } catch (errLeadAtivo) {
                    console.error(`❌ [ERRO] Falha ao recuperar conversa ativa de ${l.name}:`, errLeadAtivo.message);
                    continue; // 🛡️ BLINDAGEM: Se der erro neste lead, pula pro próximo sem matar o loop!
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
                try {
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
                } catch (errLeadPausado) {
                    console.error(`❌ [ERRO] Falha ao destravar pausa de ${l.name}:`, errLeadPausado.message);
                    continue; // 🛡️ BLINDAGEM: Se der erro ao destravar um, pula pro próximo!
                }
            }
        }
    } catch (errGeral) {
        console.error("❌ [ERRO CRÍTICO] O motor de recuperação sofreu uma queda de rede/banco:", errGeral.message);
        // 🛡️ BLINDAGEM MÁXIMA: Engole o erro e permite que o setTimeout abaixo rode de qualquer jeito.
    } finally {
        // Roda a cada 5 minutos para não sobrecarregar o banco (GARANTIDO QUE VAI RODAR AGORA)
        setTimeout(loopRecuperacaoConversas, 1000 * 60 * 5);
    }
}

async function processarMensagemManual(sock, lead) {
    const remoteJid = lead.whatsapp_id;
    const instanceId = lead.instance_id;

    // 1. BUSCA O HISTÓRICO REAL
    const histRaw = await db.getHistory(remoteJid, instanceId);
    if (!histRaw || histRaw.length === 0) return;

    // 🛡️ TRAVA DE SEGURANÇA: Só responde se a ÚLTIMA mensagem no banco for do cliente ('user')
    const ultimaMsg = histRaw[histRaw.length - 1];
    if (ultimaMsg.role !== 'user') {
        console.log(`🛑 [SDR] Recuperação abortada para ${lead.name}: A última mensagem não foi do cliente.`);
        return;
    }

    console.log(`🧠 [IA] Gerando resposta de recuperação para ${lead.name}...`);
    const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
    const instanceData = await db.getInstanceRules(instanceId);
    
    // 3. Gera a resposta de "venda"
    const resposta = await gerarRespostaIA(historico, lead, instanceData);
    
    if (resposta) {
        // ========================================================================
        // 🛑 TRAVA DE TITÂNIO: ANTI-REPETIÇÃO DE ÁUDIO (O SEGURANÇA)
        // ========================================================================
        const memoriaHistorico = JSON.stringify(historico);
        
        if (resposta.includes('[AUDIO_COMO_FUNCIONA]') && memoriaHistorico.includes('<<Áudio Como Funciona Enviado>>')) {
            console.log("🛡️ [SDR-RECUPERAÇÃO] Bloqueando repetição do áudio 1...");
            resposta = resposta.replace('[AUDIO_COMO_FUNCIONA]', 'Como te expliquei no áudio ali em cima, a gente usa a energia das nossas usinas WEG pra injetar na sua rede e te dar o desconto direto. [QUEBRA] Ficou alguma dúvida sobre essa parte?');
        }
        if (resposta.includes('[AUDIO_SEGURANCA]') && memoriaHistorico.includes('<<Áudio Segurança Enviado>>')) {
            console.log("🛡️ [SDR-RECUPERAÇÃO] Bloqueando repetição do áudio 2...");
            resposta = resposta.replace('[AUDIO_SEGURANCA]', 'Conforme te falei no áudio agora há pouco, é super seguro. A concessionária continua cuidando de tudo e não tem fidelidade. [QUEBRA] Vc tem a conta fácil aí pra gente ver se a sua empresa aprova?');
        }
        if (resposta.includes('[AUDIO_OBRAS_PLACAS]') && memoriaHistorico.includes('<<Áudio Obras/Placas Enviado>>')) {
            console.log("🛡️ [SDR-RECUPERAÇÃO] Bloqueando repetição do áudio 3...");
            resposta = resposta.replace('[AUDIO_OBRAS_PLACAS]', 'Como comentei no áudio anterior, é zero obras rs. Não precisa de placa no telhado nem nada, é só a portabilidade digital mesmo. [QUEBRA] Consegue me mandar a foto da fatura pra gente simular?');
        }

        // ========================================================================
        // 🌟 INTERCEPTADOR DE ÁUDIO (ATUALIZADO COM OPUS)
        // ========================================================================
        if (resposta.includes('[AUDIO_COMO_FUNCIONA]') || resposta.includes('[AUDIO_SEGURANCA]') || resposta.includes('[AUDIO_OBRAS_PLACAS]')) {
            console.log("🎤 [SDR-RECUPERAÇÃO] Gatilho de áudio detectado. Iniciando gravação...");
            
            let audioFile = '';
            let memoriaTag = '';
            if (resposta.includes('[AUDIO_COMO_FUNCIONA]')) { audioFile = './assets/audio_como_funciona.ogg'; memoriaTag = '<<Áudio Como Funciona Enviado>>'; }
            else if (resposta.includes('[AUDIO_SEGURANCA]')) { audioFile = './assets/audio_seguranca.ogg'; memoriaTag = '<<Áudio Segurança Enviado>>'; }
            else if (resposta.includes('[AUDIO_OBRAS_PLACAS]')) { audioFile = './assets/audio_obras_placas.ogg'; memoriaTag = '<<Áudio Obras/Placas Enviado>>'; }

            await sock.sendPresenceUpdate('recording', remoteJid); 
            await delay(6000); // Fica 6 segundos simulando gravação
            
            if (fs.existsSync(audioFile)) {
                try {
                    console.log(`📤 [SDR-RECUPERAÇÃO] Lendo arquivo ${audioFile} e enviando para o WhatsApp...`);
                    const audioBuffer = fs.readFileSync(audioFile);
                    
                    await sock.sendMessage(remoteJid, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true 
                    });
                    
                    console.log("✅ [SDR-RECUPERAÇÃO] Áudio enviado com sucesso!");
                    await db.saveMessage(remoteJid, 'assistant', memoriaTag, instanceId);
                } catch (erroAudio) {
                    console.error("❌ [ERRO NO ENVIO DO ÁUDIO]:", erroAudio.message);
                    const disfarce = "Ia te mandar um áudio agora, mas a minha conexão falhou pra carregar o arquivo rs. Basicamente, é economia direta na fatura sem dor de cabeça ou obras. Consegue mandar a foto da conta?";
                    await enviarMensagemIA(sock, remoteJid, { text: disfarce });
                    await db.saveMessage(remoteJid, 'assistant', disfarce, instanceId);
                }
            } else {
                console.log("❌ [ERRO] Arquivo de áudio não encontrado na pasta assets.");
                const disfarce = "Ia te mandar um áudio agora explicando, mas meu microfone falhou aqui rs. Basicamente, é economia direta na fatura sem dor de cabeça ou obras. Consegue mandar a foto da conta?";
                await enviarMensagemIA(sock, remoteJid, { text: disfarce });
                await db.saveMessage(remoteJid, 'assistant', disfarce, instanceId);
            }
            return; // PARA AQUI! Assim ele não envia a tag como texto
        } 

        // ========================================================================
        // 🌟 SIMULADOR HUMANO DE DIGITAÇÃO FRAGMENTADA
        // ========================================================================
        const mensagensSplit = resposta.split('[QUEBRA]')
            .map(t => t.trim())
            .filter(t => t.length > 0)
            .slice(0, 3); // <-- A TRAVA DOS 3 BALÕES AQUI TAMBÉM
        
        for (let i = 0; i < mensagensSplit.length; i++) {
            const trecho = mensagensSplit[i];

            const tempoDigitacao = (trecho.length * 60) + 2500;
            await sock.sendPresenceUpdate('composing', remoteJid);
            await delay(Math.max(3000, Math.min(tempoDigitacao, 12000))); 
            
            await enviarMensagemIA(sock, remoteJid, { text: trecho });
            await db.saveMessage(remoteJid, 'assistant', trecho, instanceId);

            if (i < mensagensSplit.length - 1) {
                await sock.sendPresenceUpdate('paused', remoteJid);
                await delay(Math.random() * 2000 + 2500); 
            }
        }
        console.log(`✅ [SDR-RECUPERAÇÃO] Resposta de recuperação concluída para ${lead.name}`);
    }
}

module.exports = {
    initMultiTenancy: async (io) => {
        ioSocket = io;
        const insts = await db.getActiveInstances(); 
        for (const i of insts) { 
            await startInstance(i.id, i.name); 
            await delay(2000); 
        }
        
        // Motores religados e blindados!
        loopDisparos();             // Motor 1: Novos Leads (LIGADO E EM FILA INDIANA)
        loopRecuperacaoConversas(); // Motor 2: Conversas Pendentes (LIGADO E BLINDADO)
    },
    enviarMensagemSDR: async () => {}, 
    criarNovaInstancia: async (n, t) => {
        const { data } = await supabase.from('instances').insert([{ name: n, owner_phone: t }]).select().single(); 
        if (data) startInstance(data.id, data.name); 
        return data; 
    }
};