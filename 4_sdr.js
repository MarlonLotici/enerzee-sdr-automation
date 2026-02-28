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
    downloadMediaMessage, 
    generateMessageID 
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
// 🕒 SEGURANÇA: HORÁRIO COMERCIAL CORRIGIDO (05:30 - 22:45)
function dentroDoExpediente() {
    const agora = new Date();
    const tempoAtual = agora.getHours() * 60 + agora.getMinutes();
    
    // 05:30 = (5 * 60) + 30 = 330
    // 22:45 = (22 * 60) + 45 = 1365
    return tempoAtual >= 330 && tempoAtual <= 1365;
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

# 🛑 REGRA DE DESCARTE ABSOLUTA
Se o cliente disser que JÁ TEM USINA SOLAR, já usa placas no telhado ou já fez portabilidade com outra empresa:
1. NÃO tente contornar a objeção, NÃO tente vender e NÃO faça perguntas do SPIN.
2. Agradeça a atenção educadamente, parabenize pela iniciativa sustentável e encerre o assunto.
3. Exemplo de tom: "Ah, que maravilha que vcs já geram a própria energia! Parabéns pela iniciativa sustentável. Muito obrigado pela atenção e um excelente dia pra vcs! 👋"

# 🔄 REGRA DE REDIRECIONAMENTO (O "NINJA" DO FINANCEIRO)
Se a pessoa informar que é da recepção, reservas ou setor errado:
1. PARE o SPIN Selling imediatamente.
2. NUNCA peça desculpas ou diga "incomodar". Use um tom profissional e direto.
3. Foque no DEPARTAMENTO (Financeiro/Custos) e não no "Dono". Isso soa muito mais profissional.
4. Use este script base:
   - "Com certeza, Julio! Como o assunto é especificamente sobre a redução técnica na fatura de energia (conforme a Lei 14.300), o ideal é eu falar direto com o Financeiro ou com quem cuida da parte de Suprimentos/Custos. Vc consegue me passar o contato direto desse setor ou o e-mail para eu enviar o estudo de viabilidade?"
5. Se insistirem para você ligar no fixo ou site, tente uma última vez:
   - "Entendi. É que por aqui consigo enviar o gráfico de economia pronto para análise. Não teria um WhatsApp de apoio do financeiro ou da gerência?"
6. Se a resposta for negativa novamente, encerre com: "Perfeito, vou buscar por lá então. Obrigado pela orientação!"

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
3. Mude a rota para a reunião: "Tudo bem! Pra facilitar, a gente pode fazer uma chamada de vídeo de uns 20 min. Vc leva a fatura lá e eu simulo ao vivo na tela pra vc ver a economia. O que acha?"
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

# 💎 REGRAS REGIONAIS (PARA 25% DE DESCONTO)
- A âncora principal de venda é SEMPRE: "Até 25% de desconto na fatura".
- REGRA DE OURO: NUNCA explique a divisão dos meses a menos que o cliente pergunte "como funciona esse desconto?" ou "por que *até*?".
- SE ELE PERGUNTAR, explique de forma leve: "A gente dá um super bônus de 25% de desconto nos dois primeiros meses pra vc sentir a diferença logo de cara! Depois, fica um desconto fixo de 15% pra sempre."

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
    
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const c of contacts) {
            if (c.id && c.lid) {
                const cleanId = c.id.split(':')[0] + '@s.whatsapp.net';
                const cleanLid = c.lid.split(':')[0] + '@lid';
                await supabase.from('leads').update({ whatsapp_lid: cleanLid }).eq('whatsapp_id', cleanId);
            }
        }
    });

    sock.ev.on('contacts.update', async (contacts) => {
        for (const c of contacts) {
            if (c.id && c.lid) {
                const cleanId = c.id.split(':')[0] + '@s.whatsapp.net';
                const cleanLid = c.lid.split(':')[0] + '@lid';
                await supabase.from('leads').update({ whatsapp_lid: cleanLid }).eq('whatsapp_id', cleanId);
            }
        }
    });
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
// 🛡️ PASSO 1: O "CARIMBO" E RASTREIO DIGITAL DO ROBÔ (NATIVO E SEGURO)
// ============================================================================
async function enviarMensagemIA(sock, jid, content) {
    try {
        // 1. Deixa o próprio Baileys criar e enviar a mensagem (Garante a entrega no Ataque)
        const sentMsg = await sock.sendMessage(jid, content);
        
        // 2. Pega o ID oficial gerado e carimba na memória viva
        if (sentMsg?.key?.id) {
            mensagensEnviadasPelaIA.add(sentMsg.key.id); 
            mapaRastreioLID.set(sentMsg.key.id, jid); // 🔗 O Fio de Ariadne está a salvo aqui!
            
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
// 🌟 TÓPICO 1: FILTRO ANTI-FANTASMA E TRADUTOR DE LID (VIA BANCO DE DADOS)
// ========================================================================
// 1. Busca normal pelo JID
let { data: lead } = await supabase.from('leads').select('*').eq('whatsapp_id', cleanJid).single();

// 2. Se for um fantasma (@lid), pergunta ao banco quem ele é!
if (!lead && cleanJid.includes('@lid')) {
    console.log(`⚠️ [LID SOLTO] Mensagem de ${cleanJid}. Buscando no banco de dados...`);
    const { data: leadLid } = await supabase.from('leads').select('*').eq('whatsapp_lid', cleanJid).single();
    
    if (leadLid) {
        console.log(`✅ [ARIADNE INFALÍVEL] O banco dedurou: É a ${leadLid.name}`);
        lead = leadLid;
    
    } else {
        // 🚨 TENTATIVA DE RESGATE DE EMERGÊNCIA (O XEQUE-MATE) 🚨
        // 👇 AQUI ESTÁ A MÁGICA: Ele vai olhar no remoteJidAlt que descobrimos!
        const realJidRescue = msg.key.remoteJidAlt || msg.key.participant || msg.message?.extendedTextMessage?.contextInfo?.participant;
        const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

        let originalLead = null;

        // 🥷 RESGATE NINJA 1: Ele citou a nossa mensagem? 
        if (quotedMsgId && mapaRastreioLID.has(quotedMsgId)) {
            const memoryJid = mapaRastreioLID.get(quotedMsgId);
            console.log(`🥷 [RESGATE NINJA 1] Lead descoberto através da mensagem citada!`);
            const { data } = await supabase.from('leads').select('*').eq('whatsapp_id', memoryJid).single();
            originalLead = data;
        }

        // 🥷 RESGATE NINJA 2: O WhatsApp mandou o número oculto no remoteJidAlt?
        if (!originalLead && realJidRescue) {
            const cleanRescue = realJidRescue.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            console.log(`🥷 [RESGATE NINJA 2] Analisando bolso secreto da Meta: ${cleanRescue}`);
            const { data } = await supabase.from('leads').select('*').eq('whatsapp_id', cleanRescue).single();
            originalLead = data;
        }

        // Conclusão do Resgate
        if (originalLead) {
            console.log(`✅ [RESGATE BEM-SUCEDIDO] Identidade revelada: ${originalLead.name}. Salvando LID no banco!`);
            await supabase.from('leads').update({ whatsapp_lid: cleanJid }).eq('id', originalLead.id);
            lead = originalLead;
        } else {
            console.log(`❌ [BLINDAGEM TOTAL] WhatsApp ocultou completamente o número. Abortando.`);
            return;
        }
    }
} else if (!lead) {
    return; // Fora da base, ignora.
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
        // ⏳ ANTI-RACE CONDITION: Aumentado para 3s para garantir 100% de leitura do ID.
        await new Promise(resolve => setTimeout(resolve, 3000)); 
        
        // 🛡️ Verifica se foi o robô que enviou
        if (msg.key.id && mensagensEnviadasPelaIA.has(msg.key.id)) {
            return; // Ufa! Foi a IA, ignora e deixa o jogo seguir.
        }

        if (!texto) return;
        console.log(`👤 [HUMANO] Você enviou uma mensagem para o lead. Pausando IA.`);
        try {
            await db.saveMessage(lead.whatsapp_id, 'assistant', texto, instanceId);
            await supabase.from('leads').update({ 
                is_paused: true, 
                last_human_interaction: new Date().toISOString() 
            }).eq('id', lead.id); 
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
                // 🔥 NOVO CALCULO: Mais lento (80ms por letra + 4seg de base)
                const tempoDigitacao = (trecho.length * 80) + 4000; 
                
                await sock.sendPresenceUpdate('composing', remoteJid);
                // 🔥 NOVO LIMITE: Mínimo de 5 segundos digitando, máximo de 14s
                await delay(Math.max(5000, Math.min(tempoDigitacao, 14000))); 
                
                await enviarMensagemIA(sock, remoteJid, { text: trecho });
                await db.saveMessage(lead.whatsapp_id, 'assistant', trecho, instanceId); 

                if (i < mensagensSplit.length - 1) {
                    await sock.sendPresenceUpdate('paused', remoteJid);
                    // 🔥 NOVO RESPIRO: Pausa de 3.5 a 6.5 segundos entre um balão e outro
                    await delay(Math.random() * 3000 + 3500); 
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

// ============================================================================
// 🔄 MOTOR DE ATAQUE INDEPENDENTE (PARALELISMO POR CHIP)
// ============================================================================
const chipsEsgotadosHoje = new Set();
let dataControleLimites = new Date().toISOString().split('T')[0];

async function motorAtaquePorChip(instanceId) {
    // ⏰ DESPERTADOR: Limpa o cache de chips esgotados se virou o dia
    const hojeAgora = new Date().toISOString().split('T')[0];
    if (dataControleLimites !== hojeAgora) {
        chipsEsgotadosHoje.clear();
        dataControleLimites = hojeAgora;
        console.log(`🌅 [NOVO DIA] Metas diárias zeradas. Chips acordados!`);
    }

    // 🚀 CONFIGURAÇÃO DE LIMITES POR CHIP
    const CONFIG_CHIPS = {
        "2ff1fd4d-c3a4-4b2f-977b-8472eb9c80f1": { limite: 55, nome: "Chip 48 (respondendo)" },
        "74905749-7b50-4b13-92e8-b12663c1d67d": { limite: 55, nome: "Chip 46 (modo ataque)" }
    };

    const config = CONFIG_CHIPS[instanceId] || { limite: 20, nome: `Chip-${instanceId.substring(0, 4)}` };
    console.log(`🚀 [MOTOR] Iniciando turbina de ataque independente para: ${config.nome}`);

    // Loop Infinito exclusivo deste chip
    while (true) {
        let currentLeadId = null; 

        try {
            // 1. Trava de Horário (Segurança Anti-Ban)
            if (!dentroDoExpediente()) {
                await delay(60000 * 5); 
                continue;
            }

            // 2. Busca 1 lead 'new' que pertença EXCLUSIVAMENTE a este chip
            const { data: lead, error } = await supabase
                .from('leads')
                .select('*')
                .eq('status', 'new')
                .eq('instance_id', instanceId)
                .order('created_at', { ascending: true }) 
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            if (!lead) {
                await delay(30000); 
                continue;
            }

            currentLeadId = lead.id;

            // 3. Trava de Processamento Duplo
            if (leadsEmProcessamento.has(lead.id)) { 
                await delay(5000); 
                continue; 
            }

            // 4. Checa Limite Diário do Chip
            const enviosHoje = await db.getDailyContactCount(instanceId);
            if (enviosHoje >= config.limite) {
                console.log(`🌙 [METAS] ${config.nome} atingiu o limite de ${config.limite} disparos hoje. Dormindo por 30 minutos.`);
                await delay(1800000); // 30 minutos
                continue;
            }

            // 5. Checagem de Blacklist 
            const estaNaBlacklist = await db.isBlacklisted(lead.whatsapp_id);
            if (estaNaBlacklist) {
                console.log(`🚫 [BLACKLIST] Lead ${lead.name} restrito. Abortando...`);
                await supabase.from('leads').update({ status: 'blacklisted' }).eq('id', lead.id);
                continue; 
            }

            // Bloqueia o lead na memória viva
            leadsEmProcessamento.add(lead.id);

            // 6. Jitter Sequencial (Espera Humana entre 2 e 4 minutos)
            const jitter = Math.random() * 120000 + 120000;
            console.log(`🎯 [${config.nome}] Mirando em: ${lead.name} (${enviosHoje + 1}/${config.limite}). Aguardando ${Math.round(jitter/1000)}s...`);
            await delay(jitter);

            // 7. Verificação de Saúde da Conexão
            const instancia = sessions.get(instanceId);
            if (!instancia || !instancia.ready) {
                console.log(`❌ [FALHA SILENCIOSA] ${config.nome} não está com o canal pronto. Reagendando lead...`);
                leadsEmProcessamento.delete(lead.id);
                await delay(10000);
                continue;
            }

            // 8. Verificação de Histórico
            const hist = await db.getHistory(lead.whatsapp_id, instanceId);
            if (hist && hist.length > 0) {
                console.log(`⚠️ [ABORTADO] ${lead.name} já possui histórico. O SDR não manda saudação dupla! Pulando...`);
                await supabase.from('leads').update({ status: 'contact' }).eq('id', lead.id);
                leadsEmProcessamento.delete(lead.id);
                continue;
            }

            // 9. Validação de Identidade (Anti-Vácuo)
            const [result] = await instancia.sock.onWhatsApp(lead.whatsapp_id);
            
            if (!result || !result.exists) {
                console.log(`🚫 [NÚMERO INVÁLIDO] ${lead.name} não tem WhatsApp. Pulando...`);
                await supabase.from('leads').update({ status: 'invalid' }).eq('id', lead.id);
                leadsEmProcessamento.delete(lead.id);
                continue;
            }

            // 10. Limpeza Profunda de LID e JID
            let cleanLid = null;
            if (result.lid) {
                cleanLid = result.lid.split(':')[0].split('@')[0] + '@lid';
                await supabase.from('leads').update({ whatsapp_lid: cleanLid }).eq('id', lead.id);
            }

            const cleanJid = result.jid.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            if (lead.whatsapp_id !== cleanJid) {
                console.log(`🔄 [AJUSTE DE ROTA] Corrigindo 9º dígito: ${lead.whatsapp_id} -> ${cleanJid}`);
                await supabase.from('leads').update({ whatsapp_id: cleanJid }).eq('id', lead.id);
                lead.whatsapp_id = cleanJid;
            }

            // PLANO B: Se o onWhatsApp falhou em trazer o LID
            if (result.exists && !cleanLid) {
                try {
                    const [contact] = await instancia.sock.getContact(cleanJid);
                    if (contact && contact.lid) {
                        cleanLid = contact.lid.split(':')[0].split('@')[0] + '@lid';
                        await supabase.from('leads').update({ whatsapp_lid: cleanLid }).eq('id', lead.id);
                    }
                } catch (e) { /* Ignora se falhar */ }
            }

            // 11. Saudação Dinâmica e Humanizada (Ajustada)
            console.log(`🚀 [DISPARANDO] ${config.nome} enviando saudação para ${lead.name}...`);
            
            // Simulação de presença antes do envio
            await instancia.sock.sendPresenceUpdate('composing', cleanJid);
            await delay(Math.random() * 4000 + 4000); 
            await instancia.sock.sendPresenceUpdate('paused', cleanJid);

            // Montagem da Saudação
            const saudacaoInicial = lead.dono ? `Opa ${lead.dono.split(' ')[0]}` : "Opa, falo com o proprietário";
            const bairro = lead.bairro ? `aí no ${lead.bairro}` : "aí na região";
            const nomeEmpresa = lead.name ? lead.name.replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim() : "vcs";
            
            const saudacao = `${saudacaoInicial}, tudo bem? Marlon aqui! [QUEBRA] Vi que a ${nomeEmpresa} é ${bairro}. [QUEBRA] Vcs já ativaram o desconto de até 25% na fatura de luz de vcs ou ainda pagam o valor total pra Celpe?`;

            // 12. Fatiador de Balões com Simulação Humana
            const mensagensSplit = saudacao.split('[QUEBRA]').map(t => t.trim()).filter(t => t.length > 0);
            
            for (let i = 0; i < mensagensSplit.length; i++) {
                const trecho = mensagensSplit[i];
                const tempoDigitacao = (trecho.length * 80) + 4000; 
                
                await instancia.sock.sendPresenceUpdate('composing', cleanJid);
                await delay(Math.max(5000, Math.min(tempoDigitacao, 14000))); 
                
                await enviarMensagemIA(instancia.sock, cleanJid, { text: trecho });
                await db.saveMessage(cleanJid, 'assistant', trecho, instanceId);

                if (i < mensagensSplit.length - 1) {
                    await instancia.sock.sendPresenceUpdate('paused', cleanJid);
                    await delay(Math.random() * 3000 + 3500); 
                }
            }

            // 13. Conclusão de Sucesso
            await supabase.from('leads').update({ 
                status: 'contact', 
                last_contact_at: new Date().toISOString() 
            }).eq('id', lead.id);

            console.log(`✅ [SUCESSO REAL] Mensagem entregue por ${config.nome} para ${lead.name}!`);

            // Libera o lead da memória
            leadsEmProcessamento.delete(lead.id);

        } catch (err) {
            console.error(`❌ Erro no motor do chip ${instanceId}:`, err.message);
            if (currentLeadId) leadsEmProcessamento.delete(currentLeadId); 
            await delay(10000); 
        }
    }
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

            // 🔥 NOVO CALCULO
            const tempoDigitacao = (trecho.length * 80) + 4000; 
            await sock.sendPresenceUpdate('composing', remoteJid);
            // 🔥 NOVO LIMITE
            await delay(Math.max(5000, Math.min(tempoDigitacao, 14000))); 
            
            await enviarMensagemIA(sock, remoteJid, { text: trecho });
            await db.saveMessage(remoteJid, 'assistant', trecho, instanceId);

            if (i < mensagensSplit.length - 1) {
                await sock.sendPresenceUpdate('paused', remoteJid);
                // 🔥 NOVO RESPIRO
                await delay(Math.random() * 3000 + 3500); 
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
            await delay(3000); 
            
            // 🚀 LIGA A TURBINA INDEPENDENTE PARA ESTE CHIP!
            motorAtaquePorChip(i.id); 
        }
        
        // Motor 2: Conversas Pendentes (Mantém como estava)
        loopRecuperacaoConversas(); 
    },
    enviarMensagemSDR: async () => {}, 
    criarNovaInstancia: async (n, t) => {
        const { data } = await supabase.from('instances').insert([{ name: n, owner_phone: t }]).select().single(); 
        if (data) startInstance(data.id, data.name); 
        return data; 
    }
};