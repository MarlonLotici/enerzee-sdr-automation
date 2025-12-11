const wppconnect = require('@wppconnect-team/wppconnect');
const Groq = require('groq-sdk');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config(); 

// --- ⚙️ CONFIGURAÇÕES ---
const API_KEY = process.env.GROQ_API_KEY;
const NUMERO_ADMIN = "5546999201690@c.us"; 
const WEBHOOK_CRM = ""; 
const ARQUIVO_LEADS = 'LEADS_PREMIUM_FINAL.xlsx'; 
const HISTORICO_FILE = 'historico_envios.txt';
const MEMORIA_FILE = 'memoria_blindada.json'; 
const AUDIO_ORIGINAL = 'audio_pr.mp3'; 

// Rampa de Aquecimento
const RAMP_UP = [60, 80, 100, 150]; 

// --- 🧠 CÉREBRO SDR V20.0 ---
const SYSTEM_PROMPT_TEMPLATE = `
### 🆔 IDENTIDADE
Você é o "Consultor Especialista" da ENERZEE.
Produto: EZEE CONNECT (Energia por Assinatura / Geração Distribuída).
Cenário: Você já mandou a primeira mensagem de texto e o cliente respondeu.
Tom: Executivo, Direto e Seguro.

### 👤 DADOS DO LEAD
Nome: {{NOME_CLIENTE}}
Empresa: {{NOME_EMPRESA}}

---

### 🧠 NEUROVENDAS (DIRETRIZES)
1. **ESPELHAMENTO:** Se o cliente for breve, seja breve. Se perguntar detalhes, explique.
2. **NÃO SEJA CHATO:** Não implore. Você está oferecendo dinheiro (economia). Aja como quem seleciona o cliente.

---

### 🚫 FILTROS DE DESQUALIFICAÇÃO (KNOCK-OUT)
Encerre educadamente (sem vender) se:
1. **JÁ TEM BENEFÍCIO:** Solar, usina própria ou outro desconto ativo.
   - *Resposta:* "Entendi! Como já possui compensação ativa, a regulação não permite acumular descontos. Parabéns pela gestão!"
2. **OUTRA CONCESSIONÁRIA:** Não é CEMIG.
   - *Resposta:* "Poxa, nossa operação atual é exclusiva na área da CEMIG. Agradeço seu contato!"

---

### 💎 TRATAMENTO VIP (MERCADO LIVRE / GRUPO A)
Se citar "Mercado Livre", "Alta Tensão" ou "Conta > 10k":
- **OFERTA:** Desconto de **ATÉ 30%**.
- *Argumento:* "Para o perfil da {{NOME_EMPRESA}} (Grupo A), temos uma modelagem exclusiva de performance."

---

### 🛡️ MATRIZ DE RESPOSTAS BLINDADA
**1. "QUERO POR E-MAIL"** -> "Por segurança de dados (Compliance), apresentamos os estudos e contratos **exclusivamente na tela da reunião de vídeo**."
**2. "É GOLPE?"** -> "Entendo a cautela. Operamos sob a **Lei 14.300** e fiscalização da **ANEEL**. A CEMIG é obrigada a aceitar."
**3. "QUANTO CUSTA?"** -> "Zero investimento. Não tem obra nem taxa de adesão."
**4. "GATEKEEPER"** -> "Tenho um benefício jurídico para reduzir o custo fixo da {{NOME_EMPRESA}}. Preciso validar com o financeiro."

---

### 🚀 FECHAMENTO (AGENDAMENTO)
**GATILHO DE LINK:** Se o cliente mostrar interesse ("sim", "quero", "ok"):
"Perfeito! Segue a agenda oficial do Marlon. Escolha o melhor horário:
🔗 https://calendly.com/marlonlotici2/consultoria-energetica"

**VALIDAÇÃO:** "{{NOME_CLIENTE}}, faz sentido reservarmos 15 minutos para validarmos essa redução de até 30%?"

**REGRAS FINAIS:** Reunião SEMPRE ONLINE. Especialista é o MARLON.
`;

// Inicializa Groq
const groq = new Groq({ apiKey: API_KEY });
const MODELO_IA = "llama-3.3-70b-versatile"; 

// Estado Global
let sessions = {}; 
let messageBuffer = {}; 
let timers = {}; 
let leadsDb = {}; 
let dadosPersistentes = {
    blacklist: [],
    dataInicio: Date.now(),
    enviosHoje: 0,
    dataUltimoEnvio: new Date().toLocaleDateString()
};
let isConnected = false;

// --- FUNÇÕES UTILITÁRIAS ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function carregarMemoria() {
    if (fs.existsSync(MEMORIA_FILE)) {
        try {
            const dados = JSON.parse(fs.readFileSync(MEMORIA_FILE));
            dadosPersistentes = { ...dadosPersistentes, ...dados };
            const hoje = new Date().toLocaleDateString();
            if (dadosPersistentes.dataUltimoEnvio !== hoje) {
                dadosPersistentes.enviosHoje = 0;
                dadosPersistentes.dataUltimoEnvio = hoje;
                salvarMemoria();
            }
        } catch (e) { console.error("Erro memória:", e); }
    }
}

function salvarMemoria() {
    const tempFile = `${MEMORIA_FILE}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify(dadosPersistentes, null, 2));
        fs.renameSync(tempFile, MEMORIA_FILE);
    } catch (e) { console.error("❌ Erro salvar memória:", e); }
}

// 🛡️ LIMPEZA DE NÚMERO
function sanitizarNumero(numero) {
    if (!numero) return null;
    let limpo = numero.toString().replace(/\D/g, ''); 
    return limpo;
}

// 🧠 VALIDAÇÃO INTELIGENTE
async function validarNumeroNoWpp(client, telefoneBase) {
    const tentativas = [];
    tentativas.push(telefoneBase);
    if (!telefoneBase.startsWith('55')) {
        tentativas.push('55' + telefoneBase);
    }

    for (const num of tentativas) {
        try {
            const check = await client.checkNumberStatus(num + '@c.us');
            if (check.numberExists && check.id && check.id._serialized) {
                return check.id._serialized; 
            }
        } catch (e) { }
    }
    return null;
}

async function notificarCRM(tipo, lead, motivo) {
    if (!WEBHOOK_CRM) return;
    try {
        await fetch(WEBHOOK_CRM, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                tipo, nome: lead.nome, empresa: lead.empresa,
                telefone: lead.telefone, motivo, data: new Date().toISOString()
            })
        });
    } catch (e) { }
}

// --- 1. CARREGAMENTO DE DADOS (SEM FILTRO FORÇADO DE GESTOR) ---
async function carregarDados() {
    carregarMemoria();
    const diasDecorridos = Math.floor((Date.now() - dadosPersistentes.dataInicio) / (1000 * 60 * 60 * 24));
    const limiteHoje = RAMP_UP[diasDecorridos] || 150;
    
    console.log(`🔥 Dia ${diasDecorridos + 1} | Envios permitidos: ${dadosPersistentes.enviosHoje}/${limiteHoje}`);

    if (dadosPersistentes.enviosHoje >= limiteHoje) {
        console.log("🛑 Limite diário atingido.");
        return { leadsParaDisparo: [], limiteHoje };
    }

    let enviadosRaw = [];
    if (fs.existsSync(HISTORICO_FILE)) {
        enviadosRaw = fs.readFileSync(HISTORICO_FILE, 'utf-8').split('\n');
    }
    const enviados = new Set(enviadosRaw.map(n => n.replace(/\D/g, '').slice(-8)));

    const leadsParaDisparo = [];
    
    if (fs.existsSync(ARQUIVO_LEADS)) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(ARQUIVO_LEADS);
        const worksheet = workbook.getWorksheet(1);
        
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const empresa = row.getCell(1).text || 'sua empresa';
            const telMaps = row.getCell(2).text;
            const nomeDono = row.getCell(3).text; // Pega o nome cru (pode ser "Responsável")
            const telExtra = row.getCell(4).text;

            let telAlvo = sanitizarNumero(telExtra || telMaps);

            if (telAlvo && telAlvo.length >= 8) {
                const uniqueKey = telAlvo.slice(-8);
                if (!enviados.has(uniqueKey)) {
                    // Mantém o nome original no banco de dados para o SDR usar
                    leadsDb[telAlvo] = { nome: nomeDono, empresa: empresa };
                    leadsParaDisparo.push({ telefone: telAlvo, ...leadsDb[telAlvo] });
                }
            }
        });
    } else { console.log(`❌ Arquivo ${ARQUIVO_LEADS} não encontrado.`); }

    return { leadsParaDisparo, limiteHoje };
}

// --- 2. SDR INTELIGENTE ---
function configurarSDR(client) {
    client.onMessage(async (message) => {
        if (message.isGroupMsg || message.from === 'status@broadcast' || message.fromMe || !message.body) return;
        
        const chatId = message.from;
        if (dadosPersistentes.blacklist.includes(chatId)) return;

        console.log(`📩 [SDR] Msg de ${chatId}: ${message.body.substring(0, 50)}...`);

        if (!messageBuffer[chatId]) messageBuffer[chatId] = [];
        messageBuffer[chatId].push(message.body);
        if (timers[chatId]) clearTimeout(timers[chatId]);

        timers[chatId] = setTimeout(async () => {
            const msgCompleta = messageBuffer[chatId].join(" | ");
            delete messageBuffer[chatId];
            delete timers[chatId];

            let lead = { nome: 'Parceiro', empresa: 'sua empresa' };
            const numPuro = chatId.replace(/\D/g, '');
            for (const key in leadsDb) {
                if (numPuro.includes(key.slice(-8))) {
                    lead = leadsDb[key];
                    break;
                }
            }

            try {
                await client.sendSeen(chatId);
                await client.startTyping(chatId).catch(()=>{});

                if (!sessions[chatId]) {
                    console.log(`🧠 Cérebro ativado para: ${lead.nome}`);
                    const promptPersonalizado = SYSTEM_PROMPT_TEMPLATE
                        .replace('{{NOME_CLIENTE}}', lead.nome)
                        .replace('{{NOME_EMPRESA}}', lead.empresa);

                    sessions[chatId] = [{ role: "system", content: promptPersonalizado }];
                }

                sessions[chatId].push({ role: "user", content: msgCompleta });

                if (sessions[chatId].length > 12) {
                    sessions[chatId] = [sessions[chatId][0], ...sessions[chatId].slice(-10)];
                }

                const completion = await groq.chat.completions.create({
                    messages: sessions[chatId],
                    model: MODELO_IA,
                    temperature: 0.5,
                    max_tokens: 350,
                });

                const respostaIA = completion.choices[0]?.message?.content || "";
                sessions[chatId].push({ role: "assistant", content: respostaIA });

                if (respostaIA.includes("HANDOVER")) {
                    await client.sendText(chatId, "Entendi. Vou pedir para o Marlon te explicar por áudio. Só um instante! 👍");
                    dadosPersistentes.blacklist.push(chatId);
                    salvarMemoria();
                    notificarCRM('HANDOVER', lead, 'Humano Solicitado');
                    delete sessions[chatId];
                    return;
                }

                if (respostaIA.includes("calendly.com")) {
                    notificarCRM('LINK_ENVIADO', lead, 'Sucesso');
                }

                const delay = Math.min(respostaIA.length * 40, 6000);
                await sleep(delay);
                await client.sendText(chatId, respostaIA);
                await client.stopTyping(chatId).catch(()=>{});

            } catch (err) {
                console.error(`❌ Erro SDR: ${err.message}`);
            }
        }, 5000);
    });
}

// --- 3. DISPARADOR ATIVO (LÓGICA DE ABORDAGEM INTELIGENTE) ---
async function iniciarCampanha(client, fila, limiteHoje) {
    console.log("🚀 Motor de disparos ligado...");
    let indice = 0;
    
    async function processarProximo() {
        if (!isConnected) { console.log("⚠️ Aguardando conexão..."); setTimeout(processarProximo, 5000); return; }
        if (indice >= fila.length) { console.log("💤 Fim da lista."); return; }
        if (dadosPersistentes.enviosHoje >= limiteHoje) { console.log("🛑 Limite diário atingido."); return; }

        const lead = fila[indice];
        indice++;

        if (dadosPersistentes.blacklist.some(b => b.includes(lead.telefone.slice(-8)))) {
            setTimeout(processarProximo, 100); return;
        }

        console.log(`➡️ Processando: ${lead.nome} (${lead.telefone})...`);

        try {
            const idCorreto = await validarNumeroNoWpp(client, lead.telefone);
            
            if (idCorreto) {
                console.log(`   ✅ ID Validado: ${idCorreto}`);
                
                await client.startTyping(idCorreto).catch(()=>{}); 
                await sleep(4000); 
                await client.stopTyping(idCorreto).catch(()=>{});
                
                // --- DEFINIÇÃO DA MENSAGEM ---
                let mensagemInicial = "";
                const termosGenericos = ['responsável', 'responsavel', 'contato', 'admin', 'financeiro', 'comercial', 'empreendedor', 'gestor'];
                
                // Verifica se o nome é genérico ou vazio
                const isGenerico = !lead.nome || termosGenericos.some(t => lead.nome.toLowerCase().includes(t));

                if (isGenerico) {
                    // ABORDAGEM DE GATEKEEPER (QUANDO NÃO SABEMOS O NOME)
                    mensagemInicial = `Olá, tudo bem? \n\nGostaria de falar com o responsável ou proprietário pela ${lead.empresa}.\n\nNossa análise de rede indicou um consumo de energia relevante na unidade de vocês. Temos uma modalidade para reduzir esse custo da CEMIG sem investimento.\n\nPodemos conversar rapidinho?`;
                } else {
                    // ABORDAGEM PESSOAL (QUANDO SABEMOS O NOME REAL)
                    const primeiroNome = lead.nome.split(' ')[0];
                    mensagemInicial = `Olá ${primeiroNome}, tudo bem? \n\nEstou tentando contato com o responsável pela ${lead.empresa}.\n\nNossa análise de rede indicou um consumo de energia relevante na unidade de vocês. Temos uma modalidade para reduzir esse custo da CEMIG sem investimento.\n\nPodemos conversar rapidinho?`;
                }

                await client.sendText(idCorreto, mensagemInicial);

                const numeroPuro = idCorreto.replace(/\D/g, '');
                fs.appendFileSync(HISTORICO_FILE, numeroPuro + '\n');
                dadosPersistentes.enviosHoje++;
                salvarMemoria();
                console.log(`   🚀 Texto Enviado! (${dadosPersistentes.enviosHoje}/${limiteHoje})`);

                const tempoEspera = Math.floor(Math.random() * (120000 - 60000 + 1)) + 60000; 
                console.log(`   ⏳ Aguardando ${Math.floor(tempoEspera/1000)}s...`);
                
                setTimeout(processarProximo, tempoEspera);

            } else {
                console.log(`   🚫 Inválido.`);
                fs.appendFileSync(HISTORICO_FILE, lead.telefone + '\n');
                setTimeout(processarProximo, 1000);
            }
        } catch (erro) {
            console.log(`   ❌ Erro técnico: ${erro.message}`);
            setTimeout(processarProximo, 5000);
        }
    }
    processarProximo();
}

// --- INICIALIZAÇÃO ROBUSTA ---
(async () => {
    try {
        const { leadsParaDisparo, limiteHoje } = await carregarDados();
        console.log('✅ Dados carregados. Iniciando WPPConnect...');

        wppconnect.create({
            session: 'sessao-final-v20', // Nova Sessão
            headless: false,
            logQR: true,
            catchQR: (base64Qr, asciiQR) => { console.log(asciiQR); },
            autoClose: 0,
            qrTimeout: 0, 
            authTimeout: 0, 
            useChrome: false, 
            browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
        })
        .then((client) => {
            console.log('\n✅ ROBÔ INICIADO E PRONTO!');
            isConnected = true;
            client.onStateChange((state) => {
                console.log('Status:', state);
                isConnected = (state === 'CONNECTED');
            });
            configurarSDR(client);
            iniciarCampanha(client, leadsParaDisparo, limiteHoje);
        })
        .catch((error) => console.log("Erro WPPConnect:", error));

    } catch (e) {
        console.error("Erro Geral:", e);
    }
})();

// --- GARBAGE COLLECTOR ---
setInterval(() => {
}, 60 * 60 * 1000);