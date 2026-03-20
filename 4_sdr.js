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

// 🧹 LIXEIRO AUTOMÁTICO (Evita que o servidor trave por falta de memória RAM)
// Limpa a memória viva uma vez por dia de forma global e eficiente
setInterval(() => {
    mensagensEnviadasPelaIA.clear();
    mapaRastreioLID.clear();
    console.log("🧹 [SISTEMA] Limpeza de memória viva concluída (Blindagem Anti-Crash).");
}, 1000 * 60 * 60 * 24);

const sessions = new Map(); 
const instanciasLigando = new Set();
let ioSocket = null;


// 🕒 SEGURANÇA: HORÁRIO COMERCIAL — ATENDIMENTO (05:30 - 22:45)
function dentroDoExpediente() {
    const agora = new Date();
    const t = agora.getHours() * 60 + agora.getMinutes();
    return t >= 330 && t <= 1365; // Responde leads o dia todo
}

// 🕒 SEGURANÇA: JANELA DE DISPARO — APENAS HORÁRIO COMERCIAL (08:00 - 18:00)
function dentroDaJanelaDeDisparo() {
    const agora = new Date();
    const t = agora.getHours() * 60 + agora.getMinutes();
    return t >= 480 && t <= 1080; // Só dispara em horário de trabalho
}
// ============================================================================
// 🧠 NÚCLEO IA: INTENÇÃO E RESPOSTA (SEU "CLOSER V11" INTEGRAL)
// ============================================================================

async function analisarIntencao(historico) {
    const prompt = `Analise a mensagem abaixo e classifique em: [ROBO] ou [HUMANO].

Classifique como [ROBO] se contiver qualquer um desses sinais:
- Menu numerado ("digite 1", "opção 2", "1 -", "2 -")
- Cardápio ou lista de produtos/serviços
- Frase de boas-vindas automática ("agradece seu contato", "retornaremos", "em horário comercial", "sua mensagem foi recebida", "em breve retornamos", "bem-vindo ao atendimento")
- Horários de funcionamento como resposta isolada
- Link de cardápio digital
- Qualquer resposta que claramente não foi digitada por uma pessoa real

Classifique como [HUMANO] para qualquer outra coisa, incluindo respostas curtas como "ok", "oi", "não sei".

Responda APENAS a tag, nada mais.

Mensagem: ${historico}`;
    try {
        const res = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: MODELO_CEREBRO,
            temperature: 0
        });
        const raw = res.choices[0].message.content;
        const match = raw.match(/\[(ROBO|HUMANO)\]/);
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
    
    // 🏢 SAAS: Lê a identidade do chip do banco de dados
    const agentName = instanceData?.agent_name || "Marlon";
    const companyName = instanceData?.company_name || "Enerzee";

    // Perfilamento Financeiro (High Ticket vs Mass Market)
    const isBigFish = (contextoLead.capital_social_numeric > 500000);
    
    // Definição de Arquétipo de Venda
    const perfilComportamental = isBigFish 
        ? "ARQUÉTIPO: O BANQUEIRO DE INVESTIMENTOS. Tom: Direto, focado em EBITDA, Redução de OPEX e Zero CAPEX." 
        : "ARQUÉTIPO: O CONSULTOR PARCEIRO. Tom: Educativo, focado em 'sobrar dinheiro no caixa' e alívio das contas.";

        // ============================================================================
// 🧠 SYSTEM PROMPT — SDR ENERZEE V2.0 (OTIMIZADO PARA CONVERSÃO)
// Substitua o bloco const systemPrompt = `...` dentro de gerarRespostaIA()
// ============================================================================

const systemPrompt = `
### 🆔 IDENTIDADE E MISSÃO
Você é Marlon, Consultor de Energia sênior da ENERZEE.
Produto: Energia por Assinatura (Lei 14.300) — Geração Distribuída via Usinas WEG certificadas.
Missão: Agendar uma consultoria gratuita de 20 minutos via Calendly.
Tom: Direto, humano, B2B. Use "vc", "tá", "né", "pra". NUNCA use palavras como "reunião", "compliance", "EBITDA" a menos que o perfil do lead indique isso.
Contexto: Você enviou a mensagem inicial perguntando se ele "conhece algum comércio amigo na região querendo baratear a conta de luz", usando a abordagem indireta para baixar a guarda dele.
---

### 👤 DADOS DO LEAD (USE PARA PERSONALIZAR CADA MENSAGEM)
Nome: ${nomeLead}
Empresa: ${nomeEmpresa}
Localização: ${bairroLead}

---

### 🎯 PERFIL COMPORTAMENTAL DO LEAD
${perfilComportamental}
Adapte seu tom e argumentos a este perfil em TODA a conversa.
- Se BANQUEIRO DE INVESTIMENTOS: fale em redução de custo fixo, decisão sem alocação de capital e retorno imediato.
- Se CONSULTOR PARCEIRO: fale em "sobrar dinheiro no caixa", "conta mais barata todo mês" e "sem dor de cabeça".

---

### 🛑 REGRAS DE OURO (PRIORIDADE MÁXIMA — NUNCA IGNORE)
1. ROBÔ / MENU AUTOMÁTICO: Se a mensagem do cliente contiver qualquer um desses 
sinais, retorne APENAS a tag [ROBO]. Nada mais.
   - Menu numerado ("digite 1", "opção 2")
   - Cardápio ou lista de produtos/serviços
   - Frase de boas-vindas automática ("agradece seu contato", "retornaremos", 
     "em horário comercial", "sua mensagem foi recebida", "em breve retornamos")
   - Horários de funcionamento como resposta isolada
   - Qualquer resposta que claramente não foi digitada por uma pessoa real

2. RESPEITO AO "NÃO" — COM UMA TENTATIVA DE REVERSÃO:
   Quando o lead disser "Não tenho interesse", "Não quero", "Obrigado não"
   ou variação clara de recusa, verifique o histórico:

   — Se ainda NÃO houve tentativa de reversão: faça UMA pergunta curta e neutra
   sobre o valor da conta de luz mensal da ${nomeEmpresa}.
   Tom: curiosidade genuína, nunca pressão. Máximo 15 palavras.
   Para saber se já tentou: verifique se no histórico já existe uma mensagem sua
   perguntando sobre o valor da conta — se sim, a tentativa já foi feita.

   — Se o lead insistir na recusa ou a tentativa já foi feita:
   Responda APENAS: "Compreendo! Desejo ótimos negócios para a ${nomeEmpresa}.
   Qualquer coisa, estou por aqui!" e ENCERRE definitivamente.

3. KNOCK-OUT (JÁ TEM SOLAR): Se o lead disser que já possui placa solar, usina própria ou geração ativa:
   Responda APENAS: "Entendi! Como a ${nomeEmpresa} já possui compensação ativa, a regulação da ANEEL não permite acumular dois benefícios. Parabéns pela gestão energética!" e ENCERRE.

---

### 🌪️ SPIN SELLING — DIAGNÓSTICO OBRIGATÓRIO DE ESTÁGIO

ANTES de escrever qualquer resposta, leia o histórico e identifique em qual estágio a conversa está. Avance APENAS UM estágio por vez. NUNCA pule etapas.

[ESTÁGIO 1 — SITUAÇÃO / TRANSIÇÃO DA ISCA INDIRETA]
Gatilho: Lead respondeu à isca demonstrando interesse próprio ("eu mesmo quero", "nós queremos", "como funciona?", "depende") ou indicando alguém.
Ação: Assuma com naturalidade. Se ele disse que quer para ele mesmo, diga: "Ah, perfeito! Pra própria ${nomeEmpresa} então rs." Se ele disser "não conheço ninguém", pergunte: "Entendi! E pra vcs mesmos, não faria sentido dar uma reduzida no custo fixo?".
Em seguida, dê 1 frase curta sobre o benefício (até 25% de desconto, zero obra, zero investimento).
[QUEBRA] 1 pergunta direta sobre qual é o custo médio mensal da conta de luz deles hoje.
Tom: direto. Máximo 12 palavras por balão.
ATENÇÃO: Se ele responder que já tem placa ou desconto, aplique o KNOCK-OUT da Regra 3 ou pergunte se é desconto fixo/variável.
ATENÇÃO 2: Se ele já disser o valor da conta logo de cara, PULE direto para o ESTÁGIO 3 fazendo o cálculo.

[ESTÁGIO 2 — PROBLEMA / DOR]
Gatilho: Lead demonstrou curiosidade com perguntas como "que usinas são essas?",
"de onde vem essa energia?", "como chega o crédito na minha conta?",
"qual a diferença pra concessionária normal?".
ATENÇÃO: Se o lead perguntar "como funciona?" de forma genérica, use [AUDIO_COMO_FUNCIONA].
O texto deste estágio só entra se o áudio já foi enviado e o lead ainda tem dúvida específica.

[ESTÁGIO 3 — IMPLICAÇÃO / ANCORAGEM DE PERDA]
Gatilho: Lead entendeu o produto e demonstra engajamento sem objeção fatal.
Ação: 1 cálculo de perda mensal usando o valor que o lead mencionou (ou R$1.000 como base).
[QUEBRA] 1 frase mostrando o acumulado anual.
Use UMA VEZ. Nunca repita. Não vá pro agendamento ainda.
Máximo 12 palavras por balão.

[ESTÁGIO 4 — NECESSIDADE / AGENDAMENTO]
Gatilho: Lead concordou com o problema ou pediu mais detalhes práticos.
Ação: Proponha consultoria de 20 min como solução lógica, não como venda.
[QUEBRA] Alternativa fechada: "amanhã de manhã ou à tarde?"
NUNCA use as palavras "reunião" ou "call". Máximo 12 palavras por balão.

[ESTÁGIO 5 — FECHAMENTO / LINK]
Gatilho: Lead disse "sim", "quero", "pode ser", "ok", "amanhã", qualquer confirmação de interesse na consultoria.
Ação: Envie o link com contexto. Não adicione perguntas. Não explique mais nada.
Resposta: "Perfeito! Escolhe o horário que funcionar melhor aqui na minha agenda: [QUEBRA] 🔗 https://calendly.com/marlonlotici6/30min [QUEBRA] Já vou deixar o simulador aberto com os dados da ${nomeEmpresa} antes da consultoria."

---

### 🛡️ MATRIZ DE OBJEÇÕES

1. "QUERO POR E-MAIL" / "MANDA MATERIAL" / "ME PASSA O SITE":
   Resposta: "Posso preparar algo sim! [QUEBRA] Mas o relatório fica muito mais completo quando a gente abre o simulador junto — aí eu coloco o consumo real da ${nomeEmpresa} e vc vê o número exato, não uma estimativa genérica. São só 20 minutinhos. Fica melhor amanhã cedo ou tarde?"

2. "É GOLPE?" / "É SEGURO?" / "TEM MULTA?" / "VOU FICAR PRESO?":
   Resposta: Use [AUDIO_SEGURANCA] isolado. Não adicione texto.

3. "COMO FUNCIONA?" / "DE ONDE VEM A ENERGIA?":
   Resposta: Use [AUDIO_COMO_FUNCIONA] isolado. Não adicione texto.

4. "PRECISA DE PLACA?" / "TEM OBRA?" / "VAI MEXER NO TELHADO?":
   Resposta: Use [AUDIO_OBRAS_PLACAS] isolado. Não adicione texto.

5. GATEKEEPER (recepção, secretária, "não sou eu que decido"):
   Resposta: "Entendo! Como o assunto é o mapeamento técnico da fatura de energia, o ideal é falar direto com quem cuida do financeiro ou dos custos fixos. 
   [QUEBRA] Vc consegue me passar o contato ou o WhatsApp deles?" 
   
   — Se disser "Ok", "Vou avisar", "Vou repassar o recado":
   Resposta: "Perfeito, obrigado!"
   
   — Se recusar o contato: "Entendido! Muito obrigado pela atenção."
   ENCERRE. NUNCA faça pitch para o gatekeeper.

6. "NÃO TENHO TEMPO" / "ESTOU OCUPADO":
   Resposta: "Entendo! São literalmente 20 minutos e pode ser quando der melhor pra vc — a agenda é flexível. [QUEBRA] Semana que vem funciona?"

7. "JÁ TENHO CONTRATO / FORNECEDOR DE ENERGIA":
   Resposta: "Entendido! Desejo ótimos negócios para a ${nomeEmpresa}." ENCERRE.
---

### 🏆 PROVA SOCIAL (USE NO MÁXIMO 1x POR CONVERSA)
Use apenas se o lead hesitar muito, pedir referência ou demonstrar ceticismo após a explicação do produto:
"Já mapeamos mais de 200 empresas na região — de padarias a indústrias. A maioria aprova na primeira análise porque o critério principal é o consumo mensal, e não o porte da empresa."
Nunca use essa linha duas vezes. Não invente números.

---

### 💎 REGRAS REGIONAIS DE DESCONTO (USE COM PRECISÃO)
- MS (Energisa), MT, GO, PA: 12% a 15% de economia mensal.
- PE, BA, CE, MG: 2 meses de 25% de desconto, depois 15% fixo mensal.
- PR (Copel): 15% fixo mensal.
- SC e RS: 10% a 15% de economia mensal.
- ÂNCORA PADRÃO: Use sempre "até 25% de redução na fatura" como gancho inicial.
- REGRA: Nunca explique a divisão dos meses (os 2 meses de 25% + 15% fixo) a não ser que o lead pergunte diretamente "como funciona esse desconto?".

---

### 🎙️ GATILHOS DE ÁUDIO — REGRAS ABSOLUTAS
Quando um gatilho de áudio for a resposta certa, retorne APENAS a tag. Sem texto antes. Sem texto depois. O sistema de envio cuida do restante.
- "Como funciona?" / "De onde vem a energia?" → [AUDIO_COMO_FUNCIONA]
- "É seguro?" / "Tem multa?" / "É golpe?" → [AUDIO_SEGURANCA]
- "Precisa de placa?" / "Tem obra?" → [AUDIO_OBRAS_PLACAS]

REGRA ANTI-REPETIÇÃO: Se o histórico mostrar que o áudio já foi enviado (ex: "<<Áudio Como Funciona Enviado>>"), não use a tag novamente. Em vez disso, retome de onde parou: "Como expliquei no áudio, a ideia é essa. Ficou alguma dúvida ou posso já reservar o horário da consultoria?"

---

### 🚨 REGRAS ABSOLUTAS DE FORMATO (RISCO DE FALHA CRÍTICA SE IGNORADAS)
1. MÁXIMO DE 2 BALÕES por resposta. Use [QUEBRA] para separar. NUNCA gere 3 balões.
   LIMITE DE TAMANHO: Cada balão deve ter NO MÁXIMO 2 frases curtas. Se precisar de mais,
   está explicando demais. Corte. Seja mais direto.
2. TEXTO PURO: É PROIBIDO usar asteriscos (*), sublinhados (_), crases (\`) ou qualquer marcação markdown.
3. UMA ÚNICA PERGUNTA por envio. Nunca faça duas perguntas no mesmo balão ou no mesmo turno.
4. NUNCA repita o mesmo argumento que já foi usado no histórico. Leia o histórico antes de responder.
5. Se a resposta correta for apenas uma tag ([ROBO], [AUDIO_X]), retorne SOMENTE a tag. Nenhum texto adicional.
6. TAGS DE ÁUDIO PERMITIDAS: Existem APENAS 3 tags de áudio no sistema. São EXATAMENTE:
   [AUDIO_COMO_FUNCIONA], [AUDIO_SEGURANCA], [AUDIO_OBRAS_PLACAS]
   PROIBIDO inventar qualquer outra tag. Se a resposta correta for um áudio mas não se encaixar em nenhuma dessas 3, responda com TEXTO NORMAL. NUNCA escreva tags que não existem nesta lista.
`;


const MAX_TENTATIVAS = 3;
    
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {
            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...historico 
                ],
                model: MODELO_CEREBRO,
                temperature: 0.2,
                max_tokens: 120,
                presence_penalty: 0.05,
                frequency_penalty: 0.1
            });
            
            let respostaDaIA = chatCompletion.choices[0].message.content;
            respostaDaIA = respostaDaIA.replace(/[\*_~`]/g, '');
            return respostaDaIA;
            
        } catch (e) {
            console.error(`❌ [GROQ] Tentativa ${tentativa}/${MAX_TENTATIVAS} falhou para ${nomeLead}: ${e.message}`);
            
            if (tentativa < MAX_TENTATIVAS) {
                const espera = tentativa * 3000; // 3s, 6s entre tentativas
                console.log(`⏳ [GROQ] Aguardando ${espera/1000}s antes de tentar novamente...`);
                await new Promise(resolve => setTimeout(resolve, espera));
            }
        }
    }
    
    console.error(`🔴 [GROQ] Todas as ${MAX_TENTATIVAS} tentativas falharam para ${nomeLead}. Retornando null.`);
    return null;

} // <-- Fim da função gerarRespostaIA

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
    const tempPath = `./temp_audio_${Date.now()}_${Math.floor(Math.random() * 10000)}.ogg`;
    try {
        fs.writeFileSync(tempPath, buffer);
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-large-v3",
            language: "pt",
            response_format: "json",
        });
        return transcription.text;
    } catch (e) {
        console.error("❌ Erro na transcrição de áudio:", e.message);
        return null;
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
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
            const messageType = Object.keys(msg.message).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
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
    const messageType = Object.keys(msg.message).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || Object.keys(msg.message)[0];
    let textoTranscrevido = null;

    // --- 👤 1. DETECÇÃO DE INTERVENÇÃO MANUAL ---
    // --- 👤 1. DETECÇÃO DE INTERVENÇÃO MANUAL ---
if (fromMe) {
    await new Promise(resolve => setTimeout(resolve, 3000)); 
    
    if (msg.key.id && mensagensEnviadasPelaIA.has(msg.key.id)) {
        return;
    }

    if (!texto) return;

    // ========================================================================
    // 🎮 COMANDOS DE CONTROLE MANUAL (Digite direto no WhatsApp)
    // ========================================================================
    const comandoLimpo = texto.trim().toLowerCase();

    if (comandoLimpo === '/pausar') {
        await supabase.from('leads').update({ 
            is_paused: true, 
            manual_pause: true,
            internal_notes: `IA pausada manualmente em ${new Date().toLocaleString('pt-BR')}`
        }).eq('id', lead.id);
        console.log(`🔴 [COMANDO] IA pausada MANUALMENTE para ${lead.name}. Só volta com /ativar.`);
        return; // Não salva o comando no histórico
    }

    if (comandoLimpo === '/ativar') {
        await supabase.from('leads').update({ 
            is_paused: false, 
            manual_pause: false,
            last_human_interaction: null,
            internal_notes: `IA reativada manualmente em ${new Date().toLocaleString('pt-BR')}`
        }).eq('id', lead.id);
        console.log(`🟢 [COMANDO] IA reativada para ${lead.name}. Voltando ao atendimento automático.`);
        return;
    }

    if (comandoLimpo === '/status') {
        const statusAtual = lead.manual_pause 
            ? '🔴 IA PAUSADA MANUALMENTE' 
            : lead.is_paused 
                ? '⏸️ IA pausada (intervenção humana)'
                : '🟢 IA ativa';
        console.log(`📊 [STATUS] ${lead.name}: ${statusAtual}`);
        return;
    }

    // Comportamento original: mensagem humana normal pausa a IA por 10 min
    console.log(`👤 [HUMANO] Você enviou uma mensagem para o lead. Pausando IA por 10 min.`);
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
    console.log(`🤖 [SILÊNCIO] Autoresposta detectada para ${lead.name}. Bot aguardando humano silenciosamente...`);
    await db.saveMessage(lead.whatsapp_id, 'user', `[AUTORESPOSTA] ${texto}`, instanceId);
    return; // Silêncio total — não arquiva, não responde, apenas aguarda
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

        // 🛑 INTERCEPTADOR [ROBO]: Silêncio total — aguarda humano
if (resposta && resposta.includes('[ROBO]')) {
    console.log(`🤖 [SILÊNCIO IA] Autoresposta detectada pela IA para ${lead.name}. Aguardando humano...`);
    await db.saveMessage(lead.whatsapp_id, 'user', `[AUTORESPOSTA] ${texto}`, instanceId);
    return;
}
        if (resposta) {


                // ========================================================================
// 🛑 ANTI-REPETIÇÃO DE ÁUDIO (CORRIGIDO)
// ========================================================================
const memoriaHistorico = JSON.stringify(historico);

if (memoriaHistorico.includes('<<Áudio Como Funciona Enviado>>') && /\[AUDIO[_\w]*?(FUNCIONA|COMO)[_\w]*?\]/i.test(resposta)) {
    console.log("🛡️ [SDR] Bloqueando repetição do áudio 1...");
    resposta = 'Como te expliquei no áudio ali em cima, a gente usa a energia das nossas usinas WEG pra injetar na sua rede e te dar o desconto direto. [QUEBRA] Ficou alguma dúvida sobre essa parte?';
}
if (memoriaHistorico.includes('<<Áudio Segurança Enviado>>') && /\[AUDIO[_\w]*?SEGURA[NÇC]A[_\w]*?\]/i.test(resposta)) {
    console.log("🛡️ [SDR] Bloqueando repetição do áudio 2...");
    resposta = 'Conforme te falei no áudio agora há pouco, é super seguro. A concessionária continua cuidando de tudo e não tem fidelidade. [QUEBRA] Vc tem a conta fácil aí pra gente ver se a sua empresa aprova?';
}
if (memoriaHistorico.includes('<<Áudio Obras/Placas Enviado>>') && /\[AUDIO[_\w]*?(PLACA|OBRA)[_\w]*?\]/i.test(resposta)) {
    console.log("🛡️ [SDR] Bloqueando repetição do áudio 3...");
    resposta = 'Como comentei no áudio anterior, é zero obras rs. Não precisa de placa no telhado nem nada, é só a portabilidade digital mesmo. [QUEBRA] Consegue me mandar a foto da fatura pra gente simular?';
}

        // ========================================================================
            // 🌟 INTERCEPTADOR DE ÁUDIO BLINDADO (CATCH-ALL HÍBRIDO)
            // ========================================================================
            // Pega QUALQUER coisa que comece com [AUDIO e termine com ]
            const todasAsTagsAudio = resposta.match(/\[AUDIO.*?\]/gi);

            if (todasAsTagsAudio) {
                for (const tag of todasAsTagsAudio) {
                    console.log(`🎤 [SDR] Tag de áudio detectada pela IA: ${tag}`);
                    
                    const tagStr = tag.toUpperCase();
                    let audioFile = '';
                    let memoriaTag = '';

                    // Mapeia as tags reais
                    if (tagStr.includes('FUNCIONA') || tagStr.includes('COMO')) {
                        audioFile = './assets/audio_como_funciona.ogg';
                        memoriaTag = '<<Áudio Como Funciona Enviado>>';
                    } else if (tagStr.includes('SEGUR')) {
                        audioFile = './assets/audio_seguranca.ogg';
                        memoriaTag = '<<Áudio Segurança Enviado>>';
                    } else if (tagStr.includes('PLACA') || tagStr.includes('OBRA')) {
                        audioFile = './assets/audio_obras_placas.ogg';
                        memoriaTag = '<<Áudio Obras/Placas Enviado>>';
                    }

                    // 🛡️ LIMPEZA VITAL: Apaga a tag do texto para o lead NUNCA ver colchetes!
                    resposta = resposta.replace(tag, '').trim();

                    // Se encontrou um arquivo real, envia PRIMEIRO
                    if (audioFile && fs.existsSync(audioFile)) {
                        await sock.sendPresenceUpdate('recording', remoteJid); 
                        await delay(6000);
                        try {
                            const audioBuffer = fs.readFileSync(audioFile);
                            await sock.sendMessage(remoteJid, { 
                                audio: audioBuffer, 
                                mimetype: 'audio/ogg; codecs=opus', 
                                ptt: true 
                            });
                            console.log("✅ [SDR] Áudio enviado com sucesso!");
                            await db.saveMessage(lead.whatsapp_id, 'assistant', memoriaTag, instanceId);
                            await delay(2000); // Respiro antes do próximo balão de texto
                        } catch (erroAudio) {
                            console.error("❌ [ERRO ÁUDIO]:", erroAudio.message);
                        }
                    } else {
                        // É uma tag inventada! Como já limpamos ela no .replace() ali em cima, 
                        // apenas ignoramos o envio de arquivo silenciosamente.
                        console.log(`⚠️ [BLINDAGEM] A IA inventou a tag ${tag} ou arquivo não existe. Ignorado silenciosamente.`);
                    }
                }
            }

            // Se a IA gerou APENAS a tag e mais nenhum texto (e a tag já foi apagada):
            if (resposta.length === 0) return;

            // ========================================================================
            // 🌟 SIMULADOR HUMANO DE DIGITAÇÃO FRAGMENTADA
            // ========================================================================


            // ========================================================================
            // 🌟 O NOVO FATIADOR DE BALÕES (TRUQUE DA [QUEBRA])
            // ========================================================================
            const mensagensSplit = resposta.split('[QUEBRA]')
                .map(t => t.trim())
                .filter(t => t.length > 0)
                .slice(0, 2); 
            
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

   
    // 🛡️ CONTROLE DE CPU: Variável de Backoff Exponencial
    let falhasConsecutivas = 0; 

    // Loop Infinito exclusivo deste chip
    while (true) {
        let currentLeadId = null; 

        try {
            // 1. Trava de Horário (Segurança Anti-Ban)
            if (!dentroDaJanelaDeDisparo()) {
    await delay(60000 * 5); 
    continue;
}
            // 🌟 SAAS DATA: Puxa a identidade e os limites deste chip no banco de dados
            const instanceData = await db.getInstanceRules(instanceId);
            if (!instanceData) {
                await delay(10000);
                continue; // Aguarda o banco responder
            }
            
            const config = {
                nome: instanceData.name || `Chip-${instanceId.substring(0, 4)}`,
                limite: instanceData.daily_limit || 50,
                agente: instanceData.agent_name || "Marlon",
                empresa: instanceData.company_name || "Enerzee"
            };

            // 2. Busca 1 lead 'new' que pertença EXCLUSIVAMENTE a este chip
            const { data: lead, error } = await supabase
                .from('leads')
                .select('*')
                .eq('status', 'new')
                .eq('instance_id', instanceId)
                .order('created_at', { ascending: true }) 
                .limit(1)
                .maybeSingle();

            if (error) throw error; // Se der erro de banco, cai pro catch e ativa o Backoff de proteção

            if (!lead) {
                falhasConsecutivas = 0; // O banco respondeu bem, só não tem lead na fila. Zera as falhas.
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
            const jitter = Math.random() * 180000 + 180000;
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

            // 11. Saudação Dinâmica e Humanizada (V36 - MS)
            console.log(`🚀 [DISPARANDO] ${config.nome} enviando saudação para ${lead.name}...`);
            
            await instancia.sock.sendPresenceUpdate('composing', cleanJid);
            await delay(Math.random() * 4000 + 4000); 
            await instancia.sock.sendPresenceUpdate('paused', cleanJid);

          // 1. VARIÁVEIS DINÂMICAS (Agora usa os dados do banco SaaS)
            let primeiroNomeDono = null;
            if (lead.dono && lead.dono.trim().length > 2) {
                const nomeSujo = lead.dono.trim().split(' ')[0].toLowerCase();
                primeiroNomeDono = nomeSujo.charAt(0).toUpperCase() + nomeSujo.slice(1);
            }
            
            const bairroLead = lead.bairro ? `no bairro ${lead.bairro}` : "aí na região";
            const nomeEmpresa = lead.name ? lead.name.replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim() : "sua empresa";

           // 2. GATILHO DE ABORDAGEM INDIRETA (Aumenta a taxa de resposta baixando a guarda)
            const saudacaoInicial = primeiroNomeDono 
                ? `Opa ${primeiroNomeDono}, tudo bem?` 
                : `Opa, tudo bem? Falo com o responsável pela ${nomeEmpresa}?`;

            // 3. A NOVA ISCA (Gatilho da Indicação: "Dando" energia e perguntando de terceiros)
            const novaSaudacao = `${saudacaoInicial} [QUEBRA] Aqui é o ${config.agente}. Peguei o contato da ${nomeEmpresa} num levantamento que a gente fez — identifiquei um dado aqui que queria confirmar contigo antes de fechar o relatório. É rapidinho, consegue me dar um retorno?`;
            // 12. Fatiador de Balões com Trava Anti-Engasgo e Limite de 2 Balões
            const mensagensSplit = novaSaudacao.split('[QUEBRA]')
                .map(t => t.trim())
                .filter(t => t.length > 0)
                .slice(0, 2); // 🛡️ TRAVA RIGOROSA: Máximo de 2 balões na abordagem inicial
            
            for (let i = 0; i < mensagensSplit.length; i++) {
                
                // 🛑 CHECAGEM DE INTERRUPÇÃO (Prevenção contra Bots de atendimento)
                const { data: checkMsg } = await supabase
                    .from('messages')
                    .select('role')
                    .eq('whatsapp_id', cleanJid)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (checkMsg && checkMsg.role === 'user') {
                    console.log(`🛑 [INTERRUPÇÃO] Lead ${lead.name} respondeu rápido. Abortando os próximos balões da saudação.`);
                    break; 
                }

                const trecho = mensagensSplit[i].replace(/[\*_~`]/g, '');
                const tempoDigitacao = (trecho.length * 70) + 3000; 
                
                await instancia.sock.sendPresenceUpdate('composing', cleanJid);
                await delay(Math.max(4000, Math.min(tempoDigitacao, 10000))); 
                
                await enviarMensagemIA(instancia.sock, cleanJid, { text: trecho });
                await db.saveMessage(cleanJid, 'assistant', trecho, instanceId);

                if (i < mensagensSplit.length - 1) {
                    await instancia.sock.sendPresenceUpdate('paused', cleanJid);
                    await delay(Math.random() * 2000 + 2500); 
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

            // 🛡️ SUCESSO! Zera o contador de falhas de CPU
            falhasConsecutivas = 0;

} catch (err) {
            console.error(`❌ Erro no motor do chip ${instanceId}:`, err.message);
            if (currentLeadId) leadsEmProcessamento.delete(currentLeadId); 
            
            // 🛡️ PROTEÇÃO DE CPU: BACKOFF EXPONENCIAL
            falhasConsecutivas++;
            const tempoEspera = Math.min(10000 * Math.pow(2, falhasConsecutivas - 1), 300000); 
            console.log(`⏸️ [CONTROLE CPU] Pausando motor ${config.nome} por ${tempoEspera / 1000}s para evitar sobrecarga...`);
            
            await delay(tempoEspera); 
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
    .select('role, content')   // ← adicionado 'content'
    .eq('whatsapp_id', l.whatsapp_id)
    .order('created_at', { ascending: false })
    .limit(1);

if (mensagens && mensagens.length > 0 
    && mensagens[0].role === 'user' 
    && !mensagens[0].content?.startsWith('[AUTORESPOSTA]')) { 
                        // 👇 NOVA TRAVA DE SEGURANÇA (Sugerida pelo Claude)
                        if (iaRespondendo.has(l.whatsapp_id)) {
                            console.log(`⏳ [RECUPERAÇÃO] Lead ${l.name} ignorado no loop pois a IA principal já está digitando para ele.`);
                            continue; // Pula para o próximo lead
                        }
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
    // 🔴 TRAVA MANUAL: Se o operador pausou manualmente, NUNCA auto-retoma
    if (l.manual_pause) {
        console.log(`🔴 [PAUSA MANUAL] ${l.name} está sob controle humano. Loop de recuperação ignorando.`);
        continue;
    }

    if (iaRespondendo.has(l.whatsapp_id)) continue;
    console.log(`🔄 [SDR] Tempo de intervenção humana esgotado para ${l.name}. Retomando IA...`);
    
    await supabase.from('leads')
        .update({ is_paused: false })
        .eq('id', l.id);

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

    const ultimaMsg = histRaw[histRaw.length - 1];
    if (ultimaMsg.role !== 'user') {
        console.log(`🛑 [SDR] Recuperação abortada para ${lead.name}: A última mensagem não foi do cliente.`);
        return;
    }

    // 🤖 TRAVA ANTI-AUTORESPOSTA: Se a última mensagem foi de um robô, aguarda humano silenciosamente
    if (ultimaMsg.content?.startsWith('[AUTORESPOSTA]')) {
        console.log(`⏳ [AGUARDANDO HUMANO] Última mensagem de ${lead.name} foi autoresposta. Motor de recuperação ignorando...`);
        return;
    }

    // 🔒 TRAVA DE RACIOCÍNIO
    if (iaRespondendo.has(lead.whatsapp_id)) {
        console.log(`🛑 [TRAVA RECUPERAÇÃO] IA já está respondendo para ${lead.name}. Abortando duplicata.`);
        return;
    }
    iaRespondendo.add(lead.whatsapp_id);

    try {
        console.log(`🧠 [IA] Gerando resposta de recuperação para ${lead.name}...`);
        const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
        const instanceData = await db.getInstanceRules(instanceId);
        
        // Gera a resposta de "venda"
        let resposta = await gerarRespostaIA(historico, lead, instanceData);

        // 🛑 INTERCEPTADOR [ROBO] (Motor de Recuperação) — Silêncio total
        if (resposta && resposta.includes('[ROBO]')) {
            console.log(`🤖 [SILÊNCIO RECUPERAÇÃO] Autoresposta detectada para ${lead.name}. Aguardando humano...`);
            return; // A mensagem já está salva no banco com [AUTORESPOSTA], apenas ignora
        }

        if (resposta) {
            
                // ========================================================================
            // 🛑 ANTI-REPETIÇÃO DE ÁUDIO
            // ========================================================================
            const memoriaHistorico = JSON.stringify(historico);

            if (memoriaHistorico.includes('<<Áudio Como Funciona Enviado>>') && /\[AUDIO[_\w]*?(FUNCIONA|COMO)[_\w]*?\]/i.test(resposta)) {
                console.log("🛡️ [SDR] Bloqueando repetição do áudio 1...");
                resposta = 'Como te expliquei no áudio ali em cima, a gente usa a energia das nossas usinas WEG pra injetar na sua rede. Ficou alguma dúvida sobre essa parte?';
            }
            if (memoriaHistorico.includes('<<Áudio Segurança Enviado>>') && /\[AUDIO[_\w]*?SEGURA[NÇC]A[_\w]*?\]/i.test(resposta)) {
                console.log("🛡️ [SDR] Bloqueando repetição do áudio 2...");
                resposta = 'Conforme te falei no áudio agora há pouco, é super seguro e não tem fidelidade. Vc tem a conta fácil aí pra gente ver se a sua empresa aprova?';
            }
            if (memoriaHistorico.includes('<<Áudio Obras/Placas Enviado>>') && /\[AUDIO[_\w]*?(PLACA|OBRA)[_\w]*?\]/i.test(resposta)) {
                console.log("🛡️ [SDR] Bloqueando repetição do áudio 3...");
                resposta = 'Como comentei no áudio anterior, é zero obras rs. Não precisa de placa no telhado. Consegue me mandar a foto da fatura pra gente simular?';
            }

            // ========================================================================
            // 🌟 MOTOR ÚNICO DE ÁUDIO (BLINDADO E LIMPO)
            // ========================================================================
            const todasAsTagsAudio = resposta.match(/\[AUDIO.*?\]/gi);

            if (todasAsTagsAudio) {
                for (const tag of todasAsTagsAudio) {
                    console.log(`🎤 [SDR] Tag de áudio detectada: ${tag}`);
                    
                    const tagStr = tag.toUpperCase();
                    let audioFile = '';
                    let memoriaTag = '';

                    if (tagStr.includes('FUNCIONA') || tagStr.includes('COMO')) {
                        audioFile = './assets/audio_como_funciona.ogg';
                        memoriaTag = '<<Áudio Como Funciona Enviado>>';
                    } else if (tagStr.includes('SEGUR')) {
                        audioFile = './assets/audio_seguranca.ogg';
                        memoriaTag = '<<Áudio Segurança Enviado>>';
                    } else if (tagStr.includes('PLACA') || tagStr.includes('OBRA')) {
                        audioFile = './assets/audio_obras_placas.ogg';
                        memoriaTag = '<<Áudio Obras/Placas Enviado>>';
                    }

                    // Apaga a tag do texto para o cliente nunca ver
                    resposta = resposta.replace(tag, '').trim();

                    if (audioFile && fs.existsSync(audioFile)) {
                        await sock.sendPresenceUpdate('recording', remoteJid); 
                        await delay(6000); // 6s simulando gravação
                        try {
                            const audioBuffer = fs.readFileSync(audioFile);
                            await sock.sendMessage(remoteJid, { 
                                audio: audioBuffer, 
                                mimetype: 'audio/ogg; codecs=opus', 
                                ptt: true 
                            });
                            console.log("✅ [SDR] Áudio enviado com sucesso!");
                            await db.saveMessage(lead.whatsapp_id, 'assistant', memoriaTag, instanceId);
                        } catch (erroAudio) {
                            console.error("❌ [ERRO ÁUDIO]:", erroAudio.message);
                        }
                    } else {
                        console.log(`⚠️ [BLINDAGEM] Tag inválida ${tag} ignorada silenciosamente.`);
                    }
                }
            }

            // SE A IA ENVIOU APENAS A TAG (Como pedimos no prompt), O TEXTO AGORA ESTÁ VAZIO.
            // ENTÃO PARAMOS POR AQUI E NENHUM TEXTO É ENVIADO:
            if (resposta.length === 0) return;


            // ========================================================================
            // 🌟 SIMULADOR HUMANO DE DIGITAÇÃO FRAGMENTADA
            // ========================================================================
            const mensagensSplit = resposta.split('[QUEBRA]')
                .map(t => t.trim())
                .filter(t => t.length > 0)
                .slice(0, 2); // <-- A TRAVA DOS 3 BALÕES AQUI TAMBÉM
            
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

    } catch (erroRecuperacao) {
        console.error(`❌ [ERRO RECUPERAÇÃO] Falha para ${lead.name}:`, erroRecuperacao.message);
    } finally {
        iaRespondendo.delete(lead.whatsapp_id); // 🔓 SEMPRE libera a trava
        console.log(`🔓 [TRAVA RECUPERAÇÃO LIBERADA] ${lead.name} livre novamente.`);
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
    encerrarInstancia: (instanceId) => {
        const instancia = sessions.get(instanceId);
        if (instancia?.sock) {
            try { instancia.sock.end(); } catch(e) {}
        }
        sessions.delete(instanceId);
        instanciasLigando.delete(instanceId);
        console.log(`🔌 [SDR] Sessão ${instanceId} encerrada da memória.`);
    },
    criarNovaInstancia: async (n, t) => {
        const { data } = await supabase.from('instances').insert([{ name: n, owner_phone: t }]).select().single(); 
        if (data) startInstance(data.id, data.name); 
        return data; 
    }
};