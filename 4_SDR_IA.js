/**
 * 🚀 SDR ULTIMATE V20 - MOTOR DE REDUÇÃO DE ENTROPIA
 * Autor: Marlon Lotici & Gemini
 * Funcionalidades: Disparo Sniper, Anti-Loop (Juiz IA), Escuta Ativa, Memória Blindada.
 */

const wppconnect = require('@wppconnect-team/wppconnect');
const Groq = require('groq-sdk');
const ExcelJS = require('exceljs');
const fs = require('fs');
require('dotenv').config();

// --- ⚙️ CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE ---
const API_KEY = process.env.GROQ_API_KEY;
const ARQUIVO_LEADS = 'LEADS_PREMIUM_FINAL.xlsx';
const HISTORICO_FILE = 'historico_envios.txt';
const MEMORIA_FILE = 'memoria_blindada.json';
const LINK_CALENDLY = "https://calendly.com/marlonlotici2/consultoria-energetica";

// Configuração GROQ (O Cérebro)
const groq = new Groq({ apiKey: API_KEY });
const MODELO_JUIZ = "llama-3.3-70b-versatile"; // Rápido e preciso para classificar
const MODELO_SDR = "llama-3.3-70b-versatile";  // Inteligente para negociar

// --- 📊 ESTADO GLOBAL (RAM) ---
let sessions = {};      // Histórico de conversas ativas
let messageBuffer = {}; // Acumulador de mensagens picadas
let timers = {};        // Temporizadores de delay
let leadsDb = {};       // Banco de dados em memória (Telefone -> Dados)
let isConnected = false;

// Dados que sobrevivem ao reinício (HD)
let dadosPersistentes = {
    blacklist: [],          // Robôs e pessoas que pediram para sair
    dataInicio: Date.now(),
    enviosHoje: 0,
    dataUltimoEnvio: new Date().toLocaleDateString()
};

// --- 🛡️ TRAVA DE SEGURANÇA INICIAL ---
if (!fs.existsSync(ARQUIVO_LEADS)) {
    console.log("\n❌ ERRO CRÍTICO: O arquivo de leads não existe!");
    process.exit(1);
}

// Rampa de Aquecimento (Proteção do Chip)
const RAMP_UP = [50, 90, 150, 250];

// Lista Rápida de Silêncio (Filtro Nível 1 - Regex Barato)
const PALAVRAS_DE_ROBO_OBVIAS = [
    'digite 1', 'digite 2', 'disque', 'protocolo', 'atendimento automatico', 
    'não reconheci', 'opção inválida', 'ura', 'tecle', 'menu principal'
];

// --- 🔧 FUNÇÕES AUXILIARES ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function carregarMemoria() {
    if (fs.existsSync(MEMORIA_FILE)) {
        try {
            const dados = JSON.parse(fs.readFileSync(MEMORIA_FILE));
            // Mescla dados garantindo que blacklist seja array
            dadosPersistentes = { ...dadosPersistentes, ...dados };
            if (!Array.isArray(dadosPersistentes.blacklist)) dadosPersistentes.blacklist = [];
        } catch (e) {
            console.error("⚠️ Erro ao ler memória. Criando nova.");
        }
    }
}

function salvarMemoria() {
    try { fs.writeFileSync(MEMORIA_FILE, JSON.stringify(dadosPersistentes, null, 2)); } catch (e) { console.error("Erro ao salvar memória", e); }
}

function prepararNumero(numero) {
    if (!numero) return null;
    let limpo = numero.toString().replace(/\D/g, '');
    if (limpo.startsWith('0')) limpo = limpo.substring(1);

    if (limpo.length === 8) return '55659' + limpo; // Ajuste DDD padrão se necessário
    if (limpo.length === 9) return '5565' + limpo;
    if (limpo.length >= 10 && limpo.length <= 11) return '55' + limpo;
    
    return null;
}

// --- 🧠 CÉREBRO 1: O JUIZ (CLASSIFICADOR DE CONTEXTO) ---
// Analisa se deve responder, bloquear ou corrigir rota.
async function analisarContexto(historicoMsg) {
    const promptClassificador = `
    ATUE COMO UM FILTRO DE SEGURANÇA PARA UM SDR NO WHATSAPP.
    Analise as mensagens recebidas. Responda APENAS com uma das tags:

    [ROBO] -> Se for URA, bot de banco/clínica, pede para digitar opção, protocolo, ou mensagens automáticas repetitivas.
    [CONFUSAO] -> Se a pessoa acha que é outra empresa (padaria, loja de roupas, engano), ou pergunta "quem é?", "é o fulano?".
    [NEGATIVO] -> Se disse "não tenho interesse", "pare", "retire meu número", "já tenho", "não quero".
    [SEGUIR] -> Conversa humana normal, dúvidas, interesse, "sim", "como funciona", ou silêncio neutro.

    Mensagens do Lead:
    """
    ${historicoMsg}
    """
    `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: "user", content: promptClassificador }],
            model: MODELO_JUIZ,
            temperature: 0, // Frieza total para decisão lógica
            max_tokens: 15
        });
        const tag = completion.choices[0]?.message?.content?.trim() || "[SEGUIR]";
        console.log(`⚖️ VEREDICTO DO JUIZ: ${tag}`);
        return tag;
    } catch (e) {
        console.error("Erro no Juiz:", e);
        return "[SEGUIR]"; // Fallback para não travar
    }
}

// --- 🧠 CÉREBRO 2: O SISTEMA SDR ---
const SYSTEM_PROMPT_TEMPLATE = `
### 🆔 POSTURA: CONSULTOR DE ELITE (ENERZEE)
Você é o assistente executivo de Marlon Lotici. Sua função é filtrar leads qualificados para energia solar (Lei 14.300) e agendar reuniões.
Você NÃO é uma IA genérica. Você é focado, educado e busca eficiência.

### 🛡️ PROTOCOLOS DE NAVEGAÇÃO
1. **Erro de Identidade:** Se acharem que você é da "padaria" ou outro lugar, corrija IMEDIATAMENTE: "Acho que houve um engano, aqui é o assistente do Marlon da Enerzee (Energia), não somos da padaria. Mas já que estamos aqui..."
2. **Objeção "Já tenho Solar":** Pergunte: "Que ótimo! Parabéns pela iniciativa. Foi investimento próprio ou financiado? (Foco em networking leve)". Se não houver abertura, encerre.
3. **Objeção "Não quero":** Responda: "Entendido. Agradeço a atenção. Sucesso!" e encerre.
4. **Detector de Robô:** Se parecer que está falando com uma máquina, digite apenas: "Vou registrar, obrigado."

### 💰 ROTEIRO DE VENDAS (SPIN SIMPLIFICADO)
- **Abertura:** Confirmar se a fatura passa de R$ 300.
- **Explicação:** "A Enerzee injeta energia limpa na rede e o crédito abate sua conta. Reduz custo fixo sem obras (Zero Capex)."
- **Fechamento:** "A ideia é só rodar uma simulação técnica. Faz sentido?" -> Se SIM -> Enviar Link Calendly.

### 🚫 REGRAS DE OURO
- NUNCA use "Prezado", "Cordialmente".
- NUNCA mande textos longos (máximo 2 frases curtas).
- Só mande o link do Calendly se houver sinal de interesse.

### 👤 DADOS DO LEAD
Nome: {{NOME_CLIENTE}}
Empresa: {{NOME_EMPRESA}}
Link Agenda: ${LINK_CALENDLY}
`;

// --- 📥 CARREGAMENTO DE DADOS ---
async function carregarDados() {
    carregarMemoria();
    
    // Reset diário de contadores
    const hojeStr = new Date().toLocaleDateString();
    if (dadosPersistentes.dataUltimoEnvio !== hojeStr) {
        dadosPersistentes.enviosHoje = 0;
        dadosPersistentes.dataUltimoEnvio = hojeStr;
        salvarMemoria();
    }

    const diasDecorridos = Math.floor((Date.now() - dadosPersistentes.dataInicio) / (1000 * 60 * 60 * 24));
    const limiteHoje = RAMP_UP[Math.min(diasDecorridos, RAMP_UP.length - 1)] || 250;
    
    console.log(`🔥 [SDR V20] Meta Hoje: ${limiteHoje} | Já Enviados: ${dadosPersistentes.enviosHoje}`);

    if (dadosPersistentes.enviosHoje >= limiteHoje) return { leadsParaDisparo: [], limiteHoje };

    let enviados = new Set(
        fs.existsSync(HISTORICO_FILE) 
        ? fs.readFileSync(HISTORICO_FILE, 'utf-8').split('\n').map(n => n.replace(/\D/g, '').slice(-8)) 
        : []
    );

    const leadsParaDisparo = [];
    
    if (fs.existsSync(ARQUIVO_LEADS)) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(ARQUIVO_LEADS);
        const worksheet = workbook.getWorksheet(1);
        
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const empresa = row.getCell(1).text;
            const nomeDono = row.getCell(4).text;
            const rawTel = row.getCell(6).text;
            
            let telPotencial = prepararNumero(rawTel);
            
            if (telPotencial) {
                // Popula o Banco de Dados em Memória para consultas futuras
                leadsDb[telPotencial] = { nome: nomeDono, empresa: empresa };
                
                const uniqueKey = telPotencial.slice(-8);
                // Só adiciona na lista de disparo se não foi enviado E não está na blacklist
                if (!enviados.has(uniqueKey) && !dadosPersistentes.blacklist.some(b => b.includes(uniqueKey))) {
                    leadsParaDisparo.push({ telefone: telPotencial, ...leadsDb[telPotencial] });
                }
            }
        });
    }
    return { leadsParaDisparo, limiteHoje };
}

// --- 🤖 LÓGICA DE ATENDIMENTO (SDR) ---
function configurarSDR(client) {
    client.onMessage(async (message) => {
        if (message.isGroupMsg || message.from === 'status@broadcast' || message.fromMe || !message.body) return;
        
        const chatId = message.from;
        const numZap = chatId.replace(/\D/g, '');

        // 🛑 FILTRO 1: Blacklist Persistente
        if (dadosPersistentes.blacklist.some(b => chatId.includes(b))) {
            console.log(`🚫 Bloqueado pela Blacklist: ${chatId}`);
            return;
        }

        // 🛑 FILTRO 2: Robôs Óbvios (Regex Rápido)
        const textoMsg = message.body.toLowerCase();
        if (PALAVRAS_DE_ROBO_OBVIAS.some(k => textoMsg.includes(k))) {
            console.log(`🤖 Bot detectado via Regex (${chatId}). Adicionando à Blacklist.`);
            dadosPersistentes.blacklist.push(chatId);
            salvarMemoria();
            return;
        }

        console.log(`📩 [LEAD ${chatId.substring(0,12)}]: ${message.body.substring(0, 50)}...`);

        // Buffer: Espera o usuário parar de digitar
        if (!messageBuffer[chatId]) messageBuffer[chatId] = [];
        messageBuffer[chatId].push(message.body);
        
        if (timers[chatId]) clearTimeout(timers[chatId]);

        timers[chatId] = setTimeout(async () => {
            const msgCompleta = messageBuffer[chatId].join(" | ");
            delete messageBuffer[chatId];
            
            // --- FASE 1: O JULGAMENTO ---
            // Recupera histórico recente para dar contexto ao juiz
            let historicoParaJuiz = msgCompleta;
            if(sessions[chatId]) {
                const ultimas = sessions[chatId].slice(-4).map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n");
                historicoParaJuiz = `${ultimas}\n[USER ATUAL]: ${msgCompleta}`;
            }

            const veredicto = await analisarContexto(historicoParaJuiz);

            // Ações baseadas no Juiz
            if (veredicto.includes("ROBO")) {
                console.log("🤖 Juiz detectou Robô. Block.");
                dadosPersistentes.blacklist.push(chatId);
                salvarMemoria();
                return;
            }

            if (veredicto.includes("NEGATIVO")) {
                console.log("🛑 Juiz detectou recusa. Encerrando.");
                await client.sendText(chatId, "Entendido. Não enviaremos mais mensagens. Agradeço a atenção!");
                dadosPersistentes.blacklist.push(chatId);
                salvarMemoria();
                return;
            }

            // --- FASE 2: A RESPOSTA (SDR) ---
            
            // Recupera dados do Lead (se existir no Excel)
            let lead = { nome: 'Gestor', empresa: 'sua empresa' };
            for (let key in leadsDb) { 
                if (numZap.includes(key.slice(-8))) { 
                    lead = leadsDb[key]; 
                    break; 
                } 
            }

            try {
                await client.sendSeen(chatId);
                await client.startTyping(chatId);

                // Inicializa sessão se não existir
                if (!sessions[chatId]) {
                    const prompt = SYSTEM_PROMPT_TEMPLATE
                        .replace(/{{NOME_CLIENTE}}/g, lead.nome || "Gestor")
                        .replace(/{{NOME_EMPRESA}}/g, lead.empresa || "sua empresa");
                    sessions[chatId] = [
                        { role: "system", content: prompt }
                    ];
                }

                // Injeção de Contexto (Correção de Rota)
                let inputUsuario = msgCompleta;
                if (veredicto.includes("CONFUSAO")) {
                    console.log("⚠️ Contexto de Confusão detectado. Injetando instrução de clareza.");
                    inputUsuario += " [SISTEMA: O LEAD PARECE CONFUSO SOBRE QUEM VOCÊ É (ACHA QUE É OUTRA PESSOA/EMPRESA). ESCLAREÇA QUE VOCÊ É O ASSISTENTE DO MARLON DA ENERZEE (ENERGIA) E PEÇA DESCULPAS PELA CONFUSÃO ANTES DE SEGUIR]";
                }

                sessions[chatId].push({ role: "user", content: inputUsuario });

                // Janela de Memória (Rolling Window - Últimas 20 mensagens)
                if (sessions[chatId].length > 22) {
                    sessions[chatId] = [sessions[chatId][0], ...sessions[chatId].slice(-20)];
                }

                // Chamada à API SDR
                const completion = await groq.chat.completions.create({
                    messages: sessions[chatId],
                    model: MODELO_SDR,
                    temperature: 0.2, // Baixa temperatura = Menos alucinação, mais foco
                    max_tokens: 300,
                });

                const respostaIA = completion.choices[0]?.message?.content || "";
                
                // Filtro final de segurança na resposta
                if (respostaIA.toLowerCase().includes("sou uma ia") || respostaIA.length < 2) {
                    console.log("⚠️ Resposta IA descartada por segurança.");
                    await client.stopTyping(chatId);
                    return;
                }

                sessions[chatId].push({ role: "assistant", content: respostaIA });

                if (respostaIA.includes("calendly")) console.log(`🎯 LINK ENVIADO PARA ${lead.nome}!`);

                // Delay Humanizado Dinâmico
                const delay = Math.min(Math.max(respostaIA.length * 40, 3000), 12000);
                await sleep(delay);

                await client.sendText(chatId, respostaIA);
                await client.stopTyping(chatId);

            } catch (err) { 
                console.error(`❌ Erro Processamento IA: ${err.message}`); 
                await client.stopTyping(chatId);
            }
        }, 8000); // 8 segundos de espera para agrupar mensagens
    });
}

// --- 🚀 DISPARADOR (MODO SNIPER) ---
async function iniciarCampanha(client, fila, limiteHoje) {
    console.log("🚀 Motor SDR V20 Ligado... Modo Sniper Ativado.");
    let indice = 0;
    
    // Termos que indicam nome genérico
    const TERMOS_GENERICOS = ['responsavel', 'responsável', 'admin', 'adm', 'contato', 'financeiro', 'comercial', 'gerente', 'gestor'];
    
    async function processarProximo() {
        if (!isConnected) { setTimeout(processarProximo, 5000); return; }

        // Horário Comercial (8h às 19h)
        const hora = new Date().getHours();
        if (hora < 8 || hora > 19) {
            console.log("🌙 Fora de horário. Pausando 15min...");
            setTimeout(processarProximo, 900000);
            return;
        }

        if (indice >= fila.length || dadosPersistentes.enviosHoje >= limiteHoje) { 
            console.log("💤 Fim do ciclo de disparos por hoje."); 
            return; 
        }
        
        const lead = fila[indice++];
        
        // Verifica blacklist antes de enviar
        if (dadosPersistentes.blacklist.some(b => lead.telefone.includes(b.replace(/\D/g, '').slice(-8)))) { 
            console.log(`⏩ Pulando Blacklist: ${lead.nome}`);
            setTimeout(processarProximo, 100); 
            return; 
        }

        console.log(`⚡ Disparando para: ${lead.nome} | ${lead.telefone}...`);

        try {
            // Lógica de Saudação Personalizada
            const nomeLimpo = (lead.nome || "").trim();
            const isGen = nomeLimpo.length < 3 || TERMOS_GENERICOS.some(t => nomeLimpo.toLowerCase().includes(t));
            const nomeF = nomeLimpo.split(' ')[0];
            const nomeTratado = nomeF.charAt(0).toUpperCase() + nomeF.slice(1).toLowerCase();

            const msg = isGen ? 
                `Olá, tudo bem? Gostaria de falar com o responsável pela *${lead.empresa}*. \n\nEstamos mapeando empresas na região com faturas de energia acima de R$ 300,00 para aplicação de créditos da Lei 14.300. Vocês se encaixam nesse perfil?` :
                `Olá ${nomeTratado}, tudo bem? Vi que a *${lead.empresa}* atua na região e gostaria de confirmar uma informação técnica: a fatura de energia de vocês costuma ficar acima de R$ 300,00? \n\nA Enerzee liberou uma cota de créditos que reduz o custo sem necessidade de obras.`;

            // Envio Direto (Sniper - Sem Typing no primeiro contato para parecer notificação real)
            const idAlvo = lead.telefone + '@c.us';
            await client.sendText(idAlvo, msg);

            // Registro de Sucesso
            gravarSucesso(idAlvo, msg, lead);
            console.log(`   ✅ ENVIADO!`);
            
            // Intervalo Aleatório (40s a 90s) para evitar bloqueio do WhatsApp
            const intervalo = Math.floor(Math.random() * 50000) + 40000;
            setTimeout(processarProximo, intervalo);

        } catch (erro) {
            // Tratamento de Erro (Double Tap - Tenta sem o 9 se falhar)
            if (erro.message && (erro.message.includes('Chat not found') || erro.message.includes('invalid'))) {
                if (lead.telefone.length === 13 && lead.telefone[4] === '9') {
                    console.log(`   ⚠️ Tentando sem o nono dígito...`);
                    const semNove = lead.telefone.substring(0, 4) + lead.telefone.substring(5);
                    const idSemNove = semNove + '@c.us';

                    try {
                        await sleep(1000);
                        await client.sendText(idSemNove, msg); 
                        gravarSucesso(idSemNove, msg, lead);
                        console.log(`   ✅ ENVIADO (Sem 9)!`);
                        setTimeout(processarProximo, Math.floor(Math.random() * 50000) + 40000);
                    } catch (e2) {
                        console.log(`   🚫 Número inválido definitivo.`);
                        fs.appendFileSync(HISTORICO_FILE, lead.telefone + '\n');
                        setTimeout(processarProximo, 1000);
                    }
                } else {
                    console.log(`   🚫 Falha no envio.`);
                    fs.appendFileSync(HISTORICO_FILE, lead.telefone + '\n');
                    setTimeout(processarProximo, 1000);
                }
            } else {
                console.log(`   ❌ Erro técnico: ${erro.message}`);
                setTimeout(processarProximo, 5000);
            }
        }
    }
    
    function gravarSucesso(id, msg, lead) {
        // Cria a sessão inicial na memória da IA para ela saber o que foi enviado
        if (!sessions[id]) {
             const prompt = SYSTEM_PROMPT_TEMPLATE
                .replace(/{{NOME_CLIENTE}}/g, lead.nome)
                .replace(/{{NOME_EMPRESA}}/g, lead.empresa);
             sessions[id] = [{ role: "system", content: prompt }, { role: "assistant", content: msg }];
        }
        
        // Registra no arquivo para não repetir
        fs.appendFileSync(HISTORICO_FILE, id.replace(/\D/g, '') + '\n');
        dadosPersistentes.enviosHoje++;
        salvarMemoria();
    }
    
    processarProximo();
}

// --- 🔌 INICIALIZAÇÃO DO MOTOR ---
(async () => {
    try {
        const { leadsParaDisparo, limiteHoje } = await carregarDados();
        
        wppconnect.create({
            session: 'sessao-sdr-ultimate-v20', // Nome da sessão atualizada
            headless: true, 
            autoClose: 0, 
            tokenStore: 'file', 
            folderNameToken: 'tokens',
            browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
            // Opcional: injetar configurações para parecer mais humano
            disableWelcome: true
        }).then(client => { 
            isConnected = true; 
            configurarSDR(client); 
            iniciarCampanha(client, leadsParaDisparo, limiteHoje); 
        });
    } catch (e) {
        console.error("Erro fatal na inicialização:", e);
    }
})();