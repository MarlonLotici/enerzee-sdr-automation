/**
 * 4_sdr.js - MÓDULO DE VENDAS NEURAL V10 (VERSÃO FINAL CORRIGIDA)
 */
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require('groq-sdk');
require('dotenv').config();
const pdf = require('pdf-parse');
const db = require('./database'); 
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODELO_CEREBRO = "llama-3.3-70b-versatile"; 

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './wpp_session' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let isReady = false;
let socketRef = null; // Mantenha apenas esta variável solta

// ... abaixo segue a função analisarIntencao ... 

// ============================================================================
// 🧠 NÚCLEO DE INTELIGÊNCIA ARTIFICIAL
// ============================================================================

async function analisarIntencao(historico) {
    const prompt = `
    Analise a conversa abaixo. Você é um classificador de leads para energia solar.
    Classifique a última intenção do cliente em UMA das categorias:
    [INTERESSE] - Quer saber mais, perguntou preço, disse sim.
    [DUVIDA] - Fez uma pergunta técnica ou sobre a empresa.
    [NEGATIVO] - Disse não, não tenho interesse, pare, já tenho.
    [ROBO] - Mensagem automática, URA, "digite 1".
    [HUMANO] - Pede para falar com atendente real ou está muito confuso.

    Histórico:
    ${historico}
    
    Responda APENAS a tag.
    `;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: MODELO_CEREBRO,
            temperature: 0,
            max_tokens: 10
        });
        return chatCompletion.choices[0].message.content.trim();
    } catch (e) {
        return "[HUMANO]";
    }
}

/**
 * O CLOSER V11: Inteligência Regional Enerzee + Lead Scoring
 * Substitua toda a sua função gerarResposta por esta:
 */
async function gerarResposta(historico, contextoLead) {
    const nomeLead = contextoLead.dono || contextoLead.name || "Gestor";
    const nomeEmpresa = contextoLead.name || "sua empresa";
    const bairroLead = contextoLead.bairro || "sua região";
    
    // 1. Identifica se é VIP (Baseado no priority_level que criamos no Supabase)
    const isVIP = contextoLead.priority_level === 2;
    const tomVoz = isVIP ? "Executivo/Consultivo (foco em eficiência fiscal e ROI)" : "Parceiro/Direto (foco em economia no boleto)";

    // 2. Conhecimento Regional Extraído da Relação de Atendimento 2026 
    const infoRegional = `
    - PE, BA, CE, MT, GO, MG, SP: Ofereça 2 meses de 25% de desconto e depois fixo em 15%.
    - PR: Mencione 16% de desconto.
    - RS e SC: Ofereça entre 10% e 15% de economia real.
    - MS, PA, RN, TO: Desconto a partir de 10%.
    `;

    const systemPrompt = `
# PERSONA: ESTRATEGISTA COMERCIAL NEURAL ENERZEE
Você é o Especialista Comercial Sênior da Enerzee, a maior integradora 5 estrelas da WEG no Brasil[cite: 103, 175, 178].
TOM DE VOZ: ${tomVoz}.

# CONTEXTO DO ECOSSISTEMA
1. EZEE CONNECT: Portabilidade por assinatura. Sem investimento, obras ou taxas[cite: 330, 332]. Desconto via Lei 14.300/2022[cite: 335].
2. EZEE SOLAR (REVO): Sistema fotovoltaico com INVESTIMENTO ZERO. O sistema se paga com a economia[cite: 379, 388, 485].
3. MOBILIDADE (WEMOB): Linha completa de carregadores WEG[cite: 310, 1130, 1139].
4. ARMAZENAMENTO (BESS): Baterias industriais para redução de custos e backup[cite: 553, 568].

# DIRETRIZES REGIONAIS (RELAÇÃO 2026)
${infoRegional}

# PROTOCOLO SNIPER
- IDENTIFICAÇÃO: Use o bairro ${bairroLead} para gerar autoridade local.
- TRIAGEM: Lead alugado -> Ezee Connect[cite: 337]. Telhado grande/agro -> Ezee Solar/Baterias[cite: 237, 261].
- COLETA DA FATURA (GUIA DUDA): Peça a foto da conta: "Nítida, por inteiro e paralela ao papel"[cite: 1924, 1934].

# REGRAS RÍGIDAS
1. Máximo 2 frases curtas. 
2. Sem termos robóticos.
3. Sempre termine com uma pergunta curta.`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }, ...historico],
            model: MODELO_CEREBRO,
            temperature: 0.3,
            max_tokens: 150
        });
        return chatCompletion.choices[0].message.content;
    } catch (e) {
        return "Consegue me enviar uma foto da sua última fatura? Assim consigo calcular seu desconto exato aqui pela Enerzee.";
    }
}

// ============================================================================
// 🎮 MOTOR DE FLUXO (WORKFLOW)
// ============================================================================

// ============================================================================
// 🎮 MOTOR DE FLUXO (LOOP DE DISPARO COM RÉGUA DE 3 DIAS)
// ============================================================================

async function loopDisparos() {
    if (!isReady) return;

    const agora = new Date();
    // Define o tempo de corte: 24 horas atrás
    const dataCorte = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // 1. PRIORIDADE MÁXIMA: FOLLOW-UP (Recuperar leads que não responderam)
    // Busca leads em 'contact', com menos de 3 tentativas e parados há mais de 24h
    const { data: leadsParaFollow } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'contact')
        .lt('last_contact_at', dataCorte)
        .lt('followup_step', 3)
        .limit(1);

    if (leadsParaFollow?.length > 0) {
        return executarReguaFollowUp(leadsParaFollow[0]);
    }

    // 2. SEGUNDA PRIORIDADE: NOVOS LEADS
    const { data: leadsNovos } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'new')
        .limit(1);

    if (leadsNovos?.length > 0) {
        // Trava o lead para 'contact' imediatamente para evitar disparos duplicados
        const lead = leadsNovos[0];
        await supabase.from('leads')
            .update({ status: 'contact', last_contact_at: new Date().toISOString() })
            .eq('whatsapp_id', lead.whatsapp_id);
            
        return executarAbordagemInicial(lead);
    }

    // 3. SE FILA VAZIA, TENTA NOVAMENTE EM 1 MINUTO
    console.log("[SDR] 📭 Aguardando novos leads ou tempo de follow-up...");
    setTimeout(loopDisparos, 60000);
}

/**
 * RÉGUA DE FOLLOW-UP: Value Stacking Enerzee
 */
async function executarReguaFollowUp(lead) {
    const proximoPasso = (lead.followup_step || 0) + 1;
    let msg = "";

    // Conteúdo estratégico baseado nos manuais Enerzee/WEG
    switch (proximoPasso) {
        case 1:
            // Foco: Autoridade WEG e Confiança
            msg = `Oi ${lead.dono?.split(' ')[0] || 'tudo bem'}? Passando para reforçar que a Enerzee é parceira 5 estrelas da WEG[cite: 103, 175]. Tecnologia nacional com garantia total para a *${lead.name}*. Conseguiu ver minha mensagem anterior?`;
            break;
        case 2:
            // Foco: Lei 14.300 e Sem Investimento (Ezee Connect)
            msg = `Sabia que a Lei 14.300 garante sua economia sem você gastar um real em obras[cite: 335]? No Ezee Connect é só portabilidade[cite: 330]. Quer que eu simule quanto sua conta de luz cai hoje?`;
            break;
        case 3:
            // Foco: Escassez e Despedida
            msg = `Vou precisar encerrar seu chamado por aqui para liberar a vaga de desconto do bairro ${lead.bairro || 'daí'}. Se ainda tiver interesse em reduzir custos fixos, me manda um "OI" agora!`;
            break;
    }

    if (msg) {
        await enviarComSimulacao(lead.whatsapp_id, msg);
        
        // Atualiza o passo e o timestamp no banco
        await supabase.from('leads')
            .update({ 
                followup_step: proximoPasso, 
                last_contact_at: new Date().toISOString() 
            })
            .eq('whatsapp_id', lead.whatsapp_id);

        await db.saveMessage(lead.whatsapp_id, 'assistant', msg);
        console.log(`[SDR] 🔄 Follow-up #${proximoPasso} enviado para ${lead.name}`);
    }

    // Agenda o próximo ciclo com delay humano
    setTimeout(loopDisparos, Math.random() * 20000 + 40000);
}

async function executarAbordagemInicial(lead) {
    const msgInicial = lead.dono 
        ? `Olá ${lead.dono.split(' ')[0]}, tudo bem? Sou da Enerzee.\n\nVi que a *${lead.name}* está no bairro ${lead.bairro || 'daí'}. Nossa missão é trocar seu boleto caro da concessionária por um até 25% mais barato via Ezee Connect[cite: 335, 1843]. Vocês já geram a própria energia?`
        : `Olá, bom dia. Gostaria de falar com o responsável pela *${lead.name}* sobre a redução de custos via Lei 14.300. É por aqui?`;

    await enviarComSimulacao(lead.whatsapp_id, msgInicial);
    await db.saveMessage(lead.whatsapp_id, 'assistant', msgInicial);
    console.log(`[SDR] 🚀 Abordagem inicial enviada para ${lead.name}`);
    
    setTimeout(loopDisparos, Math.random() * 20000 + 40000);
}

// Helper de simulação humana
async function enviarComSimulacao(zapId, msg) {
    try {
        const chat = await client.getChatById(zapId);
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, 4000));
        await client.sendMessage(zapId, msg);
    } catch (e) { console.error("Erro envio:", e.message); }
}

// ============================================================================
// 📡 EVENTOS DO WHATSAPP
// ============================================================================

client.on('qr', (qr) => {
    // Esta linha envia o código para o seu frontend React
    if (socketRef) {
        socketRef.emit('qr_code', qr); 
        console.log("🚀 QR Code enviado para o Frontend");
    }
    // Mantém o backup no terminal
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    isReady = true;
    if (socketRef) socketRef.emit('whatsapp_status', 'CONNECTED');
    loopDisparos();
});

// --- HELPER DE ATRASO HUMANO (Novo) ---
const delayHumano = (min = 10, max = 35) => {
    const ms = Math.floor(Math.random() * (max - min + 1) + min) * 1000;
    return new Promise(resolve => setTimeout(resolve, ms));
};

// --- MOTOR DE MENSAGENS COM TRAVA DE PAUSA (Substituto) ---
client.on('message', async (msg) => {
    if (msg.isGroupMsg) return;
    const zapId = msg.from;

    // 1. DETECÇÃO DE INTERVENÇÃO MANUAL: Se você mandar msg pelo celular, a IA pausa este lead
    if (msg.fromMe) {
        console.log(`[HUMANO] 👤 Intervenção manual detectada para ${zapId}. IA pausada.`);
        await supabase.from('leads').update({ is_paused: true }).eq('whatsapp_id', zapId);
        return;
    }

    // 2. COMANDOS DE REATIVAÇÃO
    if (msg.body === '#play') {
        await supabase.from('leads').update({ is_paused: false }).eq('whatsapp_id', zapId);
        return await msg.reply("🚀 IA Reativada. Voltarei a responder este lead.");
    }

    // 3. VERIFICA SE O LEAD ESTÁ EM PAUSA
    const { data: leadStatus } = await supabase.from('leads').select('is_paused').eq('whatsapp_id', zapId).single();
    if (leadStatus?.is_paused) return;

    // 4. LOG DE MENSAGEM RECEBIDA
    const { data: leadData } = await supabase.from('leads').select('*').eq('whatsapp_id', zapId).single();
    if (!leadData) return;

    // 5. DETECÇÃO DE FATURA (IA Vision / PDF)
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (msg.type === 'image') {
            const analise = await executarLeituraIA(media.data);
            if (analise) return await finalizarFluxoComercial(analise, msg, leadData);
        }
        if (msg.type === 'document' && media.mimetype === 'application/pdf') {
            const buffer = Buffer.from(media.data, 'base64');
            const pdfData = await pdf(buffer);
            const analise = await executarLeituraTextoIA(pdfData.text);
            if (analise) return await finalizarFluxoComercial(analise, msg, leadData);
        }
    }

    // 6. PROCESSAMENTO DE RESPOSTA TEXTUAL COM ATRASO HUMANO
    await db.saveMessage(zapId, 'user', msg.body);
    const chat = await msg.getChat();
    
    // Simula tempo de leitura
    await delayHumano(5, 12); 
    await chat.sendStateTyping();
    // Simula tempo de digitação
    await delayHumano(10, 20); 

    const historicoRaw = await supabase.from('messages').select('role, content').eq('whatsapp_id', zapId).order('created_at', { ascending: true });
    const historico = historicoRaw.data.map(m => ({ role: m.role, content: m.content }));
    const resposta = await gerarResposta(historico, leadData);
    
    if (resposta) {
        await client.sendMessage(zapId, resposta);
        await db.saveMessage(zapId, 'assistant', resposta);
    }
});

function iniciarSDR(socket) {
    socketRef = socket; // Garante que o robô use o canal de comunicação correto
    if (!isReady) {
        client.initialize().catch(err => console.error("Erro init WPP:", err));
    } else {
        socket.emit('whatsapp_status', 'CONNECTED');
    }
}

async function executarLeituraIA(base64Image) {
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Extraia desta fatura de energia brasileira em JSON: {concessionaria, valor_total, consumo_kwh, estado}. Responda apenas o JSON puro." },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                    ],
                },
            ],
            model: "llama-3.2-11b-vision-preview",
            temperature: 0,
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (e) { return null; }
}

function calcularEconomiaRegional(analise, lead) {
    const estadosTop = ['PE', 'BA', 'CE', 'MT', 'GO', 'MG', 'SP'];
    let percDesconto = 0.15; // Padrão 15% (Lei 14.300)

    if (estadosTop.includes(analise.estado)) percDesconto = 0.25; // 25% conforme Relação 2026
    if (analise.estado === 'PR') percDesconto = 0.16;

    const descontoReais = (analise.valor_total * percDesconto).toFixed(2);
    const valorFinal = (analise.valor_total - descontoReais).toFixed(2);
    return { descontoReais, valorFinal };
}

/**
 * EXTRAÇÃO DE DADOS DO TEXTO DO PDF (LLAMA 3.3)
 */
async function executarLeituraTextoIA(texto) {
    try {
        const completion = await groq.chat.completions.create({
            messages: [{
                role: "user",
                content: `Extraia os dados técnicos desta fatura e responda APENAS o JSON: {concessionaria, valor_total, consumo_kwh, estado}. \n\nTexto: ${texto.substring(0, 3000)}`
            }],
            model: "llama-3.3-70b-versatile",
            temperature: 0,
        });
        const raw = completion.choices[0].message.content;
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) { return null; }
}


/**
 * FINALIZAÇÃO COMERCIAL: ESTUDO DE VIABILIDADE EZEE CONNECT
 */
async function finalizarFluxoComercial(analise, msg, leadData) {
    const economia = calcularEconomiaRegional(analise, leadData);
    const chat = await msg.getChat();

    console.log(`[SDR] 🧠 Elaborando estudo para ${leadData.name}...`);
    
    // Simula o tempo de análise técnica (elaboração do estudo)
    await chat.sendStateTyping();
    await delayHumano(45, 80); 

    const estudoMsg = `📊 *ESTUDO DE VIABILIDADE ENERZEE* ⚡\n` +
                      `-------------------------------------------\n` +
                      `🏢 *Unidade:* ${leadData.name}\n` +
                      `📉 *Redução Estimada:* R$ ${economia.descontoReais}/mês\n` +
                      `✅ *Investimento:* ZERO (Modalidade Assinatura)\n\n` +
                      `Esse benefício é possível graças à *Lei 14.300 (Marco Legal da Energia)*. Ela é fundamental pois garante o direito de você compensar créditos de nossas usinas parceiras diretamente na sua conta, reduzindo seu custo sem precisar de obras ou telhado próprio.\n\n` +
                      `*${leadData.dono?.split(' ')[0] || 'Gestor'}*, para eu te mostrar como garantir sua cota e travar esse desconto antes que a grade regional complete, podemos fazer uma breve call de vídeo amanhã?`;

    await msg.reply(estudoMsg);
    await db.saveMessage(msg.from, 'assistant', estudoMsg);
    await supabase.from('leads').update({ status: 'waiting_analysis' }).eq('whatsapp_id', msg.from);
}



module.exports = { iniciarSDR, processarLeadEntrada: () => {} };