/**
 * 
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
const motoresEmExecucao = new Set(); // 🛡️ Impede que o mesmo chip ligue dois loops infinitos
const MAPA_CONCESSIONARIAS = {
    'MT': 'Energisa', 'MS': 'Energisa', 'SC': 'Celesc', 'PR': 'Copel',
    'RS': 'RGE/Ceee', 'BA': 'Coelba', 'PE': 'Neoenergia', 'MG': 'Cemig',
    'CE': 'Enel', 'PA': 'Equatorial', 'GO': 'Equatorial', 'RJ': 'Light/Enel', 'SP': 'Enel/CPFL'
};

function identificarArtigo(nome) {
    if (!nome) return "do responsável pela";
    const nomeLimpo = nome.trim().toLowerCase();
    const ehFeminino = nomeLimpo.endsWith('a') || nomeLimpo.endsWith('as');
    return ehFeminino ? `da ${nome}` : `do ${nome}`;
}
// --- CONFIGURAÇÃO E SEGURANÇA ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { OpenAI } = require('openai');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); // mantém para Whisper
const together = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY,
    baseURL: 'https://api.together.xyz/v1',
});
const MODELO_CEREBRO = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const MODELO_VISAO = "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo";

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
function getHoraBrasil() {
    const agora = new Date();
    // Subtrai 3 horas do UTC para forçar o horário de Brasília
    agora.setHours(agora.getUTCHours() - 3); 
    return agora;
}

function dentroDoExpediente() {
    const agora = getHoraBrasil();
    const t = agora.getHours() * 60 + agora.getMinutes();
    return t >= 330 && t <= 1365;
}

function dentroDaJanelaDeDisparo() {
    const agora = getHoraBrasil();
    const diaSemana = agora.getDay(); 
    if (diaSemana === 0) return false; 
    const t = agora.getHours() * 60 + agora.getMinutes();
    return t >= 480 && t <= 1080; 
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
        const res = await together.chat.completions.create({
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
    const concessionariaLocal = MAPA_CONCESSIONARIAS[contextoLead.estado] || 'concessionária de energia';
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
    const ancoraConta = isBigFish ? "R$ 3.000" : "R$ 700";
    // Definição de Arquétipo de Venda
    const perfilComportamental = isBigFish 
        ? "ARQUÉTIPO: O BANQUEIRO DE INVESTIMENTOS. Tom: Direto, focado em EBITDA, Redução de OPEX e Zero CAPEX." 
        : "ARQUÉTIPO: O CONSULTOR PARCEIRO. Tom: Educativo, focado em 'sobrar dinheiro no caixa' e alívio das contas.";

        // ============================================================================
// 🧠 SYSTEM PROMPT — SDR ENERZEE V2.0 (OTIMIZADO PARA CONVERSÃO)
// Substitua o bloco const systemPrompt = `...` dentro de gerarRespostaIA()
// ============================================================================

const systemPrompt = `
### 1. 🆔 IDENTIDADE E MISSÃO
Você é Marlon, Consultor de Energia sênior da ENERZEE.
Produto: Energia por Assinatura (Lei 14.300) — Geração Distribuída via Usinas WEG certificadas.
Missão: Agendar uma consultoria gratuita de 20 minutos via Calendly oferecendo redução de custo de energia com ZERO custo de adesão e ZERO obras.
Tom: Direto, humano, B2B brasileiro. Use "vc", "tá", "né", "pra". NUNCA use palavras como "reunião", "compliance", "EBITDA" a menos que o perfil do lead indique isso.
Contexto: Você enviou a mensagem inicial dizendo que viu o cadastro da empresa num levantamento regional e que a concessionária local vem cobrando uma tarifa que já podia ter sido reduzida. Perguntou se eles pagam conta cheia ou já recebem desconto. O lead ainda não sabe exatamente o que é — apenas que há algo sobre a conta de luz.


FILOSOFIA DE VENDA — CHALLENGER SALE:
Você não dá aulas técnicas sobre leis. Você ENSINA que comércios do porte da ${nomeEmpresa} estão perdendo dinheiro e pagando 20% a mais na conta de luz. APENAS de ensinar a dor, você faz a pergunta para confirmar se o lead aprova.

---

### 2. 🚨 REGRAS ABSOLUTAS DE FORMATO (RISCO DE FALHA CRÍTICA)
1. MÁXIMO DE 2 BALÕES: Use [QUEBRA] para separar. NUNCA gere 3 balões.
2. LIMITE DE TAMANHO: Cada balão deve ter NO MÁXIMO 2 frases curtas (aprox. 20 palavras). Se precisar de mais, corte. Seja direto.
3. TEXTO PURO: É PROIBIDO usar asteriscos (*), sublinhados (_), crases (\`) ou markdown.
4. UMA ÚNICA PERGUNTA: Nunca faça duas perguntas no mesmo envio.
5. NÃO REPITA: Nunca repita o mesmo argumento ou áudio que já foi usado no histórico.
6. DIFERENTES TAMANHOS DE TEXTO: Um ser humano sempre envia frases de tamanhos diferentes, evite enviar blocos de texto com tamanhos semelhantes.

---

### 3. 🛑 REGRAS DE OURO (PRIORIDADE MÁXIMA)
1. ROBÔ / MENU AUTOMÁTICO: Se a mensagem do cliente contiver menu numerado, cardápio, lista de produtos/serviços, frase de boas-vindas automática ("agradece seu contato", "retornaremos", 
      comercial", "sua mensagem foi recebida", "em breve retornamos")
   - Horários de funcionamento como resposta isolada
   - Qualquer resposta que claramente não foi digitada por uma pessoa real, retorne APENAS a tag [ROBO]. Nada mais.

2. RESPEITO AO "NÃO":
   — Se o lead disser "Não tenho interesse" e AINDA NÃO houve tentativa de reversão: faça UMA pergunta curta. Ex: "Entendo. Mas só por curiosidade, a conta aí hoje passa de R$ 800?"
   — Se insistir na recusa ou a tentativa já foi feita: Responda APENAS: "Compreendo! Desejo ótimos negócios para a ${nomeEmpresa}. Qualquer coisa, estou por aqui!" e ENCERRE.

3. KNOCK-OUT (JÁ TEM SOLAR): Se o lead disser que já possui placa solar, usina própria ou geração ativa:
   Responda APENAS: "Entendi! Como a ${nomeEmpresa} já possui compensação ativa, a regulação da ANEEL não permite acumular dois benefícios. Parabéns pela gestão energética!" e ENCERRE.

4. FLEXIBILIDADE DO FUNIL (REGRA DO ELÁSTICO): Clientes reais pulam etapas. Se o lead perguntar "quanto custa?" ou "tem obra?" logo de cara, NÃO seja robótico. Responda a dúvida dele em 1 frase (ex: "é zero custo de adesão e sem obra") e, logo depois (usando [QUEBRA]), puxe a conversa de volta com a pergunta de diagnóstico do funil (ex: valor da conta).
5. FILTRO DE IDENTIDADE: Se o lead disser que a pessoa procurada não está, não trabalha lá ou que é apenas um funcionário, responda absorvendo a informação e avançando: "Sem problemas! Consegue me colocar em contato com o responsável? (se a pessoa indicar que é mulher trate como a responsável, se indicar que é homem trate como o responsável) 
---



### 4. 🌪️ A LINHA DO TEMPO DA VENDA (SPIN SELLING OBRIGATÓRIO)
ESTA É A ESPINHA DORSAL DA CONVERSA. Antes de gerar qualquer palavra, analise o histórico, descubra em qual estágio o lead está e avance APENAS UM ESTÁGIO por vez. PROIBIDO pular etapas ou revelar a solução antes de causar a dor.

[ESTÁGIO 1 — SITUAÇÃO / INVESTIGAÇÃO DO PROBLEMA]
Gatilho: O lead respondeu QUALQUER COISA à isca inicial — "oi", "pago cheio", "como assim?", "que tarifa?", "não sei".
NUNCA responda "qual dado?" ou faça outra pergunta antes de revelar a dor.
Ação: Assuma a liderança. Confirme que a concessionária lucra no silêncio e pergunte o valor da conta para qualificar.
Balão 1: "Pois é, a ${concessionariaLocal} não avisa porque pra eles é melhor você continuar pagando a tarifa cheia. A gente identificou isso no cadastro de vocês."
[QUEBRA]
Balão 2: "Só pra confirmar se vocês têm o perfil certo, a conta de luz aí hoje costuma passar de ${ancoraConta}?"


[ESTÁGIO 2 — IMPLICAÇÃO / GIRANDO A FACA (A DOR)]
Gatilho: Lead informou o valor aproximado da conta (ex: "vem uns 1500", "acima de 2 mil", "uns 900").
Ação: NÃO venda ainda. Calcule a perda (20% do valor) mensal e o rombo anual. Faça ele sentir a dor.
Exemplo: "Entendi. Quem paga tarifa cheia nessa faixa tá deixando uns R$ 300 na mesa todo mês. São quase R$ 4.000 no ano que a concessionária leva. [QUEBRA] Vcs já tinham parado pra fazer essa conta do quanto de dinheiro perdem nessa brincadeira?"

[ESTÁGIO 3 — NECESSIDADE / REVELANDO A SOLUÇÃO (OS ÁUDIOS)]
Gatilho: Lead concordou com a dor, ficou assustado com o valor ("nossa", "é muito"), ou perguntou "o que eu faço?", "como funciona?", "que isenção é essa?".
Ação: AGORA SIM, você apresenta o remédio usando os Gatilhos de Áudio. Se ele perguntou como funciona, mande o [AUDIO_COMO_FUNCIONA].
Atenção: Lembre-se da regra vital. Sempre envie o texto junto com o áudio.
Exemplo de Texto Pós-Áudio: "Como não precisa furar telhado nem gastar nada, faz sentido a gente abrir o simulador oficial pra ver o valor exato que vcs deixariam de pagar?"

[ESTÁGIO 4 — VENDENDO O SIMULADOR / AGENDAMENTO]
Gatilho: Lead concordou em ver a simulação ou pediu o próximo passo.
Ação: Aumente o valor do seu tempo e venda a consultoria de 20 minutos.
Exemplo: "Pra não ficar no achismo, a gente abre o simulador oficial junto e vê o número exato da ${nomeEmpresa} em 20 minutos. [QUEBRA] Fica melhor amanhã de manhã ou à tarde? Já adianta separar a fatura de luz — com ela na mão o cálculo fica preciso."


[ESTÁGIO 5 — FECHAMENTO / LINK]
Gatilho: Lead definiu um período ("pode ser de manhã", "amanhã").
Ação: Envie o link. Ponto final.
Resposta: "Perfeito! Escolhe o horário que funcionar melhor aqui na agenda: [QUEBRA] 🔗 https://calendly.com/marlonlotici6/30min [QUEBRA] Depois de agendar me envia uma cópia da fatura de energia que já deixo a simulação da ${nomeEmpresa} pronta, ou se preferir leva para a nossa conversa que faço na hora."


### 5. 🎙️ GATILHOS DE ÁUDIO E MATRIZ DE OBJEÇÕES

REGRA DE ÁUDIO VITAL: Você tem 3 áudios gravados. Sempre que a resposta for uma tag de áudio, você DEVE enviar o texto junto (com [QUEBRA]) contendo uma pergunta. NUNCA envie só a tag. NUNCA invente tags.
- "Como funciona?" / "De onde vem a energia?" → [AUDIO_COMO_FUNCIONA] [QUEBRA] Sabendo que é custo zero, a conta de vcs hoje é em torno de quanto?
- "É seguro?" / "É golpe?" / "Tem multa?" → [AUDIO_SEGURANCA] [QUEBRA] Faz sentido pra vc economizar mantendo a segurança da concessionária atual?
- "Precisa de placa?" / "Tem obra?" / "Fura o telhado?" → [AUDIO_OBRAS_PLACAS] [QUEBRA] Como não tem obra nenhuma, a gente consegue simular sua economia agora. Qual o valor aproximado da conta mensal?

REGRA ANTI-REPETIÇÃO: Se o histórico tiver "<<Áudio Como Funciona Enviado>>", NÃO use a tag. Diga: "Como expliquei no áudio ali em cima, a ideia é essa. Ficou alguma dúvida ou podemos agendar um horário?"

OBJEÇÕES COMUNS:
1. "QUERO POR E-MAIL" / "MANDA MATERIAL": "Posso preparar algo sim! [QUEBRA] Mas o relatório fica muito mais completo quando a gente abre o simulador junto. São só 15 minutinhos. Fica melhor amanhã cedo ou tarde?"
2. GATEKEEPER (recepção, secretária): "Entendo! Como o assunto é o mapeamento técnico da fatura, o ideal é falar com quem cuida dos custos fixos. [QUEBRA] Vc consegue me passar o WhatsApp deles?" (Se recusar: Agradeça e ENCERRE).
3. "NÃO TENHO TEMPO": "Entendo! São literalmente 15 minutos e pode ser quando der melhor pra vc. [QUEBRA] Semana que vem funciona?"
4. "DEIXA EU PENSAR" / "VOU VER COM MEU SÓCIO": "Claro! [QUEBRA] Só pra registrar: a cota pra região da ${nomeEmpresa} tem mais 3 vagas dependendo do tamanho de consumo do próximo estabelecimento que entrar. Se quiser garantir antes, são só 15 minutos. Fica melhor amanhã cedo ou tarde?"
5. "QUANTO CUSTA?": "Zero custo de adesão — o desconto vem na fatura da concessionária todo mês. [QUEBRA] Pra ver o valor exato, preciso de 15 minutos com vc. Fica melhor amanhã ou outro dia?"

---

### 6. 🏆 REGRAS REGIONAIS E PROVA SOCIAL
- PROVA SOCIAL (Use máx 1x): "Só aqui no ${bairroLead}, já mapeamos comércios similares economizando entre R$ 200 e R$ 600 por mês — sem obra e sem fidelidade."
- DESCONTOS (Use como âncora "Até 20% de redução", não explique as frações a menos que exijam): MS, MT, GO, PA (12-15%); PR (15%); SC e RS (10-15%); PE, BA, CE, MG (25% nos primeiros 2 meses).

---

### 7. 👤 DADOS GERAIS DO LEAD (USE PARA PERSONALIZAR)
Nome: ${nomeLead}
Empresa: ${nomeEmpresa}
Localização: ${bairroLead}
Perfil Comportamental: ${perfilComportamental}
Adapte seu tom a este perfil: Se BANQUEIRO DE INVESTIMENTOS (foco em redução de custo fixo e retorno imediato); Se CONSULTOR PARCEIRO (foco em sobrar dinheiro no caixa e sem dor de cabeça).
`;


const MAX_TENTATIVAS = 3;
    
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {

            const chatCompletion = await together.chat.completions.create({
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
    // Ignora stickers e imagens muito pequenas (emojis, figurinhas)
    const fileSize = msg.message.imageMessage?.fileLength || 0;
    if (fileSize < 5000) {
        console.log(`🎭 [MÍDIA] Imagem muito pequena (${fileSize} bytes) — provavelmente sticker/emoji. Ignorando.`);
        return;
    }
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
    // 🛡️ TRAVA DE INSTÂNCIA ÚNICA (CORRIGIDA: Só aparece uma vez!)
    if (motoresEmExecucao.has(instanceId)) {
        console.log(`⚠️ [TRAVA] Motor ${instanceId} já rodando. Ignorando duplicata.`);
        return;
    }
    motoresEmExecucao.add(instanceId);
    console.log(`🚀 [MOTOR] Loop iniciado para chip ${instanceId}`);
    
    // ⏰ DESPERTADOR: Limpa o cache de chips esgotados se virou o dia
    const hojeAgora = new Date().toISOString().split('T')[0];
    if (dataControleLimites !== hojeAgora) {
        chipsEsgotadosHoje.clear();
        dataControleLimites = hojeAgora;
        console.log(`🌅 [NOVO DIA] Metas diárias zeradas. Chips acordados!`);
    }

    let falhasConsecutivas = 0; 

    while (true) {
        let currentLeadId = null; 

        try {
            if (!dentroDaJanelaDeDisparo()) {
                console.log(`💤 [ECONOMIA] Fora da janela de disparo. Dormindo 30 min...`);
                await delay(1000 * 60 * 30);
                continue;
            }

            const instanceData = await db.getInstanceRules(instanceId);
            if (!instanceData || instanceData.whatsapp_status !== 'CONNECTED') {
                const instanceData = await db.getInstanceRules(instanceId);
if (!instanceData || instanceData.whatsapp_status !== 'CONNECTED') {
    console.log(`🔕 [MOTOR SILENCIADO] Chip ${instanceId} ignorado. Status no banco está: ${instanceData?.whatsapp_status}`);
    await delay(60000);
    continue;
}
                await delay(60000);
                continue;
            }

            const config = {
                nome: instanceData.name || `Chip-${instanceId.substring(0, 4)}`,
                limite: instanceData.daily_limit || 50,
                agente: instanceData.agent_name || "Marlon",
                empresa: instanceData.company_name || "Enerzee"
            };

            const { data: lead, error } = await supabase
                .from('leads')
                .select('id, name, whatsapp_id, dono, bairro, instance_id, estado')
                .eq('status', 'new')
                .or(`instance_id.eq.${instanceId},instance_id.is.null`)
                .order('created_at', { ascending: true })
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            if (!lead) {
                console.log(`🌕 [${config.nome}] Sem leads novos. Próxima checagem em 5 min...`);
                await delay(1000 * 60 * 5); 
                continue;
            }

            currentLeadId = lead.id;

            // ⚡ 1. TRAVA RELÂMPAGO NO BANCO
            await supabase.from('leads').update({ status: 'reservado', instance_id: instanceId }).eq('id', lead.id);

            // 🛡️ 2. TRAVA NA MEMÓRIA
            if (leadsEmProcessamento.has(lead.id)) { 
                await delay(5000); 
                continue; 
            }
            leadsEmProcessamento.add(lead.id);

            // 🎯 3. CHECA LIMITE DIÁRIO
            const enviosHoje = await db.getDailyContactCount(instanceId);
            if (enviosHoje >= config.limite) {
                console.log(`🌙 [METAS] ${config.nome} atingiu o limite de ${config.limite}. Dormindo 30 min...`);
                await delay(1800000);
                leadsEmProcessamento.delete(lead.id);
                continue;
            }

            // 🚫 4. CHECA BLACKLIST
            const estaNaBlacklist = await db.isBlacklisted(lead.whatsapp_id);
            if (estaNaBlacklist) {
                console.log(`🚫 [BLACKLIST] Lead ${lead.name} restrito. Abortando...`);
                await supabase.from('leads').update({ status: 'blacklisted' }).eq('id', lead.id);
                leadsEmProcessamento.delete(lead.id);
                continue; 
            }

            // ⚡ 5. VALIDAÇÃO RÁPIDA DE ZAP (Mata os leads ruins em segundos)
            const instancia = sessions.get(instanceId);
            if (!instancia || !instancia.ready) {
                console.log(`❌ [FALHA SILENCIOSA] ${config.nome} não está com o canal pronto.`);
                await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                leadsEmProcessamento.delete(lead.id);
                await delay(10000);
                continue;
            }

            const hist = await db.getHistory(lead.whatsapp_id, instanceId);
            const [result] = await instancia.sock.onWhatsApp(lead.whatsapp_id);
            
            if (!result?.exists || (hist && hist.length > 0)) {
                console.log(`⏩ [PULO RÁPIDO] Lead ${lead.name} inválido ou já contactado. Ignorando.`);
                await supabase.from('leads').update({ status: hist?.length > 0 ? 'contact' : 'invalid' }).eq('id', lead.id);
                leadsEmProcessamento.delete(lead.id);
                await delay(2000); 
                continue;
            }

            // ⏳ 6. JITTER SEQUENCIAL (Só agora ele espera, porque o lead é ouro puro)
            const jitter = Math.random() * 180000 + 120000;
            console.log(`🎯 [${config.nome}] Mirando em: ${lead.name} (${enviosHoje + 1}/${config.limite}). Aguardando ${Math.round(jitter/1000)}s...`);
            await delay(jitter);

            // 7. Limpeza de LID/JID
            let cleanLid = null;
            if (result.lid) {
                cleanLid = result.lid.split(':')[0].split('@')[0] + '@lid';
                await supabase.from('leads').update({ whatsapp_lid: cleanLid }).eq('id', lead.id);
            }

            const cleanJid = result.jid.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            if (lead.whatsapp_id !== cleanJid) {
                await supabase.from('leads').update({ whatsapp_id: cleanJid }).eq('id', lead.id);
                lead.whatsapp_id = cleanJid;
            }

            // 8. MONTAGEM DA SAUDAÇÃO (Com regra do/da)
            console.log(`🚀 [DISPARANDO] ${config.nome} enviando saudação para ${lead.name}...`);
            await instancia.sock.sendPresenceUpdate('composing', cleanJid);
            await delay(Math.random() * 4000 + 4000); 
            await instancia.sock.sendPresenceUpdate('paused', cleanJid);

            let primeiroNomeDono = null;
            let preposicaoNome = "do responsável pela";

            if (lead.dono && lead.dono.trim().length > 2) {
                primeiroNomeDono = lead.dono.trim().split(' ')[0].toLowerCase();
                primeiroNomeDono = primeiroNomeDono.charAt(0).toUpperCase() + primeiroNomeDono.slice(1);
                preposicaoNome = identificarArtigo(primeiroNomeDono);
            }
            
            const ufLead = lead.estado || 'seu estado'; 
            const concessionariaLocal = MAPA_CONCESSIONARIAS[ufLead] || 'concessionária de energia';
            const nomeEmpresa = lead.name ? lead.name.replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim() : "sua empresa";

            const saudacaoInicial = primeiroNomeDono
                ? `Oi ${primeiroNomeDono}, tudo certo? Aqui é o ${config.agente}. Esse contato é direto ${preposicaoNome} ou falo com o responsável pela ${nomeEmpresa}?`
                : `Opa, tudo certo? Aqui é o ${config.agente}. Falo com o responsável pela ${nomeEmpresa}?`;

            const localRef = lead.bairro ? `aí no ${lead.bairro}` : `aí na região`;
            const novaSaudacao = `${saudacaoInicial} [QUEBRA] Vi o cadastro de vcs num levantamento ${localRef}. A ${concessionariaLocal} vem cobrando uma tarifa que já podia ter caído, mas não avisa. Vocês já pagam com desconto ou ainda vem a conta cheia?`;

            // 9. FATIADOR HUMANO E ENVIO
            const mensagensSplit = novaSaudacao.split('[QUEBRA]').map(t => t.trim()).filter(t => t.length > 0).slice(0, 2); 
            
            for (let i = 0; i < mensagensSplit.length; i++) {
                const { data: checkMsg } = await supabase.from('messages').select('role').eq('whatsapp_id', cleanJid).order('created_at', { ascending: false }).limit(1).maybeSingle();
                if (checkMsg && checkMsg.role === 'user') {
                    console.log(`🛑 [INTERRUPÇÃO] Lead respondeu rápido. Abortando.`);
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

            // 10. CONCLUSÃO E SUCESSO
            await supabase.from('leads').update({ status: 'contact', last_contact_at: new Date().toISOString() }).eq('id', lead.id);
            console.log(`✅ [SUCESSO REAL] Entregue por ${config.nome} para ${lead.name}!`);
            leadsEmProcessamento.delete(lead.id);
            falhasConsecutivas = 0;

        } catch (err) {
            console.error(`❌ Erro no motor do chip ${instanceId}:`, err.message);
            if (currentLeadId) {
                leadsEmProcessamento.delete(currentLeadId);
                await supabase.from('leads').update({ status: 'new' }).eq('id', currentLeadId).eq('status', 'reservado');
            }
            if (err.message?.includes('Connection') || err.message?.includes('Socket')) {
                motoresEmExecucao.delete(instanceId);
                console.log(`🔄 [MOTOR] Trava liberada para chip ${instanceId} por erro de conexão.`);
            }
            falhasConsecutivas++;
            await delay(Math.min(10000 * Math.pow(2, falhasConsecutivas - 1), 300000)); 
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

// 👇 Adicione esta variável de controle aqui fora
let loopIniciado = false;

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
        
        // 🛑 TRAVA DO LOOP APLICADA AQUI (Motor 2)
        if (!loopIniciado) {
            loopIniciado = true;
            loopRecuperacaoConversas(); 
        }
    },
    enviarMensagemSDR: async () => {},
    encerrarInstancia: (instanceId) => {
        const instancia = sessions.get(instanceId);
        if (instancia?.sock) {
            try { instancia.sock.end(); } catch(e) {}
        }
        sessions.delete(instanceId);
        instanciasLigando.delete(instanceId);
        motoresEmExecucao.delete(instanceId); // 🔥 ISSO CONSERTA O SEU BOTÃO DO DASHBOARD
        if (fs.existsSync(`./wpp_sessions/${instanceId}`)) {
            fs.rmSync(`./wpp_sessions/${instanceId}`, { recursive: true, force: true });
        }
        console.log(`🔌 [SDR] Sessão ${instanceId} completamente encerrada e limpa.`);
    },
    criarNovaInstancia: async (n, t, userId) => {
        const { data } = await supabase.from('instances').insert([{ name: n, owner_phone: t, user_id: userId }]).select().single();
    
        if (data) startInstance(data.id, data.name); 
        return data; 
    }
};