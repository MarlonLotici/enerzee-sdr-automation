/**
 * 
 * 4_sdr.js - MÓDULO DE VENDAS NEURAL V12 (BAILEYS MULTI-TENANCY)
 * INTEGRAL: Vision, PDF, Regras Regionais Enerzee, Anti-Ban e Horários.
 */
// 🚀 FIX V13: Declaração global para injeção dinâmica (Bypass do erro ESM)
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage, generateMessageID;

const pino = require('pino');
const fs = require('fs');
const Groq = require('groq-sdk');
const pdf = require('pdf-parse');
const db = require('./database');
const { useSupabaseAuthState } = require('./auth_adapter');
const { gerarAudioTTS } = require('./tts');
const { createClient } = require('@supabase/supabase-js');
const routerAgent = require('./agents/routerAgent'); // faz a distribuição entre os agentes dependendo da necessidade 
const closerAgent = require('./agents/closerAgent'); //é o closer que assume a conversa
const intelAgent = require('./agents/intelAgent'); // 
const profilerAgent = require('./agents/profilerAgent'); // identifica o perfil do lead 
const objectionAgent = require('./agents/objectionAgent'); // esse agente assume o controle quando o router identifica objeção 
const auditorAgent = require('./agents/auditorAgent'); // faz auditoria das conversas como um 'juiz'
const handoffAgent = require('./agents/handoffAgent');
const motoresEmExecucao = new Set(); // 🛡️ Impede que o mesmo chip ligue dois loops infinitos
const { useRedisAuthState, clearRedisSession } = require('./auth_redis_adapter');
const { enviarAlerta } = require('./notifier');
const { getNicheData, inicializarCache } = require('./nicheCache');
const instanciasEncerrandoManualmente = new Set(); // 🛑 Flag para silenciar alertas no Discord ao remover chip
const MAPA_CONCESSIONARIAS = {
    'MT': 'Energisa', 'MS': 'Energisa', 'SC': 'Celesc', 'PR': 'Copel',
    'RS': 'RGE/Ceee', 'BA': 'Coelba', 'PE': 'Neoenergia', 'MG': 'Cemig',
    'CE': 'Enel', 'PA': 'Equatorial', 'GO': 'Equatorial', 'RJ': 'Light/Enel', 'SP': 'Enel/CPFL'
};
// 🎯 FIX #12: Percentuais REAIS por estado (substitui o 20% fixo do prompt)
const MAPA_DESCONTO_REGIONAL = {
    'PE': 0.25, 'BA': 0.25, 'CE': 0.25, 'MG': 0.25,
    'MT': 0.15, 'MS': 0.15, 'GO': 0.15, 'PA': 0.15,
    'PR': 0.16,
    'SC': 0.12, 'RS': 0.12,
    'SP': 0.15, 'RJ': 0.15
};

// 🎯 FIX #11: Contexto por nicho — injeta vocabulário do setor no prompt
function gerarContextoNicho(niche) {
    if (!niche) return '';
    const n = niche.toLowerCase();
    if (n.includes('restaurante') || n.includes('alimenta') || n.includes('padaria') || n.includes('lanchonete'))
        return '\nCONTEXTO DE NICHO: Empresa do ramo alimentício. Mencione custos de câmara fria, forno elétrico, coifa. Use "o gasto com energia na cozinha industrial".';
    if (n.includes('oficina') || n.includes('auto') || n.includes('mecânic'))
        return '\nCONTEXTO DE NICHO: Oficina mecânica/auto center. Mencione compressor, elevador, ar comprimido. Use "equipamento pesado puxa muita energia".';
    if (n.includes('salão') || n.includes('beleza') || n.includes('estétic') || n.includes('barbearia'))
        return '\nCONTEXTO DE NICHO: Salão de beleza/estética. Mencione secador, chapinha, ar condicionado. Use "ar condicionado ligado o dia todo".';
    if (n.includes('mercado') || n.includes('super') || n.includes('minimercado'))
        return '\nCONTEXTO DE NICHO: Supermercado/mercado. Mencione freezers, câmaras frias, iluminação. Use "freezer funcionando 24h consome muito".';
    if (n.includes('hotel') || n.includes('pousada') || n.includes('hosped'))
        return '\nCONTEXTO DE NICHO: Hotelaria/pousada. Mencione ar condicionado dos quartos, lavanderia, iluminação. Use "com vários quartos climatizados".';
    if (n.includes('farmácia') || n.includes('drogaria'))
        return '\nCONTEXTO DE NICHO: Farmácia. Mencione refrigeração de medicamentos, ar condicionado, iluminação. Use "refrigeração obrigatória consome bastante".';
    return `\nCONTEXTO DE NICHO: Empresa do ramo de ${niche}. Adapte a linguagem ao setor quando possível.`;
}

function identificarArtigo(nome) {
    if (!nome) return "do responsável pela";
    const nomeLimpo = nome.trim().toLowerCase();
    const ehFeminino = nomeLimpo.endsWith('a') || nomeLimpo.endsWith('as');
    return ehFeminino ? `da ${nome}` : `do ${nome}`;
}


// 👤 FILTRO DE IDENTIDADE HUMANA: Valida se o nome do WhatsApp é realmente de uma pessoa
function extrairNomeHumano(pushName) {
    if (!pushName) return null;

    // 1. Remove emojis e caracteres estranhos, deixando só letras e espaços
    let nomeLimpo = pushName.replace(/[^\p{L}\s]/gu, '').trim();
    if (!nomeLimpo || nomeLimpo.length < 2) return null;

    // 2. Pega só a primeira palavra para evitar nomes longos ou compostos estranhos
    const primeiroNome = nomeLimpo.split(/\s+/)[0].toLowerCase();

    // 3. Blacklist de palavras que parecem empresa ou lixo
    const palavrasProibidas = [
        'ltda', 'me', 'epp', 'eireli', 'mei', 'sa', 'loja', 'store', 'modas', 
        'pizzaria', 'lanchonete', 'hamburgueria', 'padaria', 'restaurante', 
        'oficina', 'mecanica', 'auto', 'center', 'estetica', 'salao', 'clinica', 
        'farmacia', 'drogaria', 'imoveis', 'imobiliaria', 'tech', 'info', 'cell', 
        'imports', 'atacado', 'varejo', 'distribuidora', 'comercio', 'servicos',
        'adm', 'financeiro', 'vendas', 'atendimento', 'suporte', 'contato'
    ];

    if (palavrasProibidas.includes(primeiroNome)) return null;

    // 4. Retorna o nome com a primeira letra maiúscula (Ex: "joão" -> "João")
    return primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);
}

// ✂️ LÂMINA DE CORTE: Transforma "Merci Delicatessen Restaurante e Pizzaria LTDA" em "Merci Delicatessen"
function limparNomeEmpresa(nomeOriginal) {
    if (!nomeOriginal) return "sua empresa";
    
    // 1. Remove lixo jurídico imediatamente
    let nomeLimpo = nomeOriginal.replace(/\b(LTDA|ME|EPP|EIRELI|S\.A|SA|S\/A|LIMITED|MEI|- ME|- EPP)\b/gi, '').trim();
    
    // 2. Quebra em palavras
    const palavras = nomeLimpo.split(/\s+/);
    
    // 3. Se for um nome gigante, corta na segunda ou terceira palavra
    if (palavras.length > 2) {
        // Ignora conectivos comuns ao contar o tamanho
        const stopWords = ['e', 'do', 'da', 'de', 'dos', 'das', 'em', 'no', 'na'];
        let limite = 2;
        
        // Se a segunda palavra for um conectivo (ex: "Pizzaria do João"), pegamos 3 palavras
        if (stopWords.includes(palavras[1].toLowerCase())) {
            limite = 3;
        }
        
        return palavras.slice(0, limite).join(' ');
    }
    
    return nomeLimpo;
}

// 🎯 NOVA FUNÇÃO: Chute de conta baseado em Capital Social e Nicho
function calcularAncoraDinamica(lead) {
    const capital = lead.capital_social_numeric || 0;
    const nicho = (lead.niche || "").toLowerCase();
    
    // Lista de nichos que são "Vilões de Energia" (Refrigeração/Motores)
    const nichosPesados = ['acougue', 'açougue', 'mercado', 'supermercado', 'padaria', 'panificadora', 'sorveteria', 'industria', 'frigorifico', 'conveniencia', 'lavanderia', 'marcenaria'];
    const ePesado = nichosPesados.some(n => nicho.includes(n));

    // NÍVEL 1: Gigantes (Capital > 500k)
    if (capital >= 500000) return "R$ 10.000";

    // NÍVEL 2: Médio-Grande (Capital 150k - 500k)
    if (capital >= 150000) return ePesado ? "R$ 5.000" : "R$ 3.000";

    // NÍVEL 3: Estrutura Operacional (Capital 50k - 150k)
    if (capital >= 50000) return ePesado ? "R$ 2.500" : "R$ 1.500";

    // NÍVEL 4: Pequeno Varejo / ME (Capital < 50k)
    if (ePesado) return "R$ 1.200";

    // PADRÃO (Escritórios, lojas secas, etc)
    return "R$ 700";
}
// 🕒 CONFIGURAÇÃO DE CICLO DE TRABALHO (Fadiga)
const HORAS_DE_TRABALHO = 2; // X horas disparando
const MINUTOS_DE_DESCANSO = 40; // X minutos parado em repouso
const controleFadiga = new Map(); // Armazena o início do turno de cada chip

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

// === INÍCIO CONFIG REDIS & BULLMQ ===
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');

const redisConnection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null
});

const filaMensagensIA = new Queue('FilaIA', { connection: redisConnection });
// === FIM CONFIG REDIS & BULLMQ ===



// --- TRAVA DE SEGURANÇA (MEMÓRIA VIVA) ---
const leadsEmProcessamento = new Set();
const mensagensEnviadasPelaIA = new Set(); // 🛡️ PASSO 1: A Memória Anti-Eco do Robô
const iaRespondendo = new Set();
const mapaRastreioLID = new Map();
const gavetaDeMensagens = new Map(); // 🧠 OUVIDO PACIENTE: Gaveta temporária de mensagens
const cacheRegrasInstancia = new Map(); // 🧠 Memória de curto prazo para regras
const cacheAvisosMidia = new Map(); // 🛡️ TTL 5min — previne race condition em flood de fotos/catálogos
let sdrEventsGlobal = null; // 🛡️ Adicione esta linha aqui no topo

// ============================================================================
// 🚦 SEMÁFORO DE CHIPS — Sistema de prioridade tática anti-ban
// Garante que apenas 1 disparo por chip aconteça a cada COOLDOWN_MS
// E que disparos de SAUDAÇÃO tenham prioridade sobre FOLLOW-UPs
// ============================================================================
const semaforoChips = new Map(); // chipId → { ocupado: boolean, ultimoDisparo: timestamp, prioridadeAtual: 'SAUDACAO'|'RECUPERACAO'|'FOLLOWUP' }
const COOLDOWN_ENTRE_DISPAROS_MS = 90000; // Mínimo 90s entre QUALQUER mensagem do mesmo chip

// Mapa de prioridades (menor número = mais importante)
const PRIORIDADE = {
    SAUDACAO: 1,        // 🟢 Saudação inicial — onde acontece a venda
    RECUPERACAO: 2,     // 🟡 Resposta atrasada a lead esperando
    FOLLOWUP: 3,        // 🟠 Follow-up D1 — risco de ban
    FOLLOWUP_LINK: 4    // 🟠 Follow-up de link abandonado — risco de ban
};

/**
 * 🚦 Tenta adquirir o semáforo do chip. Retorna true se conseguiu, false se outro disparo de prioridade igual ou maior está em andamento.
 * 
 * Regras:
 * - Se o chip está livre → adquire e retorna true
 * - Se o chip está ocupado com prioridade MENOR (número MAIOR) → expulsa o atual e adquire
 * - Se o chip está ocupado com prioridade IGUAL ou MAIOR → retorna false (espera ou aborta)
 * - Se ainda não passou o cooldown → retorna false
 */
async function adquirirSemaforoChip(chipId, tipoDisparo) {
    const agora = Date.now();
    const estado = semaforoChips.get(chipId);
    const minhaPrioridade = PRIORIDADE[tipoDisparo];
    
    // 1. Verifica cooldown global
    if (estado?.ultimoDisparo && (agora - estado.ultimoDisparo) < COOLDOWN_ENTRE_DISPAROS_MS) {
        const tempoRestante = Math.round((COOLDOWN_ENTRE_DISPAROS_MS - (agora - estado.ultimoDisparo)) / 1000);
        console.log(`⏸️ [SEMÁFORO] Chip ${chipId.substring(0, 8)} em cooldown. ${tempoRestante}s restantes (tipo: ${tipoDisparo}).`);
        return false;
    }
    
    // 2. Se está ocupado, verifica prioridade
    if (estado?.ocupado) {
        const prioridadeAtual = PRIORIDADE[estado.prioridadeAtual] || 99;
        
        if (minhaPrioridade < prioridadeAtual) {
            console.log(`🟢 [SEMÁFORO] ${tipoDisparo} (P${minhaPrioridade}) tomando vaga de ${estado.prioridadeAtual} (P${prioridadeAtual}) no chip ${chipId.substring(0, 8)}.`);
            // Saudação chegou? Toma a vaga!
        } else {
            console.log(`🔒 [SEMÁFORO] Chip ${chipId.substring(0, 8)} ocupado com ${estado.prioridadeAtual}. ${tipoDisparo} aguarda.`);
            return false;
        }
    }
    
    // 3. Adquire o semáforo
    semaforoChips.set(chipId, {
        ocupado: true,
        ultimoDisparo: estado?.ultimoDisparo || 0, // Mantém o último até o disparo concluir
        prioridadeAtual: tipoDisparo
    });
    return true;
}

/**
 * 🚦 Libera o semáforo do chip e marca o timestamp do disparo.
 */
function liberarSemaforoChip(chipId) {
    semaforoChips.set(chipId, {
        ocupado: false,
        ultimoDisparo: Date.now(),
        prioridadeAtual: null
    });
}

// ============================================================================
// 🎚️ MODO OPERACIONAL DINÂMICO — 80% SAUDAÇÃO / 20% FOLLOW-UP
// ============================================================================
// Janelas dedicadas pra cada tipo de disparo. Se base zerar, vira FOLLOWUP.
// ============================================================================

const baseEstaVaziaMap = new Map(); // instanceId → bool — isolado por chip, não global
let timestampUltimaCheckBase = 0;

// Helpers para não espalhar a Map pelo código
function isBaseVazia(instanceId) { return baseEstaVaziaMap.get(instanceId) === true; }
function setBaseVazia(instanceId, val) { baseEstaVaziaMap.set(instanceId, val); }

/**
 * 🎚️ Retorna o modo operacional atual do sistema baseado em hora + estado da base
 * Returns: 'SAUDACAO' | 'FOLLOWUP' | 'DESCANSO'
 */
function getModoOperacional(instanceId = null) {
    const agora = getHoraBrasil();

    // 🛑 Domingo: descanso total
    if (agora.diaSemana === 0) return 'DESCANSO';

    // 🛑 Sábado: só até 14h, e só saudação
    if (agora.diaSemana === 6) {
        const t = agora.horas * 60 + agora.minutos;
        if (t >= 480 && t <= 840) return 'SAUDACAO';
        return 'DESCANSO';
    }

    // 🔄 FALLBACK INTELIGENTE: só comuta pra FOLLOWUP se a fila deste chip específico
    // estiver vazia — impede que um chip sem leads bloqueie outros que têm leads
    const baseVazia = instanceId ? isBaseVazia(instanceId) : [...baseEstaVaziaMap.values()].some(v => v);
    if (baseVazia) {
        const t = agora.horas * 60 + agora.minutos;
        if (t >= 480 && t <= 1080) return 'FOLLOWUP';
        return 'DESCANSO';
    }
    
    // 📅 JANELAS PADRÃO (segunda a sexta) — 80% SAUDAÇÃO / 20% FOLLOW-UP
    const t = agora.horas * 60 + agora.minutos;
    
    // Antes de 08:00 ou depois de 18:00 → DESCANSO
    if (t < 480 || t > 1080) return 'DESCANSO';
    
    // 10:00-11:00 → FOLLOW-UP (janela 1)
    if (t >= 600 && t < 660) return 'FOLLOWUP';
    
    // 17:00-18:00 → FOLLOW-UP (janela 2)
    if (t >= 1020 && t <= 1080) return 'FOLLOWUP';
    
    // Resto do tempo → SAUDAÇÃO
    return 'SAUDACAO';
}

async function salvarDecisor(numeroRaw, leadOrigem, instanceId) {
    const phonePuro = numeroRaw.replace(/\D/g, '');
    if (phonePuro.length < 10 || phonePuro.length > 13) return null;

    // Garante formato com DDI 55
    const phoneNormalizado = phonePuro.startsWith('55') ? phonePuro : `55${phonePuro}`;
    const zapId = `${phoneNormalizado}@s.whatsapp.net`;

    // Checa se já existe no banco (evita duplicata)
    const { data: jaExiste } = await supabase
        .from('leads')
        .select('id, status')
        .eq('whatsapp_id', zapId)
        .maybeSingle();

    if (jaExiste) {
        console.log(`⚠️ [DECISOR] Número ${phoneNormalizado} já existe no banco (status: ${jaExiste.status}). Pulando.`);
        return null;
    }

    const { data: novoLead, error } = await supabase
        .from('leads')
        .insert([{
            whatsapp_id: zapId,
            phone: phoneNormalizado,
            name: leadOrigem.origin_company_name || leadOrigem.name || 'Decisor',
            instance_id: instanceId,
            user_id: leadOrigem.user_id || null,
            status: 'new',
            is_decisor: true,
            origin_lead_id: leadOrigem.id,
            origin_company_name: leadOrigem.name,
            niche: leadOrigem.niche || 'Empresa',
            bairro: leadOrigem.bairro || null,
            estado: leadOrigem.estado || null,
            capital_social_numeric: leadOrigem.capital_social_numeric || 0,
        }])
        .select()
        .single();

    if (error) {
        console.error(`❌ [DECISOR] Erro ao salvar decisor ${phoneNormalizado}:`, error.message);
        return null;
    }

    console.log(`✅ [DECISOR] Novo decisor salvo: ${phoneNormalizado} (empresa: ${leadOrigem.name})`);
    return novoLead;
}

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
    // Extrai os números reais de SP sem risco de dupla conversão do servidor
    const opcoes = { timeZone: "America/Sao_Paulo", hour: 'numeric', minute: 'numeric', hour12: false };
    const formatador = new Intl.DateTimeFormat('en-US', opcoes);
    const partes = formatador.formatToParts(new Date());
    
    const horas = parseInt(partes.find(p => p.type === 'hour').value);
    const minutos = parseInt(partes.find(p => p.type === 'minute').value);
    
    // Pega o dia da semana convertendo a data para a string de SP primeiro
    const diaSemana = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"})).getDay();

    return { horas, minutos, diaSemana };
}
function dentroDoExpediente() {
    const agora = getHoraBrasil();
    
    // 🛡️ Domingo é dia de descanso. Sem respostas, sem follow-ups.
    if (agora.diaSemana === 0) return false;
    
    // 🛡️ Sábado: Respondendo apenas de manhã (06:00 às 14:00)
    // Se quiser que responda até as 23:30 no sábado também, basta apagar este bloco IF inteiro.
    if (agora.diaSemana === 6) {
        const t = agora.horas * 60 + agora.minutos;
        return t >= 360 && t <= 840; // 360 = 06:00 | 840 = 14:00
    }
    
    // 🎯 SEGUNDA A SEXTA: Janela de Resposta (06:00 às 23:30)
    const t = agora.horas * 60 + agora.minutos;
    
    // 360 = 06:00 AM | 1410 = 23:30 PM
    return t >= 360 && t <= 1410;
}


function dentroDaJanelaDeDisparo(instanceId = null) {
    const modo = getModoOperacional(instanceId);
    
    if (modo === 'SAUDACAO') return true;
    
    // Se está em FOLLOWUP ou DESCANSO, motor de ataque NÃO dispara saudação
    if (modo === 'FOLLOWUP') {
        const agora = getHoraBrasil();
        console.log(`📨 [MODO] ${agora.horas}:${String(agora.minutos).padStart(2,'0')} → Janela de FOLLOW-UP. Motor de ataque pausado.`);
        return false;
    }
    
    // DESCANSO
    const agora = getHoraBrasil();
    console.log(`💤 [HORÁRIO] ${agora.horas}:${String(agora.minutos).padStart(2,'0')} fora do expediente.`);
    return false;
}


// ============================================================================
// 🧠 NÚCLEO IA: INTENÇÃO E RESPOSTA (SEU "CLOSER V11" INTEGRAL)
// ============================================================================

// 🧟 GUARD: Detecta loop zumbi — 4+ mensagens idênticas do lead em sequência
// Protege contra autoresposta em flood que chega antes do is_paused propagar no banco
async function verificarLoopZumbi(whatsappId, instanceId, textoAtual) {
    try {
        const { data: msgs } = await supabase
            .from('messages')
            .select('content')
            .eq('whatsapp_id', whatsappId)
            .eq('instance_id', instanceId)
            .eq('role', 'user')
            .order('created_at', { ascending: false })
            .limit(4);

        if (!msgs || msgs.length < 3) return false;

        const normalizar = s => s.replace(/^\[AUTORESPOSTA\]\s*/i, '').trim().toLowerCase();
        const textoNorm = normalizar(textoAtual);
        const identicas = msgs.filter(m => normalizar(m.content) === textoNorm);
        return identicas.length >= 3;
    } catch {
        return false;
    }
}

// 🎯 FIX #7: Detector de robô por REGEX (custo zero, latência zero)
// Substitui a chamada LLM que custava ~$0.002 por mensagem recebida
function analisarIntencaoRegex(texto) {
    if (!texto || texto.trim().length === 0) return "[HUMANO]";
    const t = texto.toLowerCase().trim();
    
    const PADROES_ROBO = [
        // 1. Padrões de Menu e Digitação
        /(?:digite|opcao|opção|selecione|escolha)\s*(?:a|uma)?\s*(?:opção|alternativa)?\s*\d/i,
        /^\s*\d\s*[-–—\.)]\s*.+/m,
        /(?:1\s*[-–]\s*.+\n\s*2\s*[-–])/,

        // 2. Mensagens de Ausência e Horário
        /agradec\w+\s+(?:o\s+)?(?:seu|sua)\s+contato/i,   // "agradece o seu contato" e "agradece seu contato"
        /agradec\w+\s+o\s+contato/i,                       // "agradece o contato"
        /(?:retornaremos|em\s+breve\s+retorn|entraremos\s+em\s+contato)/i,
        /(?:em\s+)?hor[aá]rio\s+comercial/i,
        /hor[aá]rio\s+de\s+atendimento/i,                  // "horário de atendimento" (não pegava antes)
        /sua\s+mensagem\s+foi\s+recebida/i,
        /bem[- ]?vind[oa]\s+(?:ao?|à)/i,
        /atendimento\s+(?:das|de)\s+\d/i,
        /^(?:seg\s+[aà]\s+sex|segunda\s+[aà]|funciona\w+\s+das?\s+\d)/i,

        // 3. Formulários / coleta de dados (URAs que pedem nome, data, produto)
        /(?:informe|deixe|envie|mande)\s+(?:seu|sua|o)\s+(?:nome|cpf|data|pedido|produto)/i,
        /⚠️\s*seu\s+nome/i,                                // "⚠️ Seu nome:" — padrão comum de bots
        /para\s+iniciar\s+(?:o\s+)?atendimento/i,          // "para iniciar o atendimento"
        /atendimento\s+por\s+ordem\s+de/i,                 // "atendimento por ordem de envio"

        // 4. Links de Cardápios e Catálogos
        /(?:cardapio|card[áa]pio|menu|catalogo|catálogo)\s*(?:digital|online|aqui)/i,
        /(?:acesse|confira|veja)\s+(?:nosso|o)\s+(?:cardápio|menu|catálogo)/i,
        /https?:\/\/(?:instadelivery|menudino|goomer|ola\.click|linktr\.ee|instagram\.com)/i,

        // 5. Frases típicas de Chatbots Business
        /(?:n[ãa]o\s+(?:é|e)\s+poss[ií]vel\s+atend|fora\s+do\s+hor[aá]rio)/i,
        /(?:para\s+falar\s+com\s+(?:um|nosso)\s+atendente)/i,
        /atendimento\s+autom[áa]tico/i,
        /voc[êe]\s+est[áa]\s+na\s+fila/i,
        /n[ãa]o\s+atendemos\s+liga[çc][õo]es/i,            // "não atendemos ligações"

        // 6. URAs modernas sem menu numerado
        /hor[aá]rio\s+de\s+funcionamento/i,
        /(?:em\s+breve\s+)?(?:um\s+)?atendente\s+(?:ir[aá]|vai|estará)/i,
        /aguarde\s+(?:um\s+momento|seu\s+atendimento)/i,
        /transferindo\s+(?:sua\s+)?(?:chamada|mensagem|atendimento)/i,
        /n[ãa]o\s+(?:estamos\s+)?(?:conseguindo\s+)?(?:atender|te\s+atender)\s+no\s+momento/i,
        /(?:segunda\s+[aà]\s+sexta|seg\s+[aà]\s+sex)[^.]{0,40}\d{1,2}h/i,
        /segunda\s+a\s+s[aá]bado[^.]{0,40}\d{1,2}[:h]/i,  // "segunda a sábado 09:00"

        // 7. Listas por letras
        /^\s*(?:\*?[A-Z]\)\*?|\*?[A-Z]\.\*?)\s+\S+/m,
    ];

    for (const padrao of PADROES_ROBO) {
        if (padrao.test(t)) return "[ROBO]";
    }
    
    return "[HUMANO]";
}

// ============================================================================
// 🧠 CACHE INTELIGENTE DE REGRAS (TTL: 30 Minutos)
// ============================================================================
async function getRegrasEmCache(instanceId) {
    const agora = Date.now();
    const cache = cacheRegrasInstancia.get(instanceId);

    if (cache && (agora - cache.timestamp < 1800000)) {
        return cache.dados;
    }

    const regrasDoBanco = await db.getInstanceRules(instanceId);

    // 🛡️ Blindagem: se o db.getInstanceRules não trouxer user_id, busca e injeta
    if (regrasDoBanco && !regrasDoBanco.user_id) {
        const { data: inst } = await supabase
            .from('instances')
            .select('user_id, agent_name, company_name')
            .eq('id', instanceId)
            .maybeSingle();

        if (inst) {
            regrasDoBanco.user_id = inst.user_id;
            regrasDoBanco.agent_name = regrasDoBanco.agent_name || inst.agent_name;
            regrasDoBanco.company_name = regrasDoBanco.company_name || inst.company_name;
            console.log(`🔧 [CACHE] Enriquecendo instanceData com user_id para chip ${instanceId}`);
        }
    }

    // Sobrescreve calendly_link com o da conta (profile) — todos os chips da mesma
    // empresa compartilham o mesmo link, independente do que estiver no chip individual
    if (regrasDoBanco?.user_id) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('calendly_link')
            .eq('id', regrasDoBanco.user_id)
            .maybeSingle();

        if (profile?.calendly_link) {
            regrasDoBanco.calendly_link = profile.calendly_link;
        }
    }

    if (regrasDoBanco) {
        cacheRegrasInstancia.set(instanceId, { dados: regrasDoBanco, timestamp: agora });
    }
    return regrasDoBanco;
}


// ============================================================================
// 🎯 MUDANÇA #1: SISTEMA DE ANCORAGEM DE CONTEXTO
// ============================================================================
 
function gerarAncoragemContexto(lead, estagioAtual, historico) {
    // Só injeta se conversa tiver mais de 8 mensagens (economia de tokens)
    if (historico.length < 8) return '';

    const objservations = historico
        .filter(m => m.content?.includes('[REVERSAO_TENTADA]'))
        .length > 0 ? '⚠️ Já tentou reversão' : '';

    const audiosUsados = historico
        .filter(m => m.content?.includes('<<Áudio') && m.role === 'assistant')
        .length;

    const ultimaAcaoIA = historico
        .filter(m => m.role === 'assistant')
        .slice(-1)[0]?.content?.substring(0, 50) || 'saudação';

    // 🚨 FORCING CTA: detecta trava prolongada nos estágios de qualificação
    const estagioNum = parseInt(estagioAtual) || 0;
    const turnosBot = historico.filter(m => m.role === 'assistant').length;
    const ultimasMsgBot = historico.filter(m => m.role === 'assistant').slice(-4);
    const jaProposHorario = ultimasMsgBot.some(m =>
        /\b(10h|15h|amanhã|horário|calendly|agendar|pode ser às|que horas)\b/i.test(m.content || '')
    );
    const travadoSemAvancar = estagioNum >= 1 && estagioNum <= 3 && turnosBot >= 8 && !jaProposHorario;

    const alertaTrava = travadoSemAvancar
        ? `\n\n🚨 ALERTA DE CONVERSÃO: Você já teve ${turnosBot} turnos sem propor o agendamento. O lead entendeu a dor — continuar qualificando agora vai resfriar o interesse. PRÓXIMA MENSAGEM OBRIGATÓRIA: Proponha um horário específico ("amanhã às 10h ou às 15h?"). Não faça mais perguntas de qualificação.`
        : '';

    return `
[RESUMO DE ESTADO - INVISÍVEL AO LEAD]
Estágio atual: ${estagioAtual}
Última ação sua: ${ultimaAcaoIA}...
Áudios TTS enviados: ${audiosUsados}/2
${objservations}${alertaTrava}

Este resumo existe apenas para manter seu foco. O lead NÃO vê isso.
`;
}


// ============================================================================
// 🎯 MUDANÇA #2: PODA INTELIGENTE DE HISTÓRICO (ECONOMIA DE ~40% TOKENS)
// ============================================================================
 
function podarHistorico(historico) {
    // TAGS CRÍTICAS que NUNCA devem ser deletadas
    const tagsCriticas = [
        '[REVERSAO_TENTADA]',
        '[AUTORESPOSTA]',
        '<<Áudio',
        '[AUDIO_TTS]',
        '[QUEBRA]' // mantém estrutura de mensagens
    ];
    
    function temTagCritica(mensagem) {
        return tagsCriticas.some(tag => mensagem.content?.includes(tag));
    }
    
    // Se histórico for curto, não poda
    if (historico.length <= 12) return historico;
    
    // Estrutura final: [primeira] + [tags críticas] + [últimas 10]
    const primeira = historico[0];
    const comTags = historico.filter(m => temTagCritica(m));
    const ultimas = historico.slice(-10);
    
    // Remove duplicatas mantendo ordem
    const seen = new Set();
    const resultado = [primeira, ...comTags, ...ultimas].filter(m => {
        const key = `${m.role}-${m.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    
    console.log(`🧹 [PODA] Histórico reduzido: ${historico.length} → ${resultado.length} mensagens`);
    return resultado;
}
 
// ============================================================================
// 🧠 RESOLVEDOR UNIVERSAL DE PROMPT — fonte única de verdade
// Usado por: gerarRespostaIA, Worker da fila, e futuras recuperações.
// ============================================================================
async function resolverPromptCompleto(promptBase, contextoLead, instanceData, historico = [], extras = {}) {
    // 🛡️ Blindagem básica
    if (!promptBase || promptBase.trim().length < 50) {
        console.error("❌ [RESOLVER] Prompt base vazio ou muito curto.");
        return null;
    }

    // --- 1. Dados básicos do agente e empresa ---
    const agentName = instanceData?.agent_name || instanceData?.name || "Agente";
    const companyName = instanceData?.company_name || "nossa empresa";

    // --- 2. Dados do lead ---
    // extrairNomeHumano filtra nomes de CNPJ (LTDA, Comércio, cargos) e retorna null se não parecer pessoa real
    // Se retornar null, usamos "vc" para não chamar o gatekeeper pelo nome do dono do CNPJ sem confirmação
    const nomeLead = extrairNomeHumano(contextoLead.dono) || 'vc';

    const nomeEmpresa = limparNomeEmpresa(contextoLead.name);

    const bairroLead = contextoLead.bairro || "sua região";
    // 🎯 LIMPEZA ESTÉTICA: Corta nomes compostos (ex: "Enel/CPFL" vira apenas "Enel")
const concessionariaLocal = (MAPA_CONCESSIONARIAS[contextoLead.estado] || 'concessionária de energia').split('/')[0];
    // --- 3. Estratégia tática ---
    const ancoraConta = calcularAncoraDinamica(contextoLead);
    const isBigFish = (contextoLead.capital_social_numeric > 500000);
    const perfilComportamental = isBigFish
        ? "ARQUÉTIPO: O BANQUEIRO DE INVESTIMENTOS. Tom: Direto, focado em redução de OPEX e Zero CAPEX."
        : "ARQUÉTIPO: O CONSULTOR PARCEIRO. Tom: Educativo, focado em 'sobrar dinheiro no caixa'.";

    // ✅ FIX: Declara a percentagem ANTES de a usar nos cálculos
    const percentualReal = MAPA_DESCONTO_REGIONAL[contextoLead.estado] || 0.15; 
    const percentualTexto = String(Math.round(percentualReal * 100));

    // 🧮 Tenta extrair o valor real da conta mencionado pelo lead no histórico
    // Padrões: "pago 1500", "conta de 800 reais", "R$ 1.200", "uns 900", "1800 por mês" etc.
    const valorRealDaConta = (() => {
        const mensagensLead = historico
            .filter(m => m.role === 'user')
            .map(m => m.content)
            .join(' ');
        const regex = /(?:pago?|conta[^.]*?(?:é|fica|gira|vem|chega)|fatura[^.]*?(?:é|fica|gira|vem|chega)|média[^.]*?(?:é|fica)|(?:uns?|umas?|cerca de|em torno de|tipo|algo como))\s*R?\$?\s*([\d.,]+)|R\$\s*([\d.,]+)/gi;
        const matches = [...mensagensLead.matchAll(regex)];
        if (!matches.length) return null;
        const ultimo = matches[matches.length - 1];
        const raw = (ultimo[1] || ultimo[2] || '').replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(raw);
        return (valor >= 100 && valor <= 100000) ? valor : null;
    })();

    // Usa o valor real se disponível, senão cai na âncora por capital social
    const valorAncoraNumerico = valorRealDaConta || parseInt(ancoraConta.replace(/\D/g, '')) || 700;
    const economiaMensal = Math.round(valorAncoraNumerico * percentualReal);
    const economiaAnual = economiaMensal * 12;
    const economiaMensalFormatada = `R$ ${economiaMensal.toLocaleString('pt-BR')}`;
    const economiaAnualFormatada = `R$ ${economiaAnual.toLocaleString('pt-BR')}`;
    if (valorRealDaConta) console.log(`💡 [ECONOMIA REAL] Lead informou conta de R$${valorRealDaConta} → economia ${percentualTexto}%: ${economiaMensalFormatada}/mês, ${economiaAnualFormatada}/ano`);
    
    const nicheContext = gerarContextoNicho(contextoLead.niche); // mantido para compat com ${nicheContext} no promptBase
    const estagioAtual = String(contextoLead.current_stage || 0);

    // Inteligência de nicho dinâmica — Redis → Supabase → LLM (aprende on-the-fly)
    const dadosNicho = await getNicheData(contextoLead.niche).catch(() => null);

    // --- 4. Reversão de objeção ---
    const reversaoJaTentada = contextoLead.objection_reversed
        ? '\n\nAVISO CRÍTICO: Este lead já recebeu UMA tentativa de reversão de objeção. Se recusar novamente, encerre. PROIBIDO tentar reverter de novo.'
        : '';

    // --- 5. Saudação dinâmica ---
    const horaAtual = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
    const saudacaoTempo = horaAtual < 12 ? "Bom dia" : horaAtual < 18 ? "Boa tarde" : "Boa noite";

    // --- 6. Contexto de bairro (prova social) ---
    let contextoBairro = `Mapeamos empresas similares à sua aqui no ${bairroLead} pagando tarifa cheia na ${concessionariaLocal} sem necessidade.`;
    try {
        const { count: leadsNoBairro } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('bairro', contextoLead.bairro);

        if (leadsNoBairro > 1) {
            contextoBairro = `A gente está fazendo um trabalho forte aí no ${bairroLead}. Já mapeamos outras ${leadsNoBairro} empresas da região.`;
        }
    } catch (e) {
        // Se a query falhar, usa o fallback — não trava o fluxo
        console.warn("⚠️ [RESOLVER] Falha ao contar leads do bairro, usando fallback.");
    }

    // --- 7. Ancoragem de contexto (invisível, só pra conversas longas) ---
    const ancoragemContexto = gerarAncoragemContexto(contextoLead, estagioAtual, historico);

    // --- 8. Extras dinâmicos (Raio-X e Profiler — só existem no fluxo do Worker) ---
    // Alteramos para 'let' para permitir a concatenação do Handoff
    let raioXDoLead = extras.raioXDoLead || "Sem dados adicionais de inteligência ainda.";
    const perfilEmocional = extras.perfilEmocional || "Perfil emocional neutro.";

    // 🧠 INJEÇÃO DO HANDOFF REVERSO + MEMÓRIA DE OBJEÇÕES
    if (contextoLead.internal_notes) {
        const notas = contextoLead.internal_notes;

        // Extrai log de objeções [OBJ:...] sem misturar com instrução de handoff
        const objMatches = notas.match(/\[OBJ:[^\]]+\]/g) || [];
        const handoffNote = notas.replace(/\[OBJ:[^\]]+\]/g, '').trim();

        if (handoffNote) {
            raioXDoLead += `\n\n⚠️ INSTRUÇÃO CRÍTICA (HANDOFF): O gestor humano assumiu a conversa e combinou o seguinte: "${handoffNote}". Ignore estágios anteriores se conflitarem e siga exatamente desta orientação.`;
        }
        if (objMatches.length > 0) {
            const listaObjecoes = objMatches.map(o => o.replace('[OBJ:', '').replace(']', '')).join(' | ');
            raioXDoLead += `\n\n⚠️ MEMÓRIA DE OBJEÇÕES (NÃO repita ângulos que já falharam): ${listaObjecoes}`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // --- 9. ARQUITETURA MODULAR — 4 seções estruturadas + Constituição ---
    // ─────────────────────────────────────────────────────────────────────

    const calendlyResolvido =
        instanceData?.calendly_link ||
        (instanceData?.owner_phone
            ? `https://wa.me/55${(instanceData.owner_phone || '').replace(/\D/g, '')}`
            : 'https://antix.com.br/agendar');

    const secaoIdentidade = `[IDENTIDADE]
Você é ${agentName}, especialista em eficiência energética da ${companyName}.
Seu objetivo é qualificar o interesse do lead e levá-lo a agendar uma consultoria gratuita.
Você se comunica como um ser humano no WhatsApp — direto, sem formalidade excessiva, sem robótica.`;

    const secaoDiretrizes = `[DIRETRIZES DE FECHAMENTO]
- Mensagens curtas: máximo 2 balões por resposta, 15-35 palavras cada. Balões separados por [QUEBRA].
- Simule digitação humana: uma ideia por vez, sem listas numeradas ou marcadores.
- Faça APENAS UMA pergunta por mensagem. Nunca duas.
- Foco absoluto em converter para agendamento: ${calendlyResolvido}
- Nunca revele que é uma IA antes do REVEAL programado.
- Texto puro: sem asteriscos, sem markdown.
- Termine SEMPRE com uma pergunta ("?"), exceto em REPASSE e REVEAL.
- Tags obrigatórias no final de toda resposta: [ESTAGIO:N] e [CLIMA:X].`;

    const secaoRegional = `[INTELIGÊNCIA REGIONAL]
- Concessionária local do lead: ${concessionariaLocal}
- Redução esperada na fatura: ${percentualTexto}%
- Economia estimada: ${economiaMensalFormatada}/mês | ${economiaAnualFormatada}/ano
- Contexto regional: ${contextoBairro}
- ${perfilComportamental}`;

    const secaoNicho = dadosNicho
        ? `[ESTRATEGIA DO NICHO]
- Nicho identificado: ${contextoLead.niche || 'empresa comercial'}
- Equipamentos de alto consumo: ${dadosNicho.equipamentos}
- Dor principal do negócio: ${dadosNicho.dor_principal}
- Ângulo de abordagem comercial: ${dadosNicho.angulo_venda}`
        : `[ESTRATEGIA DO NICHO]
- Nicho identificado: ${contextoLead.niche || 'empresa comercial'}
- Equipamentos de alto consumo: ar condicionado, iluminação, equipamentos industriais.
- Dor principal do negócio: conta de energia elevada reduzindo margem do negócio.
- Ângulo de abordagem comercial: redução imediata da maior despesa fixa da empresa.`;

    const secaoModular = [secaoIdentidade, secaoDiretrizes, secaoRegional, secaoNicho].join('\n\n');

    // --- Constituição do agente (regras customizadas do cliente, com variáveis resolvidas) ---
    const constituicaoResolvida = promptBase
        .replaceAll('${agentName}', agentName)
        .replaceAll('${companyName}', companyName)
        .replaceAll('${nomeLead}', nomeLead)
        .replaceAll('${nomeEmpresa}', nomeEmpresa)
        .replaceAll('${bairroLead}', bairroLead)
        .replaceAll('${concessionariaLocal}', concessionariaLocal)
        .replaceAll('${ancoraConta}', ancoraConta)
        .replaceAll('${perfilComportamental}', perfilComportamental)
        .replaceAll('${percentualTexto}', percentualTexto)
        .replaceAll('${reversaoJaTentada}', reversaoJaTentada)
        .replaceAll('${estagioAtual}', estagioAtual)
        .replaceAll('${nicheContext}', nicheContext)
        .replaceAll('${contextoBairro}', contextoBairro)
        .replaceAll('${saudacaoTempo}', saudacaoTempo)
        .replaceAll('${ancoragemContexto}', ancoragemContexto)
        .replaceAll('${raioXDoLead}', raioXDoLead)
        .replaceAll('${perfilEmocional}', perfilEmocional)
        .replaceAll('${economiaMensal}', economiaMensalFormatada)
        .replaceAll('${economiaAnual}', economiaAnualFormatada)
        .replaceAll('${calendlyLink}', calendlyResolvido);

    return `${secaoModular}\n\n${constituicaoResolvida}`;
}
// ============================================================================
// 🧠 NÚCLEO IA: "THE ARCHITECT" - STATE OF THE ART SDR V3.0 (MULTI-TENANT REAL)
// ============================================================================

async function gerarRespostaIA(historico, contextoLead, instanceData) {
    // 1. Busca o Dono da Conta
    let userId = instanceData?.user_id;
    if (!userId) {
        const { data: inst } = await supabase.from('instances').select('user_id').eq('id', contextoLead.instance_id).maybeSingle();
        userId = inst?.user_id;
    }

    if (!userId) {
        console.error("❌ ERRO FATAL: user_id não encontrado. Impossível buscar o prompt.");
        return null;
    }

    // 2. Busca o Cérebro Centralizado
    const { data: brain } = await supabase
        .from('tenant_prompts')
        .select('system_prompt')
        .eq('user_id', userId)
        .maybeSingle();

    const promptBase = brain?.system_prompt;

    if (!promptBase || promptBase.trim().length < 100) {
        console.error(`❌ ERRO FATAL: Prompt não configurado para o usuário: ${userId}`);
        return null;
    }

    // 3. Resolve o prompt usando o resolver centralizado
    const promptFinal = await resolverPromptCompleto(promptBase, contextoLead, instanceData, historico);
    if (!promptFinal) return null;

    // 4. Chamada LLM com retry
    const MAX_TENTATIVAS = 3;
    const historicoPodado = podarHistorico(historico);

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        try {
            const chatCompletion = await together.chat.completions.create({
                messages: [
                    { role: 'system', content: promptFinal },
                    ...historicoPodado
                ],
                model: MODELO_CEREBRO,
                temperature: 0.3,
                max_tokens: 180,
                presence_penalty: 0.1,
                frequency_penalty: 0.15
            });
            const respostaDaIA = chatCompletion.choices[0].message.content;
            return respostaDaIA.replace(/[\*_~`]/g, '');
        } catch (e) {
            console.error(`❌ [LLM] Tentativa ${tentativa}/${MAX_TENTATIVAS} falhou: ${e.message}`);
            if (tentativa < MAX_TENTATIVAS) await new Promise(r => setTimeout(r, tentativa * 3000));
        }
    }
    return null;
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
    //const { state, saveCreds } = await useMultiFileAuthState(`wpp_sessions/${instanceId}`);
    // Agora as chaves do WhatsApp vivem no Supabase, protegidas contra restarts
    const { state, saveCreds } = await useRedisAuthState(redisConnection, instanceId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["Chrome", "Chrome", "1.0"],
        keepAliveIntervalMs: 30000,   // ping a cada 30s — evita socket morrer no descanso de 40min
        connectTimeoutMs: 60000,      // desiste da conexão em 60s se não responder
        markOnlineOnConnect: false,   // não anuncia presença — menos suspeito pro WhatsApp
        retryRequestDelayMs: 2000,    // aguarda 2s antes de reenviar requisições falhas
    });

    // Guardamos o socket com uma flag 'ready' falsa inicialmente
    sessions.set(instanceId, { sock, ready: false }); 
    sock.ev.on('creds.update', saveCreds);
 
    // 🛡️ Captura erros de descriptografia (Bad MAC) sem travar o chip
sock.ev.on('messages.upsert', async () => {}); // fallback silencioso
process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason);
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt')) {
        // Silencia o spam do libsignal — não é erro fatal, só mensagem perdida
        return;
    }
    console.error('⚠️ [UNHANDLED]:', reason);
});
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
            // 👇 A barreira de silêncio (Encerramento Manual)
            if (instanciasEncerrandoManualmente.has(instanceId)) {
                console.log(`🔇 [SHUTDOWN SILENCIOSO] Chip ${instanceName} removido pelo painel. Alerta abortado.`);
                instanciasEncerrandoManualmente.delete(instanceId);
                return; // 🛑 Mata a execução aqui!
            }

            sessions.set(instanceId, { sock, ready: false });
            instanciasLigando.delete(instanceId);
            const reason = (lastDisconnect?.error)?.output?.statusCode;
        
            // Avisa no Discord (exceto se for deslogado/rejeitado pela Meta)
            if (reason !== DisconnectReason.loggedOut && reason !== 403 && reason !== 401) {
                enviarAlerta("🔴 CHIP OFF-LINE", `O chip ${instanceName} caiu. Código do erro: ${reason}`, 15158332);
            }

            // 🔴 ERROS FATAIS (Deslogado, Banido, ou Rejeitado pela Meta)
            if (reason === DisconnectReason.loggedOut || reason === 403 || reason === 401) {
                console.log(`🔴 [FATAL ${reason}] ${instanceName} foi rejeitado ou deslogado. Limpando sessão Redis para novo QR...`);
                await clearRedisSession(redisConnection, instanceId);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                return; // 🛑 MATA O LOOP AQUI! Sem setTimeout, sem insistir.
            }

            // 🔴 Sessão corrompida localmente (Bad Session)
            if (reason === DisconnectReason.badSession) {
                console.log(`🔴 [BAD SESSION] ${instanceName} com chaves corrompidas. Limpando e pedindo novo QR...`);
                await supabase.from('whatsapp_sessions').delete().eq('id', instanceId);
                await supabase.from('whatsapp_keys').delete().eq('instance_id', instanceId);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                setTimeout(() => startInstance(instanceId, instanceName), 3000);
                return;
            }

            // 🔴 Conflito (logou em outro lugar)
            if (reason === DisconnectReason.connectionReplaced) {
                console.log(`⚠️ [CONFLITO] ${instanceName} foi conectado em outro lugar. Pausando.`);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                return;
            }

            // Timeout de conexão → reconecta com backoff
            if (reason === DisconnectReason.timedOut || reason === DisconnectReason.connectionLost) {
                const delay = Math.min(5000 * (2 ** (instanciasLigando.size || 1)), 60000); // backoff: 10s → 20s → max 60s
                console.log(`⏱️ [TIMEOUT] ${instanceName} perdeu conexão. Reconectando em ${delay/1000}s...`);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                setTimeout(() => startInstance(instanceId, instanceName), delay);
                return;
            }

            // Demais casos → reconecta com backoff leve
            const delayMs = reason === undefined ? 15000 : 5000;
            console.log(`🔄 [SDR] Conexão instável em ${instanceName} (reason: ${reason ?? 'desconhecido'}). Reiniciando em ${delayMs/1000}s...`);
            await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
            setTimeout(() => startInstance(instanceId, instanceName), delayMs);
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

    // 👀 OLHOS DO SDR: Detecta quando o lead visualiza a mensagem (setinhas azuis)
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            // status 3 = Visualizado/Visto (setinhas azuis)
            if (update.update.status === 3 || update.update.status === 4) { 
                const jid = update.key.remoteJid;
                const cleanJid = jid.split(':')[0].split('@')[0] + (jid.includes('@lid') ? '@lid' : '@s.whatsapp.net');

                try {
                    await supabase.from('leads')
                        .update({ last_seen_at: new Date().toISOString() })
                        .eq('whatsapp_id', cleanJid);
                    // console.log(`👀 [VISTO] Lead ${cleanJid} visualizou a mensagem.`);
                } catch (e) {
                    // Falha silenciosa para não travar o socket
                }
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
            const isMedia = ['audioMessage', 'imageMessage', 'documentMessage', 'contactMessage', 'contactsArrayMessage'].includes(messageType);

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
                try {
                    const textoConsolidado = gaveta.textos.join(' \n');
                    const msgFinal = gaveta.ultimaMsg;
                    
                    gavetaDeMensagens.delete(remoteJid);
                    
                    console.log(`🧠 [OUVIDO PACIENTE] Lead concluiu raciocínio. Processando bloco: "${textoConsolidado}"`);
                    
                    await processarMensagem(sock, msgFinal, instanceId, textoConsolidado);
                } catch (errGaveta) {
                    console.error(`❌ [GAVETA] Erro ao processar bloco consolidado:`, errGaveta.message);
                    gavetaDeMensagens.delete(remoteJid); // Limpa mesmo com erro
                }
            }, 15000);// <-- 15 segundos de paciência
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


async function enviarAudioTTS(sock, remoteJid, texto, lead, instanceId) {
    try {
        console.log(`🎙️ [TTS] Gerando áudio humanizado para ${lead.name}...`);
        
        // 1. HUMANIZAÇÃO DO TEXTO (O Pulo do Gato)
        // Adicionamos pontuações que forçam a IA a fazer pausas naturais de quem está pensando.
        // Humanização sequencial sem cascata:
        // REGRA: nenhum substituto pode conter pontos ('.') — senão o replace de pontos os processa de novo
        let textoHumanizado = texto
            .replace(/\.{2,}/g, '. ')              // 1. Reticências → ponto único (sem multiplicar)
            .replace(/energia/gi, 'energia né,')   // 2. Vícios de linguagem (sem pontos internos)
            .replace(/fatura/gi, 'fatura tipo,')
            .replace(/economizar/gi, 'dar uma economizada')
            .replace(/\?/g, '? ')                  // 3. Pontuação → só espaço (edge-tts entonação natural)
            .replace(/!/g, '! ')
            .replace(/\./g, ', ')                  // 4. Ponto → vírgula (pausa suave — SEM pontos no substituto)
            .replace(/,\s*,/g, ',')                // 5. Limpa duplas vírgulas eventuais
            .trim();

        await sock.sendPresenceUpdate('recording', remoteJid);
        
        // 2. ENVIAR O TEXTO JÁ HUMANIZADO
        // Note que agora passamos 'textoHumanizado' e não mais o 'texto' original
        const buffer = await gerarAudioTTS(textoHumanizado);

        await sock.sendMessage(remoteJid, {
            audio: buffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true 
        });

        await db.saveMessage(lead.whatsapp_id, 'assistant', `[AUDIO_TTS] ${texto}`, instanceId);
        return true;
    } catch (err) {
        console.error(`❌ [TTS] Falha:`, err.message);
        return false;
    }
}


// ============================================================================
// 🧠 NÚCLEO UNIFICADO DE RESPOSTA — elimina duplicação entre processarMensagem
// e processarMensagemManual. Toda lógica de áudio e envio vive aqui.
// ============================================================================
async function filtrarEEnviarResposta(sock, remoteJid, resposta, historico, lead, instanceId) {
    if (!resposta) {
        console.warn(`⚠️ [FILTRO] Resposta NULA chegou pro envio. Lead: ${lead.name}`);
        return;
    }

    // 🔍 LOG DE DIAGNÓSTICO: mostra o que a LLM gerou
    console.log(`📝 [FILTRO] Resposta RAW da LLM (${resposta.length} chars): "${resposta.substring(0, 200)}..."`);

    // ── 1. LIMPEZA TOTAL DE TAGS (À PROVA DE ALUCINAÇÃO) ──
    const regexTags = /\[\s*(ESTAGIO|ESTÁGIO|CLIMA|RAIO-X|PERFIL|ROBO|CONTADOR|ENGANO|GATEKEEPER|AGENDAMENTO_MANUAL|PAUSA\s*PARA\s*RESPOSTA|REVERSAO_TENTADA)[^\]]*\]/gi;
    const matchEstagio = /\[?\s*EST[AÁ]GIO\s*:?\s*(\d)\s*\]?/gi.exec(resposta);
    const matchEncerrado = /\[?\s*EST[AÁ]GIO\s*:?\s*ENCERRADO\s*\]?/gi.test(resposta);
    const matchClima = /\[?\s*CLIMA\s*:?\s*([a-zA-Z_]+)\s*\]?/gi.exec(resposta);
    const matchManual = /\[?\s*AGENDAMENTO_MANUAL\s*\]?/gi.exec(resposta);

    let textoLimpo = resposta
        .replace(regexTags, '')
        .replace(/\[?\s*est[aá]gio\s*:?\s*\d\s*\]?/gi, '')           // [ estágio 0 ] sem formato certo
        .replace(/\[?\s*est[aá]gio\s*:?\s*encerrado\s*\]?/gi, '')     // ESTAGIO:ENCERRADO sem colchetes
        .replace(/\[?\s*clima\s*:?\s*[a-z_]+\s*\]?/gi, '')            // CLIMA:PALAVRA sem colchetes
        .replace(/\[?\s*reversao[_\s]tentada\s*\]?/gi, '')            // [REVERSAO_TENTADA] malformado
        .replace(/\bROBO\b/gi, '')                                     // ROBO sem colchetes
        .replace(/\bCONTADOR\b/gi, '')                                 // CONTADOR sem colchetes
        .replace(/\bENGANO\b/gi, '')                                   // ENGANO sem colchetes
        .replace(/\s*--\s*/g, ', ')                                    // em-dash estilístico do LLM → vírgula natural
        .trim();

    // ── BLINDAGEM ANTI-PENSAMENTO: remove parágrafos iniciais de raciocínio interno ──
    // Detecta quando a LLM "pensa em voz alta" antes de responder ao cliente
    const regexPensamento = /^(parece que|percebo que|vou tentar|detectei que|vejo que|vi que estamos|estou vendo que|não consigo|isso parece|o lead parece|a mensagem parece|caímos em|caimos em)[^\n]*/gi;
    textoLimpo = textoLimpo
        .replace(regexPensamento, '')  // remove a linha de pensamento
        .replace(/^\s*\n+/, '')        // remove linhas em branco que sobram no início
        .trim();

    if (textoLimpo.length === 0 && resposta.length > 0) {
        // A resposta era só pensamento — loga e aborta silenciosamente
        console.warn(`⚠️ [FILTRO] Resposta era só pensamento interno. Abortando envio para ${lead.name}.`);
        return;
    }

    if (textoLimpo.length === 0) {
    console.error(`❌ [FILTRO] Texto ficou VAZIO após limpeza de tags! Resposta original: "${resposta}"`);
    
    // 🛡️ Marca o lead como "conversa encerrada silenciosamente" pra não ficar em loop
    // O vigia de recuperação não vai mais tentar reativar esse lead
    try {
        await supabase.from('leads').update({ 
            is_paused: true,
            manual_pause: false,
            internal_notes: `IA abortou resposta (texto vazio após tags) em ${new Date().toLocaleString('pt-BR')}. Conversa finalizada.`
        }).eq('id', lead.id);
        console.log(`🔕 [FILTRO] Lead ${lead.name} pausado automaticamente (conversa finalizada por bloco vazio).`);
    } catch (e) {
        console.error(`❌ [FILTRO] Falha ao pausar lead vazio:`, e.message);
    }
    return;
}

    console.log(`✅ [FILTRO] Texto limpo pronto pra envio (${textoLimpo.length} chars): "${textoLimpo.substring(0, 150)}..."`);

    // ── TRAVÃO ANTI-LOOP IA vs IA ──
    // Se as últimas 3 mensagens da conversa são todas da IA (assistant), estamos
    // em loop com um bot. Pausa o lead silenciosamente antes de enviar mais spam.
    try {
        const { data: recentMsgs } = await supabase
            .from('messages')
            .select('role')
            .eq('whatsapp_id', lead.whatsapp_id)
            .order('created_at', { ascending: false })
            .limit(3);

        if (recentMsgs && recentMsgs.length >= 3 && recentMsgs.every(m => m.role === 'assistant')) {
            console.warn(`🔁 [LOOP IA] Últimas 3 mensagens são todas da IA para ${lead.name}. Pausando para evitar spam.`);
            await supabase.from('leads').update({
                is_paused: true,
                internal_notes: `Loop IA detectado em ${new Date().toLocaleString('pt-BR')} — bot do cliente`
            }).eq('id', lead.id);
            await enviarAlerta(`🔁 *Loop IA detectado*\n*Lead:* ${lead.name}\nIA pausada automaticamente para evitar spam.`, 16711680);
            return;
        }
    } catch (e) {
        console.error('❌ [TRAVÃO ANTI-LOOP] Erro ao checar histórico:', e.message);
    }

    // ── 2. ATUALIZAÇÃO DE STATUS NO BANCO ──
    let updates = {};
if (matchEstagio) {
    const estagioParsed = parseInt(matchEstagio[1]);
    // 🛡️ Range válido: 0 a 5. Se a LLM alucinar 6, 7, 9, força no 5.
    if (estagioParsed >= 0 && estagioParsed <= 5) {
        updates.current_stage = estagioParsed;
    } else {
        console.warn(`⚠️ [VALIDAÇÃO] LLM alucinou estágio ${estagioParsed} para ${lead.name}. Mantendo no 5.`);
        updates.current_stage = 5;
    }
}
if (matchClima) updates.sentiment = matchClima[1].toLowerCase();
    if (matchManual) {
        updates.calendly_booked = true;
        updates.status = 'booked';
    }
    if (Object.keys(updates).length > 0) {
        await supabase.from('leads').update(updates).eq('id', lead.id);
        console.log(`📊 [FILTRO] Lead atualizado:`, updates);
    }

    // 🔕 ENCERRADO: pausa o lead após mensagem de encerramento ser enviada
    if (matchEncerrado) {
        await supabase.from('leads').update({
            is_paused: true,
            internal_notes: `Conversa encerrada pela IA em ${new Date().toLocaleString('pt-BR')}`
        }).eq('id', lead.id);
        console.log(`🔕 [ENCERRADO] Conversa finalizada para ${lead.name}. Lead pausado.`);
    }

    // ── 3. ENVIO FATIADO ──
    const mensagensSplit = textoLimpo.split('[QUEBRA]').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`📤 [FILTRO] Enviando ${mensagensSplit.length} balão(ões) para ${lead.name}...`);

    // 🎙️ LÓGICA TTS: Decide se o último balão vai como áudio
    const ultimaMsgUser = historico.filter(m => m.role === 'user').slice(-1)[0];
    const leadEnviouAudio = ultimaMsgUser?.content?.startsWith('(Áudio)');
    const audiosJaEnviados = historico.filter(m => m.content?.includes('[AUDIO_TTS]')).length;
    const temCalendly = textoLimpo.includes('calendly.com');
    // Dispara TTS se: lead mandou áudio OU chance aleatória de 25%, máx 2 por conversa, sem links
    const usarTTS = audiosJaEnviados < 2 && !temCalendly && (leadEnviouAudio || Math.random() < 0.25);

    for (let i = 0; i < mensagensSplit.length; i++) {
        const trecho = mensagensSplit[i];
        const isUltimoBalao = i === mensagensSplit.length - 1;
        try {
            // 🎙️ Último balão como áudio (quando aplicável)
            if (usarTTS && isUltimoBalao) {
                console.log(`🎙️ [TTS] Enviando último balão como áudio para ${lead.name}...`);
                const audioOk = await enviarAudioTTS(sock, remoteJid, trecho, lead, instanceId);
                if (audioOk) continue;
                console.log(`⚠️ [TTS FALLBACK] Áudio falhou. Enviando como texto para ${lead.name} não ficar no vácuo.`);
            }

            await sock.sendPresenceUpdate('composing', remoteJid);

            // ⚡ CÁLCULO DE JITTER DINÂMICO: Simula tempo de leitura + raciocínio + digitação
            const isObjecao = resposta.includes('CLIMA:DESCONFIADO') || resposta.includes('CLIMA:OCUPADO');
            const multiplicador = isObjecao ? 90 : 65;
            const tempoBase = Math.min(trecho.length * multiplicador + 3000, 12000);

            await delay(tempoBase);
            const enviado = await enviarMensagemIA(sock, remoteJid, { text: trecho });

            if (enviado) {
                console.log(`✅ [ENVIO ${i + 1}/${mensagensSplit.length}] Balão entregue: "${trecho.substring(0, 80)}..."`);
                await db.saveMessage(lead.whatsapp_id, 'assistant', trecho, instanceId);

                // 🕒 MARCADOR DE LINK: Carimba o banco se o Calendly foi enviado
                if (trecho.includes('calendly.com')) {
                    await supabase.from('leads').update({ link_sent_at: new Date().toISOString() }).eq('id', lead.id);
                    console.log(`🔗 [TRACKING] Link enviado para ${lead.name}. Cronômetro de abandono ativado.`);
                }
            } else {
                console.error(`❌ [ENVIO ${i + 1}/${mensagensSplit.length}] FALHOU ao entregar: "${trecho.substring(0, 80)}..."`);
            }
        } catch (errEnvio) {
            console.error(`❌ [ENVIO ${i + 1}] Exception:`, errEnvio.message);
        }
    }
}


async function processarMensagem(sock, msg, instanceId, textoConsolidado = null) {    
    const remoteJid = msg.key.remoteJid;
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

// 🎯 A MÁGICA DA IDENTIDADE: Atualização dinâmica do nome pelo WhatsApp
    if (!fromMe && msg.pushName) {
        // Só atualizamos se o banco ainda não tiver o 'dono' preenchido 
        // OU se o dono atual for genérico ("Gestor", "Empresa")
        if (!lead.dono || lead.dono.length <= 2 || lead.dono.toLowerCase() === 'gestor') {
            const nomeValidado = extrairNomeHumano(msg.pushName);
            
            if (nomeValidado) {
                console.log(`👤 [IDENTIDADE] Nome humano validado no WhatsApp: "${msg.pushName}" -> "${nomeValidado}". Atualizando banco...`);
                lead.dono = nomeValidado; // Atualiza na memória viva para a IA já usar agora
                
                // Salva no banco de dados silenciosamente
                supabase.from('leads')
                    .update({ dono: nomeValidado })
                    .eq('id', lead.id)
                    .then(() => {}) // Promessa solta para não atrasar o fluxo
                    .catch(e => console.error("Erro ao salvar pushName:", e.message));
            }
        }
    }


// --- 📝 EXTRAÇÃO DE CONTEÚDO (ACEITANDO A GAVETA) ---
    // Extração de contato vCard → texto sintético que o routerAgent classifica como REPASSE
    const vcardRaw = msg.message.contactMessage?.vcard || msg.message.contactsArrayMessage?.contacts?.[0]?.vcard;
    const nomeVcard  = vcardRaw?.match(/FN:(.+)/i)?.[1]?.trim();
    const telVcard   = vcardRaw?.match(/TEL[^:\r\n]*:([+\d\s\-().]+)/i)?.[1]?.replace(/\D/g, '').trim();
    const textoContato = vcardRaw
        ? `Segue o contato: ${nomeVcard || 'contato'}${telVcard ? ` ${telVcard}` : ''}`
        : '';

    const textoOriginal = msg.message.conversation ||
                          msg.message.extendedTextMessage?.text ||
                          msg.message.imageMessage?.caption ||
                          msg.message.videoMessage?.caption ||
                          textoContato || "";

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

        // 🧟 GUARD: flood de mensagens idênticas antes do is_paused propagar no banco
        if (await verificarLoopZumbi(remoteJid, instanceId, texto)) {
            console.log(`🧟 [LOOP ZUMBI] Flood detectado para ${lead.name}. Pausando e alertando.`);
            await supabase.from('leads').update({
                is_paused: true,
                internal_notes: `Loop zumbi em ${new Date().toLocaleString('pt-BR')}: "${texto.substring(0, 80)}"`
            }).eq('id', lead.id);
            await enviarAlerta(`🧟 *Loop Zumbi* detectado\n*Lead:* ${lead.name}\n*Chip:* ${instanceId}\nLead pausado automaticamente.`);
            return;
        }

        if (lead.is_paused) {
            console.log(`⏸️ [TRAVA HUMANA] A IA ignorou ${lead.name} porque o lead está pausado no banco (is_paused = true).`);
        } else {
                const intencao = analisarIntencaoRegex(texto);
            console.log(`🎯 [Filtro] A IA classificou a mensagem de ${lead.name} como: ${intencao}`);
            
      if (intencao === "[ROBO]") {
            console.log(`🤖 [SILÊNCIO] Autoresposta detectada para ${lead.name}. Bot aguardando humano silenciosamente...`);
            await db.saveMessage(lead.whatsapp_id, 'user', `[AUTORESPOSTA] ${texto}`, instanceId);
            await supabase.from('leads').update({ is_paused: true }).eq('id', lead.id); // BLINDAGEM EXTRA: Pausa o lead
            return; // Silêncio total — não arquiva, não responde, apenas aguarda
        }
        }
    }
   // --- 3. PROCESSAMENTO DE MÍDIA INTELIGENTE ---
    if (messageType === 'audioMessage' || messageType === 'imageMessage' || messageType === 'documentMessage') {
        console.log(`📄 [MÍDIA] Analisando arquivo enviado por ${lead.name}...`);
        
        try {
            // 🛡️ PASSO 4: BARREIRA ANTI-CRASH
            // Lemos o tamanho do arquivo nos metadados antes de iniciar o download
            const fileSize = msg.message[messageType]?.fileLength || 0;
            const limiteMaximo = 15 * 1024 * 1024; // 15MB em bytes

            if (fileSize > limiteMaximo) {
                console.log(`⚠️ [BARREIRA] Arquivo de ${lead.name} é muito grande (${(fileSize / 1024 / 1024).toFixed(2)}MB). Abortando download.`);
                
                if (!lead.is_paused) {
                    const msgErroCarga = "Opa, meu sistema não conseguiu carregar esse arquivo por causa do tamanho rs. Consegue me mandar um print da primeira página da fatura? Fica mais fácil de eu ler aqui.";
                    await sock.sendMessage(remoteJid, { text: msgErroCarga });
                    await db.saveMessage(lead.whatsapp_id, 'assistant', msgErroCarga, instanceId);
                }
                return; // Mata o processamento aqui e economiza sua CPU/Banda
            }

            // Se for menor que 15MB, o download segue normalmente
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
                enviarAlerta("⚡ FATURA ANALISADA", `Lead: ${lead.name}\nEconomia: R$ ${economia.descontoReais}/mês`, 3066993);
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
                    const estagioAtual = lead.current_stage || 0;
                    // Só pede fatura se já estamos no estágio 2+ (lead já foi questionado sobre energia)
                    // Nos estágios 0-1, foto de cardápio/produto/catálogo é normal — ignorar silenciosamente
                    if (estagioAtual >= 2) {
                        const chaveAviso = `${lead.id}_foto`;
                        if (!cacheAvisosMidia.has(chaveAviso)) {
                            cacheAvisosMidia.set(chaveAviso, Date.now());
                            setTimeout(() => cacheAvisosMidia.delete(chaveAviso), 5 * 60 * 1000);
                            const msgFoto = "Opa, essa foto parece ser de outra coisa rs. Consegue mandar uma nítida da fatura aberta? Pode ser print do PDF também.";
                            await sock.sendMessage(remoteJid, { text: msgFoto });
                            await db.saveMessage(lead.whatsapp_id, 'assistant', msgFoto, instanceId);
                        }
                    } else {
                        console.log(`📸 [FOTO] Lead ${lead.name} no estágio ${estagioAtual} enviou foto — contexto não é fatura. Ignorando.`);
                    }
                }
                return;
            }
        } catch (err) {
            console.error("❌ Erro em mídia:", err.message);
            return;
        }
    }

    // --- 4. LÓGICA DE RESPOSTA IA (COMPORTAMENTO NA PAUSA) ---
    if (lead.is_paused) {
        if (texto && messageType !== 'audioMessage') {
            await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);
            const intencaoDespertador = analisarIntencaoRegex(texto);
            
            // O lead falou, é humano, mas a pausa foi por intervenção manual do Marlon?
            if (intencaoDespertador === "[HUMANO]" && !lead.manual_pause) {
                // Aqui é o pulo do gato: A IA só "acorda" sozinha se você NUNCA tiver interagido 
                // OU se a sua última interação manual foi há mais de 20 minutos.
                const ultimaInteracaoMs = lead.last_human_interaction ? new Date(lead.last_human_interaction).getTime() : 0;
                const tempoDecorridoMinutos = (Date.now() - ultimaInteracaoMs) / (1000 * 60);

                if (tempoDecorridoMinutos > 20 || !lead.last_human_interaction) {
                    console.log(`⏰ [DESPERTADOR] Lead reengajou sozinho após pausa. Reativando IA...`);
                    await supabase.from('leads').update({ is_paused: false }).eq('id', lead.id);
                    lead.is_paused = false; 

                    // 🧠 HANDOFF REVERSO: A IA vai ler o que você falou antes de voltar a responder
                    if (lead.last_human_interaction) {
                        const histTotal = await db.getHistory(lead.whatsapp_id, instanceId);
                        const resumoHandoff = await handoffAgent.gerarResumoHandoff(histTotal);
                        if (resumoHandoff) {
                            console.log(`🔄 [HANDOFF] Injetando contexto do Marlon: ${resumoHandoff}`);
                            // Salvamos isso como nota interna no banco (vai ser sugado no extras.raioX)
                            await supabase.from('leads').update({ internal_notes: resumoHandoff }).eq('id', lead.id);
                        }
                    }
                } else {
                    console.log(`🤐 [SILÊNCIO] Lead mandou msg, mas o Marlon interagiu há ${Math.round(tempoDecorridoMinutos)} min. Mantendo IA calada.`);
                    return; // Retorna SEM atualizar o is_paused pra false
                }
            } else {
                return; // É robô ou você pausou forçado via /pausar
            }
        } else {
            return;
        }
    }

    const mensagemParaIA = (messageType === 'audioMessage') ? `O cliente enviou um áudio dizendo: "${textoTranscrevido}"` : texto;
    if (!mensagemParaIA) return;


    // 👇 INÍCIO DA TRAVA DE HORÁRIO DE RESPOSTA 👇
    if (!dentroDoExpediente()) {
        console.log(`🌙 [HORÁRIO] Lead ${lead.name} mandou mensagem às ${new Date().getHours()}h. A IA está dormindo e responderá amanhã às 06h.`);
        
        // Salva a mensagem no banco para não perder o contexto
        if (messageType !== 'audioMessage') {
            await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);
        }
        
        // 🛡️ Se for um lead "new", muda para "contact" para garantir que o Vigia ache ele amanhã de manhã
        if (lead.status === 'new') {
            await supabase.from('leads').update({ status: 'contact' }).eq('id', lead.id);
        }
        
        return; // Mata a execução aqui. NÃO joga pra fila do Redis.
    }

    // 👇 INÍCIO DA TRAVA DE RACIOCÍNIO 👇
    if (iaRespondendo.has(lead.whatsapp_id)) {
        console.log(`🛑 [TRAVA DE RACIOCÍNIO] A IA já está formulando uma resposta para ${lead.name}. Guardando a nova mensagem e ignorando disparo duplo.`);
        if (messageType !== 'audioMessage') await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);
        return; 
    }

    iaRespondendo.add(lead.whatsapp_id); // 🔒 TRANCA A PORTA

    try {
        console.log(`📦 [FILA] Enviando lead ${lead.name} para a fila industrial de IA.`);
        
        // 1. Salva a mensagem do usuário imediatamente para não perder contexto
        if (messageType !== 'audioMessage') {
            await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId);
        }
        // 2. Atualiza a temperatura do lead
        if (lead.lead_temperature === 'cold' || !lead.lead_temperature) {
            await supabase.from('leads').update({ lead_temperature: 'warm' }).eq('id', lead.id);
        }

        // 3. JOGA NA FILA DO REDIS (Delega o peso pro Worker)
        await filaMensagensIA.add('gerar_resposta', {
            leadId: lead.id,
            whatsappId: lead.whatsapp_id,
            instanceId: instanceId,
            remoteJid: remoteJid
        }, {
            attempts: 3,           // Se o Llama cair, o sistema tenta de novo sozinho 3x
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true // Mantém a memória do servidor limpa
        });

    } catch (erroFila) {
        console.error(`❌ [ERRO FILA] Falha ao enfileirar ${lead.name}:`, erroFila);
        iaRespondendo.delete(lead.whatsapp_id); // Solta a trava apenas se falhar ao enfileirar
    }
    // OBS: O `finally` com iaRespondendo.delete foi removido daqui!
    // A trava agora só será liberada quando o WORKER terminar de responder.

} // <-- ÚNICO E EXATO FECHAMENTO DA FUNÇÃO processarMensagem

// ============================================================================
// 🔄 MOTOR DE ATAQUE INDEPENDENTE (PARALELISMO POR CHIP)
// ============================================================================
let dataControleLimites = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]; // BRT

// ============================================================================
// 🔄 MOTOR HÍBRIDO DE ATAQUE (RAM + DB) - PRESERVANDO 100% DAS TRAVAS
// ============================================================================
async function processarFilaDeAtaque(instanceId) {
    // 🛡️ TRAVA DE INSTÂNCIA ÚNICA
    if (motoresEmExecucao.has(instanceId)) {
        console.log(`⚠️ [TRAVA] Motor ${instanceId} já rodando. Ignorando duplicata.`);
        return;
    }
    motoresEmExecucao.add(instanceId);
    console.log(`🚀 [MOTOR HÍBRIDO] Fila de ataque ativada para o chip ${instanceId}`);
    
    // ⏰ DESPERTADOR
    const hojeAgora = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0]; // Data em BRT (UTC-3)
    if (dataControleLimites !== hojeAgora) {
        dataControleLimites = hojeAgora;
        console.log(`🌅 [NOVO DIA] Metas diárias zeradas. Chips acordados!`);
    }

    let falhasConsecutivas = 0; 

    try {
        while (true) {
            // 👇 ENTRA AQUI: Trava do Motor Zumbi
            if (!sessions.has(instanceId)) {
                console.log(`🛑 [MOTOR] Chip ${instanceId} removido da RAM. Encerrando motor de ataque definitivamente.`);
                break; // Mata o while(true)
            }

        
            
        let currentLeadId = null; 
            
            if (isBaseVazia(instanceId)) {
                setBaseVazia(instanceId, false);
                console.log(`✨ [FALLBACK] Base voltou a ter leads para ${config.nome}. Modo SAUDAÇÃO retomado.`);
            }
            
            // --- 🛡️ TRAVA DE FADIGA (TURNO DE TRABALHO) ---
            const agoraFadiga = Date.now();
            if (!controleFadiga.has(instanceId)) {
                controleFadiga.set(instanceId, agoraFadiga); // Inicia o cronômetro do turno
            }

            const inicioTurno = controleFadiga.get(instanceId);
            const tempoPassadoMs = agoraFadiga - inicioTurno;
            const limiteTrabalhoMs = HORAS_DE_TRABALHO * 60 * 60 * 1000;

            if (tempoPassadoMs > limiteTrabalhoMs) {
                const tempoDescansoMs = MINUTOS_DE_DESCANSO * 60 * 1000;
                console.log(`☕ [FADIGA] Chip ${instanceId} completou o turno de ${HORAS_DE_TRABALHO}h. Entrando em repouso por ${MINUTOS_DE_DESCANSO}min...`);
                
                await delay(tempoDescansoMs); // Pausa o motor pelo tempo X
                
                controleFadiga.set(instanceId, Date.now()); // Reseta o cronômetro e volta a trabalhar
                console.log(`🔋 [FADIGA] Repouso concluído. Chip ${instanceId} iniciando novo turno.`);
            }

            try {
                if (!dentroDaJanelaDeDisparo(instanceId)) {
                    console.log(`💤 [ECONOMIA] Fora da janela de disparo. Motor pausado.`);
                    break; // 🛑 HÍBRIDO: Morre aqui e libera memória
                }

                const instanceData = await getRegrasEmCache(instanceId);
                if (!instanceData || instanceData.whatsapp_status !== 'CONNECTED') {
                    console.log(`🔕 [MOTOR SILENCIADO] Chip ${instanceId} ignorado. Status: ${instanceData?.whatsapp_status}`);
                    break; // 🛑 HÍBRIDO: Morre aqui se não estiver conectado
                }

                const config = {
                    nome: instanceData.name || `Chip-${instanceId.substring(0, 4)}`,
                    limite: instanceData.daily_limit || 50,
                    agente: instanceData.agent_name || "Agente",
                    empresa: instanceData.company_name || "nossa empresa"
                };

               // ⚡ RESERVA ATÔMICA: SELECT + UPDATE em uma única operação
// Previne que dois chips peguem o mesmo lead ao mesmo tempo
const { data: leadReservado, error } = await supabase.rpc('reservar_proximo_lead', {
    p_instance_id: instanceId
});

if (error) {
    console.error(`❌ [RESERVA ATÔMICA] Erro:`, error.message);
    break;
}

if (!leadReservado || leadReservado.length === 0) {
    console.log(`🌕 [MOTOR HÍBRIDO] Fila limpa para ${config.nome}. Repouso absoluto (0 Egress).`);
    
    // 🎚️ MARCA A BASE COMO VAZIA: Vigia de follow-up vai assumir o turno
    setBaseVazia(instanceId, true);
    timestampUltimaCheckBase = Date.now();
    console.log(`📨 [FALLBACK] Base de leads novos vazia para ${config.nome}. Sistema vai migrar pra FOLLOW-UP automaticamente.`);
    
    break;
}

const lead = leadReservado[0];
currentLeadId = lead.id;

console.log(`🔒 [RESERVA] Lead ${lead.name} travado atomicamente para chip ${config.nome}`);

                // 🛡️ 2. TRAVA NA MEMÓRIA
                if (leadsEmProcessamento.has(lead.id)) { 
                    await delay(5000); 
                    continue; 
                }
                leadsEmProcessamento.add(lead.id);

                // 🎯 3. CHECA LIMITE DIÁRIO
                const enviosHoje = await db.getDailyContactCount(instanceId);
                if (enviosHoje >= config.limite) {
                    console.log(`🌙 [METAS] ${config.nome} atingiu o limite de ${config.limite}. Dormindo.`);
                    enviarAlerta("🌙 LIMITE DIÁRIO", `O chip ${config.nome} bateu a meta de ${config.limite} disparos hoje.`, 3447003);
                    leadsEmProcessamento.delete(lead.id);
                    break; // 🛑 HÍBRIDO: Bateu a meta, desliga a máquina.
                }

                // 🚫 4. CHECA BLACKLIST
                const estaNaBlacklist = await db.isBlacklisted(lead.whatsapp_id);
                if (estaNaBlacklist) {
                    console.log(`🚫 [BLACKLIST] Lead ${lead.name} restrito. Abortando...`);
                    await supabase.from('leads').update({ status: 'blacklisted' }).eq('id', lead.id);
                    leadsEmProcessamento.delete(lead.id);
                    continue; 
                }

                // ⚡ 5. VALIDAÇÃO RÁPIDA DE ZAP
                const instancia = sessions.get(instanceId);
                if (!instancia || !instancia.ready) {
                    console.log(`❌ [FALHA SILENCIOSA] ${config.nome} não está com o canal pronto.`);
                    await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                    leadsEmProcessamento.delete(lead.id);
                    break; // 🛑 HÍBRIDO: Caiu o socket, desliga e espera o próximo arranque
                }

                const hist = await db.getHistory(lead.whatsapp_id, instanceId);
                const [result] = await instancia.sock.onWhatsApp(lead.whatsapp_id);
                
                // 1. O número não tem WhatsApp?
                if (!result?.exists) {
                    if (!lead.backup_tried && lead.backup_whatsapp_id) {
                        console.log(`🔄 [FALLBACK] CNPJ sem WhatsApp! Tombando ${lead.name} para o número reserva do Maps...`);
                        await supabase.from('leads').update({
                            whatsapp_id: lead.backup_whatsapp_id,
                            phone: lead.backup_phone,
                            backup_tried: true,
                            status: 'new' // Devolve pro início da fila
                        }).eq('id', lead.id);
                        leadsEmProcessamento.delete(lead.id);
                        continue; // Pula pro próximo lead e deixa esse ser repescado na próxima rodada
                    } else {
                        console.log(`💀 [DESCARTE] Lead ${lead.name} inválido e sem reserva. Descartando.`);
                        await supabase.from('leads').update({ status: 'invalid' }).eq('id', lead.id);
                        leadsEmProcessamento.delete(lead.id);
                        await delay(2000);
                        continue;
                    }
                }

                // 2. O número já foi contatado antes?
                // Verifica em TODOS os chips (ignora instance_id) — protege contra recontato após redistribuição
                const { data: anyMsg } = await supabase
                    .from('messages')
                    .select('id')
                    .eq('whatsapp_id', lead.whatsapp_id)
                    .limit(1)
                    .maybeSingle();

                if (anyMsg || (hist && hist.length > 0)) {
                    console.log(`⏩ [PULO RÁPIDO] Lead ${lead.name} já tem histórico (chip anterior ou atual). Retornando ao status contact.`);
                    await supabase.from('leads').update({ status: 'contact' }).eq('id', lead.id);
                    leadsEmProcessamento.delete(lead.id);
                    await delay(2000);
                    continue;
                }

                // ⏳ 6. JITTER SEQUENCIAL ORIGINAL (Intacto)
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

              // 8. MONTAGEM DA SAUDAÇÃO — BALÃO ÚNICO (FIX #1 + #2 + #10)
              
              // 🚦 SEMÁFORO: Saudação tem PRIORIDADE 1 — toma vaga de qualquer follow-up rodando
              const semaforoOk = await adquirirSemaforoChip(instanceId, 'SAUDACAO');
              if (!semaforoOk) {
                  console.log(`⏸️ [SAUDACAO] Chip ${config.nome} ocupado/cooldown. Devolvendo ${lead.name} pra fila e aguardando 30s...`);
                  await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                  leadsEmProcessamento.delete(lead.id);
                  await delay(30000);
                  continue;
              }

console.log(`🚀 [DISPARANDO] ${config.nome} enviando saudação para ${lead.name}...`);
await instancia.sock.sendPresenceUpdate('composing', cleanJid);
await delay(Math.random() * 4000 + 4000);
await instancia.sock.sendPresenceUpdate('paused', cleanJid);

// extrairNomeHumano filtra nomes de empresa, siglas jurídicas e palavras de blacklist
// Se lead.dono for "Catatau Comércio LTDA", retorna null → saudação genérica
const primeiroNomeDono = extrairNomeHumano(lead.dono);

const ufLead = lead.estado || null;
// 🎯 LIMPEZA ESTÉTICA PARA ABERTURA: Corta nomes compostos para soar natural
const concessionariaLocal = (MAPA_CONCESSIONARIAS[ufLead] || 'concessionária de energia').split('/')[0];

const nomeEmpresa = limparNomeEmpresa(lead.name);

// ── BALÃO ÚNICO: curiosidade + qualificação casual numa só mensagem ──
const saudacao = primeiroNomeDono ? `Oi ${primeiroNomeDono}` : 'Oi, tudo bem?';
const bairroLead = lead.bairro || lead.cidade || 'sua região';

// Substitui variáveis nos templates vindos do Supabase
const substituirVarsAbertura = (tpl) => tpl
    .replace(/\$\{saudacao\}/g, saudacao)
    .replace(/\$\{nomeEmpresa\}/g, nomeEmpresa)
    .replace(/\$\{concessionariaLocal\}/g, concessionariaLocal)
    .replace(/\$\{bairroLead\}/g, bairroLead)
    .replace(/\$\{origem\}/g, lead.origin_company_name || '')
    .replace(/\s*--\s*/g, ', ') // remove em-dash do template antes de enviar
    .trim();

// Tenta usar templates do Supabase; cai no hardcoded se não houver
const tplsInstancia = instanceData?.opening_templates;
let variacoesAbertura;

if (tplsInstancia && Array.isArray(tplsInstancia.decisor) && lead.is_decisor && lead.origin_company_name) {
    // Decisor com template customizado no Supabase
    variacoesAbertura = tplsInstancia.decisor.map(substituirVarsAbertura);
} else if (lead.is_decisor && lead.origin_company_name) {
    // Decisor sem template customizado → hardcoded com contexto de repasse
    // (não cai no padrao para preservar o "me indicaram vc")
    variacoesAbertura = tplsInstancia && Array.isArray(tplsInstancia.decisor_fallback)
        ? tplsInstancia.decisor_fallback.map(substituirVarsAbertura)
        : [
            `${saudacao}, o pessoal da ${lead.origin_company_name} me passou seu contato. Tenho uma informação que achei que valia compartilhar — vc que cuida da parte comercial/financeira aí?`,
            `${saudacao}, falei com a equipe da ${lead.origin_company_name} e me indicaram vc. Queria confirmar uma coisa rápida — é vc que responde por essa área?`,
          ];
} else if (tplsInstancia && Array.isArray(tplsInstancia.padrao) && tplsInstancia.padrao.length > 0) {
    variacoesAbertura = tplsInstancia.padrao.map(substituirVarsAbertura);
} else {
    // fallback hardcoded padrão
    variacoesAbertura = [
        `${saudacao}, vi algo sobre a conta de energia da ${nomeEmpresa} que achei que valia te passar. Vc cuida dessa parte de contas fixas aí?`,
        `${saudacao}, dei uma olhada no cadastro da ${nomeEmpresa} e tem uma coisa sobre a conta de luz da ${concessionariaLocal} que achei que valia te avisar. Tô falando com quem cuida disso?`,
        `${saudacao}, mapeamos empresas da região que podem estar pagando a mais na ${concessionariaLocal}. A ${nomeEmpresa} apareceu na lista. Vc é quem cuida dessa parte?`
    ];
}

const templateIndex = Math.floor(Math.random() * variacoesAbertura.length);
const balaoUnico = variacoesAbertura[templateIndex];
const templateName = `abertura_v${templateIndex + 1}${lead.is_decisor ? '_decisor' : ''}`;
const mensagensSplit = [balaoUnico]; // ← BALÃO ÚNICO (era [balao1, balao2])

                // 9. FATIADOR HUMANO E ENVIO (Com interrupção intacta!)
                
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
                await supabase.from('leads').update({ status: 'contact', last_contact_at: new Date().toISOString(), opening_template: templateName }).eq('id', lead.id);
                console.log(`✅ [SUCESSO REAL] Entregue por ${config.nome} para ${lead.name}!`);
                leadsEmProcessamento.delete(lead.id);
                liberarSemaforoChip(instanceId); // 🚦 Libera vaga e marca cooldown
                falhasConsecutivas = 0;
                
            } catch (errInner) {
                // SEU CATCH ORIGINAL DE FALHAS CONSECUTIVAS
                console.error(`❌ Erro no motor do chip ${instanceId}:`, errInner.message);
                if (currentLeadId) {
                    leadsEmProcessamento.delete(currentLeadId);
                      liberarSemaforoChip(instanceId);
                    await supabase.from('leads').update({ status: 'new' }).eq('id', currentLeadId).eq('status', 'reservado');
                }
                if (errInner.message?.includes('Connection') || errInner.message?.includes('Socket')) {
                    console.log(`🔄 [MOTOR] Chip ${instanceId} com erro de conexão. Pausando loop.`);
                    break; // 🛑 HÍBRIDO: Erro de rede? Desliga e espera o Vigia tentar de novo em 30 min.
                }
                falhasConsecutivas++;
                await delay(Math.min(10000 * Math.pow(2, falhasConsecutivas - 1), 300000)); 
            }
        } // <-- Fim do while(true)

    } finally {
        // 🔓 SEMPRE solta a trava quando a função termina (seja por break ou erro fatal)
        motoresEmExecucao.delete(instanceId);
        controleFadiga.delete(instanceId); // Reseta o timer para o próximo ciclo começar do zero
    }
}


// ============================================================================
// 🔄 LOOP TRIPLO DE RECUPERAÇÃO E FOLLOW-UP (OTIMIZADO)
// ============================================================================
let vigiaEmExecucao = false; 

async function loopRecuperacaoConversas() {
    // 🛡️ 1. BLOQUEIO DE CLONES: Se o vigia anterior ainda estiver rodando, o novo nem entra.
    if (vigiaEmExecucao) return; 
    vigiaEmExecucao = true; 

    try {
        // 🛑 TRAVA DO EXPEDIENTE: Apenas sai. O 'finally' agenda a próxima tentativa.
        if (!dentroDoExpediente()) {
            console.log("💤 [VIGIA] Fora do expediente. Pausando monitoramento.");
            return; 
        }

        // 🎚️ MODO OPERACIONAL: Sub-loops do vigia se comportam diferente em SAUDAÇÃO vs FOLLOW-UP
        const modoAtual = getModoOperacional();
        const podeFazerFollowup = (modoAtual === 'FOLLOWUP');

        console.log(`🕵️ [VIGIA] Modo atual: ${modoAtual}. Follow-ups ${podeFazerFollowup ? 'ATIVOS ✅' : 'BLOQUEADOS ⏸️'}`);
    
        const agora = Date.now();
        const UM_DIA = 24 * 60 * 60 * 1000;
        const QUATRO_HORAS = 4 * 60 * 60 * 1000;
        const dataAgoraDate = new Date(agora);

        // ====================================================================
        // 🌟 1. RECUPERAÇÃO DE FALHAS (O Bot ignorou o cliente)
        // ====================================================================
        // Filtra apenas leads dos chips atualmente ativos — isolamento entre tenants
        const chipsAtivos = [...sessions.keys()];
        if (chipsAtivos.length === 0) return;

        const { data: leadsAtivos } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, is_paused')
            .eq('status', 'contact')
            .eq('is_paused', false)
            .in('instance_id', chipsAtivos)
            .order('last_contact_at', { ascending: false })
            .limit(20);

        if (leadsAtivos) {
            for (const l of leadsAtivos) {
                try {
                    const { data: mensagens } = await supabase
                        .from('messages')
                        .select('role, content')
                        .eq('whatsapp_id', l.whatsapp_id)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (mensagens && mensagens.length > 0) {
                        const ultimaMsg = mensagens[0];
                        if (ultimaMsg.role === 'user' && !ultimaMsg.content?.startsWith('[AUTORESPOSTA]')) {
                            if (iaRespondendo.has(l.whatsapp_id)) continue; 
                            
                           console.log(`⚠️ [SALVAMENTO] Lead ${l.name} aguardando resposta. Reativando IA...`);
                            const instancia = sessions.get(l.instance_id);
                            if (instancia && instancia.ready) {
                                // 🚦 SEMÁFORO: Recuperação tem prioridade 2 (cede pra saudação)
                                const semaforoOk = await adquirirSemaforoChip(l.instance_id, 'RECUPERACAO');
                                if (!semaforoOk) {
                                    console.log(`⏸️ [RECUPERACAO] Chip ocupado. Pulando ${l.name} desta rodada.`);
                                    continue;
                                }
                                
                                await processarMensagemManual(instancia.sock, l);
                                liberarSemaforoChip(l.instance_id); // 🚦 Libera vaga

                                // 🛡️ ANTI-BAN: Jitter humano entre recuperações
                                const jitterRecuperacao = Math.floor(Math.random() * 30000) + 30000;
                                console.log(`⏸️ [ANTI-BAN] Aguardando ${Math.round(jitterRecuperacao/1000)}s antes da próxima recuperação...`);
                                await delay(jitterRecuperacao);
                            }

                        }
                    }
                } catch (errLeadAtivo) {
                    console.error(`❌ Erro ao recuperar ${l.name}:`, errLeadAtivo.message);
                }
            }
        }

        // ====================================================================
        // 🚀 2. FOLLOW-UP D1 + D3 + TOMBAMENTO POR SILÊNCIO (ANTES DO LINK)
        // ====================================================================
        // 🎚️ Só roda nas janelas de FOLLOWUP (10h-11h, 17h-18h) ou se base vazia
        const { data: leadsFollowUp } = podeFazerFollowup ? await supabase
    .from('leads')
    .select('id, name, whatsapp_id, instance_id, dono, followup_count, last_contact_at, backup_phone, backup_whatsapp_id, backup_tried')
    .eq('status', 'contact')
    .eq('is_paused', false)
    .eq('calendly_booked', false)
    .is('link_sent_at', null)
    .lt('followup_count', 3)
    .in('instance_id', chipsAtivos)
    .order('last_contact_at', { ascending: true })
    .limit(5)
    : { data: null };

        if (leadsFollowUp) {
            for (const lf of leadsFollowUp) {
                try {
                    // Só pula se respondeu nos últimos 7 dias — não bloqueia leads reativados com histórico antigo
                    const seteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString();
                    const { data: temResposta } = await supabase.from('messages').select('id')
                        .eq('whatsapp_id', lf.whatsapp_id)
                        .eq('role', 'user')
                        .gte('created_at', seteDiasAtras)
                        .limit(1);
                    if (temResposta && temResposta.length > 0) continue;

                    const diasPassados = (agora - new Date(lf.last_contact_at).getTime()) / UM_DIA;
                    const followupAtual = lf.followup_count || 0;
                    // D1 espera 1 dia, D3 espera 2 dias após D1, tombamento espera 1 dia após D3
                    const minimosDias = followupAtual === 0 ? 1 : 2;
                    if (diasPassados < minimosDias) continue;

                    const instancia = sessions.get(lf.instance_id);
                    if (!instancia || !instancia.ready) continue;

                    if (followupAtual === 0) {
                        let primeiroNome = lf.dono && lf.dono.trim().length > 2 ? lf.dono.trim().split(' ')[0] : 'Opa';
                        primeiroNome = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);
                        const nomeEmpresa = (lf.name || 'empresa').replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim();

                        const msgFollowUp = `${primeiroNome}, conseguiu dar uma olhada na mensagem acima? Como a gente tem poucas vagas com isenção pra região, queria confirmar se faz sentido pra ${nomeEmpresa} antes de liberar o espaço.`;

                        // 🚦 SEMÁFORO: Follow-up D1 tem prioridade 3 (cede pra saudação E recuperação)
                        const semaforoOk = await adquirirSemaforoChip(lf.instance_id, 'FOLLOWUP');
                        if (!semaforoOk) {
                            console.log(`⏸️ [FOLLOWUP-D1] Chip ocupado por prioridade maior. Pulando ${lf.name} desta rodada.`);
                            continue;
                        }
                        
                        console.log(`🔔 [FOLLOW-UP D1] Disparando para ${lf.name}`);
await instancia.sock.sendPresenceUpdate('composing', lf.whatsapp_id);

// ⏳ Tempo de "digitação" proporcional ao tamanho da mensagem (humanização)
const tempoDigitacao = Math.min(Math.max(msgFollowUp.length * 80, 4000), 9000);
await delay(tempoDigitacao);

await enviarMensagemIA(instancia.sock, lf.whatsapp_id, { text: msgFollowUp });
await db.saveMessage(lf.whatsapp_id, 'assistant', msgFollowUp, lf.instance_id);

await supabase.from('leads').update({ followup_count: 1, last_contact_at: dataAgoraDate.toISOString() }).eq('id', lf.id);
liberarSemaforoChip(lf.instance_id); // 🚦 Libera vaga

// 🛡️ ANTI-BAN: Jitter de 60-120 segundos entre follow-ups do mesmo chip
// (antes era só 8s — ban iminente)
const jitterAntiBan = Math.floor(Math.random() * 60000) + 60000;
console.log(`⏸️ [ANTI-BAN] Aguardando ${Math.round(jitterAntiBan/1000)}s antes do próximo follow-up...`);
await delay(jitterAntiBan);
                    }
                    else if (followupAtual === 1) {
                        // D3 — segunda e última tentativa antes do tombamento
                        let primeiroNome = lf.dono && lf.dono.trim().length > 2 ? lf.dono.trim().split(' ')[0] : 'Opa';
                        primeiroNome = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);
                        const nomeEmpresa = (lf.name || 'empresa').replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim();

                        const msgD3 = `${primeiroNome}, última tentativa da minha parte. Se a conversa sobre a ${nomeEmpresa} ainda fizer sentido, é só me responder aqui. Se não for a hora certa, sem problema — desejo sucesso pra vcs!`;

                        const semaforoOk = await adquirirSemaforoChip(lf.instance_id, 'FOLLOWUP');
                        if (!semaforoOk) { continue; }

                        console.log(`🔔 [FOLLOW-UP D3] Disparando para ${lf.name}`);
                        await instancia.sock.sendPresenceUpdate('composing', lf.whatsapp_id);
                        await delay(Math.min(Math.max(msgD3.length * 80, 4000), 9000));
                        await enviarMensagemIA(instancia.sock, lf.whatsapp_id, { text: msgD3 });
                        await db.saveMessage(lf.whatsapp_id, 'assistant', msgD3, lf.instance_id);
                        await supabase.from('leads').update({ followup_count: 2, last_contact_at: dataAgoraDate.toISOString() }).eq('id', lf.id);
                        liberarSemaforoChip(lf.instance_id);
                        await delay(Math.floor(Math.random() * 60000) + 60000);
                    }
                    else if (followupAtual === 2) {
                        // Tombamento após D3 sem resposta
                        if (!lf.backup_tried && lf.backup_whatsapp_id) {
                            console.log(`🔄 [SILÊNCIO TOTAL] Lead ${lf.name} ignorou D1+D3. Tombando para backup...`);
                            await supabase.from('leads').update({
                                whatsapp_id: lf.backup_whatsapp_id,
                                phone: lf.backup_phone,
                                backup_tried: true,
                                status: 'new',
                                followup_count: 0
                            }).eq('id', lf.id);
                        } else {
                            console.log(`💀 [DESCARTE] Lead ${lf.name} ignorou D1+D3 sem reserva. Movendo para DEAD.`);
                            await supabase.from('leads').update({ status: 'dead', lead_temperature: 'dead' }).eq('id', lf.id);
                        }
                    }
                } catch (errFollow) { console.error(`❌ Erro Follow-up ${lf.name}:`, errFollow.message); }
            }
        }

        // ====================================================================
        // 🔗 3. ABANDONO DE CARRINHO (LINK ENVIADO, MAS SEM AGENDAMENTO)
        // ====================================================================
        const quatroHorasAtrasISO = new Date(agora - QUATRO_HORAS).toISOString();
        
        // 🎚️ Só roda nas janelas de FOLLOWUP ou se base vazia
        const { data: leadsLink } = podeFazerFollowup ? await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, dono')
            .eq('status', 'contact')
            .eq('is_paused', false)
            .eq('calendly_booked', false)
            .not('link_sent_at', 'is', null)
            .lt('link_sent_at', quatroHorasAtrasISO)
            .is('last_followup_type', null)
            .in('instance_id', chipsAtivos)
            .limit(3)
            : { data: null };

        if (leadsLink) {
            for (const ll of leadsLink) {
                try {
                    const instancia = sessions.get(ll.instance_id);
                    if (!instancia || !instancia.ready || iaRespondendo.has(ll.whatsapp_id)) continue;

                    // 🛡️ FAIL-SAFE: Culpa o sistema para não ofender se ele já tiver agendado
                    let primeiroNome = ll.dono && ll.dono.trim().length > 2 ? ll.dono.trim().split(' ')[0] : 'Opa';
                    primeiroNome = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);
                    
                    const msgFollowUpLink = `${primeiroNome}, meu sistema de agenda deu uma travada hoje. Vc conseguiu travar o seu horário lá no link ou deu erro aí também?`;

                 // 🚦 SEMÁFORO: Follow-up Link tem prioridade 4 (a mais baixa, cede pra todos)
                    const semaforoOk = await adquirirSemaforoChip(ll.instance_id, 'FOLLOWUP_LINK');
                    if (!semaforoOk) {
                        console.log(`⏸️ [FOLLOWUP-LINK] Chip ocupado por prioridade maior. Pulando ${ll.name} desta rodada.`);
                        continue;
                    }
                    
                    console.log(`🔔 [FOLLOW-UP LINK] Recuperando abandono de ${ll.name}`);
await instancia.sock.sendPresenceUpdate('composing', ll.whatsapp_id);

const tempoDigitacaoLink = Math.min(Math.max(msgFollowUpLink.length * 80, 4000), 9000);
await delay(tempoDigitacaoLink);

await enviarMensagemIA(instancia.sock, ll.whatsapp_id, { text: msgFollowUpLink });
await db.saveMessage(ll.whatsapp_id, 'assistant', msgFollowUpLink, ll.instance_id);

await supabase.from('leads').update({ last_followup_type: 'link_abandoned' }).eq('id', ll.id);
liberarSemaforoChip(ll.instance_id); // 🚦 Libera vaga

// 🛡️ ANTI-BAN: Jitter de 60-120s
const jitterAntiBan = Math.floor(Math.random() * 60000) + 60000;
console.log(`⏸️ [ANTI-BAN] Aguardando ${Math.round(jitterAntiBan/1000)}s antes do próximo follow-up...`);
await delay(jitterAntiBan);

                } catch (errLink) { console.error(`❌ Erro Follow-up Link ${ll.name}:`, errLink.message); }
            }
        }

        // ====================================================================
        // 👤 4. RETOMADA APÓS INTERVENÇÃO HUMANA (20 MINUTOS)
        // ====================================================================
        const { data: leadsPausados } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, is_paused, manual_pause, last_human_interaction')
            .eq('is_paused', true)
            .in('instance_id', chipsAtivos);

        if (leadsPausados) {
            for (const lp of leadsPausados) {
                if (!lp.last_human_interaction || lp.manual_pause) continue; 

                const vinteMinutosEmMs = 20 * 60 * 1000; // Atualizado para 20 min para bater com o novo Anti-Atropelo
                const ultimaInteracao = new Date(lp.last_human_interaction).getTime();
                const diff = agora - ultimaInteracao;

                if (diff > vinteMinutosEmMs) {
                    if (iaRespondendo.has(lp.whatsapp_id)) continue;
                    
                    console.log(`🔄 [RETOMADA] Tempo de humano esgotado para ${lp.name}. Voltando para IA.`);
                    await supabase.from('leads').update({ is_paused: false }).eq('id', lp.id);

                    const instancia = sessions.get(lp.instance_id);
                    if (instancia && instancia.ready) {
                        // 🚦 SEMÁFORO: Retomada tem prioridade 2 (mesma que recuperação)
                        const semaforoOk = await adquirirSemaforoChip(lp.instance_id, 'RECUPERACAO');
                        if (!semaforoOk) {
                            console.log(`⏸️ [RETOMADA] Chip ocupado. Pulando ${lp.name} desta rodada.`);
                            continue;
                        }
                        
                        await processarMensagemManual(instancia.sock, lp);
                        liberarSemaforoChip(lp.instance_id); // 🚦 Libera vaga

                         // 🛡️ ANTI-BAN: Jitter humano entre retomadas
                        const jitterRetomada = Math.floor(Math.random() * 45000) + 45000;
                        console.log(`⏸️ [ANTI-BAN] Aguardando ${Math.round(jitterRetomada/1000)}s antes da próxima retomada...`);
                        await delay(jitterRetomada);
                    }
                }
            }
        }

        // ====================================================================
        // 📅 5. LEMBRETE 24H ANTES DA REUNIÃO (roda em janela de trabalho)
        // ====================================================================
        if (dentroDoExpediente()) {
            const vinteQuatroHorasISO   = new Date(agora + 24 * 60 * 60 * 1000).toISOString();
            const vinteCincoHorasISO    = new Date(agora + 25 * 60 * 60 * 1000).toISOString();

            const { data: leadsReuniao } = await supabase
                .from('leads')
                .select('id, name, whatsapp_id, instance_id, dono, calendly_event_at')
                .eq('status', 'closed')
                .eq('calendly_booked', true)
                .is('reminder_sent', null)
                .gte('calendly_event_at', vinteQuatroHorasISO)
                .lte('calendly_event_at', vinteCincoHorasISO)
                .limit(3);

            if (leadsReuniao && leadsReuniao.length > 0) {
                for (const lr of leadsReuniao) {
                    const instanciaL = sessions.get(lr.instance_id);
                    if (!instanciaL || !instanciaL.ready) continue;

                    const dataObj = new Date(lr.calendly_event_at);
                    const horaF   = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    const nome    = lr.dono?.split(' ')?.[0] || 'você';
                    const instanceData = await getRegrasEmCache(lr.instance_id);

                    const msgLembrete = instanceData?.opening_templates?.lembrete_reuniao
                        || `${nome}, só passando pra lembrar da nossa conversa amanhã às ${horaF}. Até lá!`;

                    await enviarMensagemIA(instanciaL.sock, lr.whatsapp_id, { text: msgLembrete });
                    await db.saveMessage(lr.whatsapp_id, 'assistant', msgLembrete, lr.instance_id);
                    await supabase.from('leads').update({ reminder_sent: new Date().toISOString() }).eq('id', lr.id);
                    console.log(`🔔 [LEMBRETE] Enviado para ${lr.name} — reunião às ${horaF}`);
                    await delay(Math.floor(Math.random() * 30000) + 30000);
                }
            }
        }

        // ====================================================================
        // 🔄 6. REATIVAÇÃO DE LEADS FRIOS (roda 1x por dia, janela FOLLOWUP)
        // ====================================================================
        const QUARENTA_CINCO_DIAS = 45 * 24 * 60 * 60 * 1000;
        const agora45 = Date.now();
        const deveReativar = podeFazerFollowup &&
            (!global.ultimaReativacaoLeadsFrios || agora45 - global.ultimaReativacaoLeadsFrios > 23 * 60 * 60 * 1000);

        if (deveReativar) {
            global.ultimaReativacaoLeadsFrios = agora45;
            const quarentaCincoDiasAtrasISO = new Date(agora45 - QUARENTA_CINCO_DIAS).toISOString();

            const { data: leadsFrios } = await supabase
                .from('leads')
                .select('id, name, current_stage, internal_notes, last_contact_at')
                .eq('lead_temperature', 'dead')
                .lt('last_contact_at', quarentaCincoDiasAtrasISO)
                .in('instance_id', chipsAtivos)
                .limit(3);

            if (leadsFrios && leadsFrios.length > 0) {
                console.log(`🔄 [REATIVAÇÃO] ${leadsFrios.length} lead(s) frio(s) encontrado(s) para reativação.`);
                for (const lf of leadsFrios) {
                    // Não reativa se já foi reativado antes
                    if (lf.internal_notes?.includes('[REATIVADO]')) continue;

                    const mesesFrio = Math.round((agora45 - new Date(lf.last_contact_at).getTime()) / (30 * 24 * 60 * 60 * 1000));
                    const notaReativacao = `[REATIVADO] Lead ficou frio por ~${mesesFrio} meses. Use um ângulo completamente novo — mencione que o cenário de tarifas mudou desde a última conversa. Seja curto e despretensioso. NÃO repita o pitch anterior.`;
                    const notasAtuais = lf.internal_notes ? `${lf.internal_notes}\n${notaReativacao}` : notaReativacao;

                    await supabase.from('leads').update({
                        lead_temperature: 'cold',
                        status: 'contact',
                        is_paused: false,
                        followup_count: 0,
                        link_sent_at: null,
                        last_followup_type: null,
                        internal_notes: notasAtuais
                    }).eq('id', lf.id);

                    console.log(`✅ [REATIVAÇÃO] ${lf.name} reativado após ${mesesFrio} meses frio.`);
                }
            }
        }

    } catch (errGeral) {
        console.error("❌ [ERRO CRÍTICO] Falha no motor de recuperação:", errGeral.message);
    } finally {
        // 🔓 LIBERA O BLOQUEIO E AGENDA O PRÓXIMO CICLO
        vigiaEmExecucao = false;
        setTimeout(loopRecuperacaoConversas, 1000 * 60 * 5); // Roda a cada 5 minutos
    }
}

// ============================================================================
// 📋 MOTOR DE AUDITORIA (POST-MORTEM QA)
// ============================================================================
let auditorEmExecucao = false;

async function loopAuditor() {
    if (auditorEmExecucao) return;
    auditorEmExecucao = true;

    try {
        // Filtra apenas leads dos chips ativos — isolamento entre tenants
        const chipsAudit = [...sessions.keys()];
        if (!chipsAudit.length) { auditorEmExecucao = false; return; }

        const { data: leadsParaAuditar } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, status, niche')
            .in('status', ['booked', 'dead', 'invalid'])
            .eq('is_audited', false)
            .in('instance_id', chipsAudit)
            .limit(5);

        if (leadsParaAuditar && leadsParaAuditar.length > 0) {
            console.log(`📋 [QA AUDITOR] ${leadsParaAuditar.length} leads na fila. Iniciando análise...`);

            let auditadosComSucesso = 0;
            let errosCriticosEncontrados = [];

            for (const lead of leadsParaAuditar) {
                const histRaw = await db.getHistory(lead.whatsapp_id, lead.instance_id);

                if (!histRaw || histRaw.length <= 2) {
                    // Sem conversa suficiente: sai da fila sem gastar tokens
                    await supabase.from('leads').update({
                        is_audited:   true,
                        audit_report: { desfecho: 'PERDIDO_SILENCIO', nota_ia: null, erro_critico_ia: null, resumo_executivo: 'Sem interação suficiente para auditoria.' }
                    }).eq('id', lead.id);
                    continue;
                }

                const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
                const relatorio = await auditorAgent.gerarAuditoria(historico, lead);

                if (!relatorio) continue; // LLM falhou — tenta na próxima rodada

                await supabase.from('leads').update({
                    audit_report: relatorio,
                    is_audited:   true,
                }).eq('id', lead.id);

                auditadosComSucesso++;
                console.log(`✅ [QA AUDITOR] ${lead.name} — desfecho: ${relatorio.desfecho} | nota: ${relatorio.nota_ia}`);

                // Emite para o dashboard em tempo real
                if (ioSocket) {
                    ioSocket.emit('audit_complete', {
                        leadId:   lead.id,
                        leadName: lead.name,
                        relatorio,
                    });
                }

                // Discord só para erros críticos (nota < 6 ou erro explícito) — sem spam
                if (relatorio.nota_ia < 6 || relatorio.erro_critico_ia) {
                    errosCriticosEncontrados.push(`*${lead.name}* (${relatorio.desfecho}) — nota ${relatorio.nota_ia}: ${relatorio.erro_critico_ia || 'sem detalhe'}`);
                }
            }

            // Um único alerta consolidado por ciclo, somente se houver erros graves
            if (errosCriticosEncontrados.length > 0) {
                enviarAlerta(
                    `⚠️ QA — ${errosCriticosEncontrados.length} conversa(s) com nota baixa`,
                    errosCriticosEncontrados.join('\n'),
                    15158332
                );
            }

            if (auditadosComSucesso > 0) {
                console.log(`📊 [QA AUDITOR] Ciclo encerrado: ${auditadosComSucesso} relatórios gerados.`);
            }
        }
    } catch (erroAuditor) {
        console.error("❌ [QA AUDITOR] Erro na varredura:", erroAuditor.message);
    } finally {
        auditorEmExecucao = false;
        // Roda a cada 2 horas (7200000 ms) para não gastar tokens à toa
        setTimeout(loopAuditor, 7200000); 
    }
}

async function processarMensagemManual(sock, lead) {
    // 🛡️ BLINDAGEM ANTI-BAN: Não responde proativamente em domingos / fora do expediente
    if (!dentroDoExpediente()) {
        console.log(`💤 [RECUPERAÇÃO] Fora do expediente. Lead ${lead.name} aguardará dia útil.`);
        return;
    }

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
        const instanceData = await getRegrasEmCache(instanceId);
        
        let resposta = await gerarRespostaIA(historico, lead, instanceData);
        await filtrarEEnviarResposta(sock, remoteJid, resposta, historico, lead, instanceId);

    } catch (erroRecuperacao) {
        console.error(`❌ [ERRO RECUPERAÇÃO] Falha para ${lead.name}:`, erroRecuperacao.message);
    } finally {
        iaRespondendo.delete(lead.whatsapp_id); // 🔓 SEMPRE libera a trava
        console.log(`🔓 [TRAVA RECUPERAÇÃO LIBERADA] ${lead.name} livre novamente.`);
    }
}

// ============================================================================
// 🏭 WORKER DA FILA (A FÁBRICA INDUSTRIAL DE RESPOSTAS)
// ============================================================================
const workerIA = new Worker('FilaIA', async (job) => {
    const { leadId, whatsappId, instanceId, remoteJid } = job.data;
    console.log(`⚙️ [WORKER] Processando o job de IA para o WhatsApp ID: ${whatsappId}`);
    
    try {
        // 1. Recupera os dados frescos do lead
        const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
        if (!lead) throw new Error("Lead não encontrado no banco.");

        // 🎯 Detecção de estados finais — evita IA tentar vender num funil já encerrado
const estadosFinais = ['dead', 'invalid', 'blacklisted', 'booked'];
const funilEncerrado = estadosFinais.includes(lead.status);

if (funilEncerrado) {
    console.log(`🏁 [WORKER] Lead ${lead.name} tem funil encerrado (status: ${lead.status}). IA seguirá em modo pós-venda/encerrado.`);
}
        // 2. Recupera o Socket (Baileys) do chip deste cliente específico
        const instancia = sessions.get(instanceId);
        if (!instancia || !instancia.ready) throw new Error("Socket do WhatsApp não está conectado.");

        // 3. Monta o contexto pesado
        const histRaw = await db.getHistory(whatsappId, instanceId);
        const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
        const instanceData = await getRegrasEmCache(instanceId);

// 🚀 Executa os 3 agentes EM PARALELO com SKIP INTELIGENTE
        console.log(`🧠 [WORKER-IA] Despachando Router + Intel + Profiler em paralelo para ${lead.name}...`);
        const ultimaMsg = historico[historico.length - 1].content;

        // 🎯 Mensagens de 1-2 palavras ("oi", "ok", "sim") não geram análise útil
        // e fazem o Intel alucinar. Então pulamos esses 2 agentes e economizamos ~1.5s + evitamos invenção.
        const msgCurta = ultimaMsg.trim().split(/\s+/).length <= 2;

        const promessas = [
            routerAgent.classificarMensagem(ultimaMsg),
            msgCurta
                ? Promise.resolve("Conversa muito curta para análise. Seguir Constituição padrão.")
                : intelAgent.analisarEmpresa(historico, lead),
            msgCurta
                ? Promise.resolve("Perfil neutro — mensagem curta sem carga emocional clara.")
                : profilerAgent.analisarPerfil(ultimaMsg)
        ];

        const [intencao, raioXDoLead, perfilEmocional] = await Promise.all(promessas);

        if (msgCurta) {
            console.log(`⚡ [SKIP] Mensagem curta ("${ultimaMsg.substring(0, 30)}"). Intel + Profiler pulados.`);
        }
        console.log(`🎯 [ROTEADOR] Intenção: ${intencao}`);
        console.log(`📊 [RAIO-X]: ${raioXDoLead}`);
        console.log(`🧠 [PROFILER]: ${perfilEmocional}`);

        // --- BUSCA DA CONSTITUIÇÃO NO BANCO ---
// 🛡️ Busca user_id com fallback em cascata (instanceData → lead.instance_id → instanceId do job)
let userId = instanceData?.user_id;

if (!userId) {
    // Prioriza SEMPRE o instanceId do job (sempre válido, veio do Baileys)
    const instanceIdParaBuscar = instanceId || lead.instance_id;
    
    if (instanceIdParaBuscar) {
        const { data: inst } = await supabase
            .from('instances')
            .select('user_id')
            .eq('id', instanceIdParaBuscar)
            .maybeSingle();
        userId = inst?.user_id;

        // 🔗 Já aproveita e amarra o lead ao chip (corrige leads órfãos)
        if (userId && lead.instance_id !== instanceIdParaBuscar) {
            await supabase.from('leads').update({ instance_id: instanceIdParaBuscar }).eq('id', lead.id);
            lead.instance_id = instanceIdParaBuscar;
            console.log(`🔗 [WORKER] Lead ${lead.name} vinculado ao chip ${instanceIdParaBuscar}`);
        }
    }
}

if (!userId) {
    console.error(`❌ [WORKER] user_id não encontrado para lead ${lead.name} (instance_id: ${lead.instance_id}, job instanceId: ${instanceId}). Abortando.`);
    return;
}

const { data: brain } = await supabase.from('tenant_prompts').select('system_prompt').eq('user_id', userId).maybeSingle();
const promptBase = brain?.system_prompt;

if (!promptBase || promptBase.trim().length < 100) {
    console.error(`❌ [WORKER] Prompt não configurado para user_id ${userId}. Abortando.`);
    return;
}

// 🧠 Resolve TODAS as variáveis de uma vez (inclui Raio-X e Profiler como extras)
const promptResolvido = await resolverPromptCompleto(
    promptBase,
    lead,
    instanceData,
    historico,
    { raioXDoLead, perfilEmocional }
);

if (!promptResolvido) {
    console.error(`❌ [WORKER] Falha ao resolver prompt para ${lead.name}. Abortando.`);
    return;
}
        // -----------------------------------------------------------------------------

        let resposta;
        
        // 4.2. Delegação aos Especialistas (Elite Squad)
        if (intencao === 'ROBO') {
    console.log(`🤖 [WORKER-IA] Robô/autoresposta detectado para ${lead.name}. Pausando lead sem responder.`);
    await supabase.from('leads').update({
        status: 'invalid',
        is_paused: true,
        internal_notes: `Autoresposta/robô detectado em ${new Date().toLocaleString('pt-BR')}. Sem resposta enviada.`
    }).eq('id', lead.id);
    return; // Não envia nada, não chama nenhum agente
}

        if (intencao === 'ENCERRAMENTO') {
    console.log(`👋 [WORKER-IA] ENCERRAMENTO detectado. Finalizando conversa educadamente e pausando o lead...`);
    
    // Pausa o lead pra o vigia não insistir nessa conversa já finalizada
    await supabase.from('leads').update({ 
        is_paused: true,
        manual_pause: false,
        internal_notes: `Conversa encerrada cordialmente em ${new Date().toLocaleString('pt-BR')}.`
    }).eq('id', lead.id);
    
    // Não gera resposta — o cliente se despediu, não vamos mandar mais mensagem
    console.log(`🔕 [WORKER-IA] Lead ${lead.name} pausado após despedida cordial.`);
    return; // Encerra o worker aqui, sem chamar nenhum agente
    
} else if (intencao === 'COMPRA') {
    // ... resto do código igual
    console.log(`💰 [WORKER-IA] Sinal de COMPRA! Acionando Closer em modo fechamento para ${lead.name}...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'COMPRA', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });

} else if (intencao === 'DUVIDA' || intencao === 'CONTINUAR') {
    console.log(`🔍 [WORKER-IA] Fluxo de CONTINUIDADE/DÚVIDA. Acionando Closer para ${lead.name}...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'DUVIDA', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });

} else if (intencao === 'OBJECAO') {
    console.log(`🛡️ [WORKER-IA] OBJEÇÃO detectada! Acionando The Tank para ${lead.name}...`);

    // 🧠 MEMÓRIA DE OBJEÇÕES: registra a objeção em internal_notes para contexto futuro
    const textoObjecao = historico.filter(m => m.role === 'user').slice(-1)[0]?.content?.substring(0, 80) || 'objeção';
    const tagObjecao = `[OBJ:${textoObjecao}]`;
    const notasAtuais = lead.internal_notes || '';
    if (!notasAtuais.includes(tagObjecao.substring(0, 20))) {
        await supabase.from('leads')
            .update({ internal_notes: notasAtuais ? `${notasAtuais}\n${tagObjecao}` : tagObjecao })
            .eq('id', lead.id);
        lead.internal_notes = notasAtuais ? `${notasAtuais}\n${tagObjecao}` : tagObjecao;
    }

    resposta = await objectionAgent.quebrarObjecao(historico, promptResolvido, lead.current_stage);

} else if (intencao === 'REPASSE') {
    console.log(`🔄 [WORKER-IA] REPASSE detectado para ${lead.name}. Acionando extrator de decisor...`);

    const { nomeDecisor, telefoneDecisor } = await handoffAgent.extrairDadosDecisor(ultimaMsg, historico);
    console.log(`🔍 [REPASSE] Extração → nome: "${nomeDecisor}", fone: "${telefoneDecisor}"`);

    if (telefoneDecisor) {
        try {
            await db.atualizarLeadParaDecisor({
                leadId:            lead.id,
                novoNomeDecisor:   nomeDecisor,
                novoPhone:         telefoneDecisor,
                labelNumeroAntigo: 'recepcao',
            });

            // Acorda o motor para o novo número imediatamente
            sdrEventsGlobal?.emit('NOVO_LEAD_DISPONIVEL', lead.instance_id);

            const tratamento = nomeDecisor && nomeDecisor !== 'Responsável'
                ? `o ${nomeDecisor}`
                : 'o responsável';
            resposta = `Perfeito, vou entrar em contato com ${tratamento} por lá. Obrigado pela indicação! 🙏`;

            console.log(`✅ [REPASSE] Lead ${lead.id} atualizado → decisor: "${nomeDecisor}", fone: ${telefoneDecisor}`);
        } catch (erroRepasse) {
            console.error(`❌ [REPASSE] Falha ao atualizar lead ${lead.id}:`, erroRepasse.message);
            // Fallback: closer tenta extrair o contato via conversa
            resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'REPASSE', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });
        }
    } else {
        // Nenhum telefone na mensagem — closer pergunta pelo contato do decisor
        console.log(`⚠️ [REPASSE] Nenhum telefone extraído para ${lead.name}. Closer assumindo para solicitar o contato...`);
        resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'REPASSE', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });
    }

} else {
    console.log(`🧹 [WORKER-IA] Mensagem LIXO. Closer seguirá estágio atual da Constituição...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'LIXO', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });
}

// 🛡️ Blindagem final: se todos os agentes falharam, avisa o log
if (!resposta) {
    console.error(`❌ [WORKER-IA] Nenhum agente gerou resposta válida para ${lead.name}. Abortando envio.`);
    return;
}

        // 4.3. Filtra, Carimba no WPP e Envia
        await filtrarEEnviarResposta(instancia.sock, remoteJid, resposta, historico, lead, instanceId);

    } catch (error) {
        console.error(`❌ [WORKER-ERRO] Falha ao processar job ${job.id}:`, error.message);
        enviarAlerta("⚠️ ERRO NA IA (WORKER)", `Falha ao responder o lead.\nErro: ${error.message}`, 15158332);
        throw error; // Força o BullMQ a tentar de novo (Retry)
    } finally {
        // 5. Destranca o cérebro deste lead para que ele possa receber novas mensagens
        iaRespondendo.delete(whatsappId);
        console.log(`🔓 [WORKER-TRAVA] IA pronta para ${whatsappId} novamente.`);
    }
}, { 
    connection: redisConnection,
    concurrency: 5 // ATENÇÃO: Limita o servidor a processar 5 IAs por vez. Impede o Out of Memory!
});

// Adiciona tratamento para não travar o log caso o Redis caia
workerIA.on('error', err => console.error('❌ [REDIS WORKER ERROR]:', err));

// 👇 Adicione esta variável de controle aqui fora

let loopIniciado = false;

// ============================================================================
// ♻️ REDISTRIBUIÇÃO DE LEADS ÓRFÃOS (BLINDADA MULTI-TENANT)
// Roda a cada varredura do VIGIA. Move leads 'new' de chips desconectados
// para chips conectados estritamente da mesma conta (user_id).
// ============================================================================
async function redistribuirLeadsOrfaos() {
    try {
        // 1. Busca instâncias trazendo também o DONO (user_id)
        const { data: instancias } = await supabase
            .from('instances')
            .select('id, name, whatsapp_status, user_id');
        if (!instancias?.length) return;

        const conectados = instancias.filter(i => i.whatsapp_status === 'CONNECTED');
        if (!conectados.length) return;

        const idsDesconectados = instancias
            .filter(i => i.whatsapp_status !== 'CONNECTED')
            .map(i => i.id);
        if (!idsDesconectados.length) return;

        // 2. Agrupa os chips conectados por usuário (O "Muro" entre empresas)
        const chipsPorUsuario = {};
        for (const chip of conectados) {
            if (!chipsPorUsuario[chip.user_id]) {
                chipsPorUsuario[chip.user_id] = [];
            }
            chipsPorUsuario[chip.user_id].push(chip);
        }

        // Contador independente por usuário para o Round-Robin justo
        const contadoresPorUsuario = {};

        // 3. Busca os leads órfãos trazendo o DONO (user_id)
        const { data: orfaos } = await supabase
            .from('leads')
            .select('id, user_id')
            .eq('status', 'new')
            .or(`instance_id.in.(${idsDesconectados.join(',')}),instance_id.is.null`);
        if (!orfaos?.length) return;

        console.log(`♻️ [REDISTRIBUIÇÃO] ${orfaos.length} leads órfãos detectados. Isolando por Tenant...`);

        let redistribuidosCount = 0;
        const chipsAcordados = new Set();

        // 4. Distribuição Cirúrgica
        for (const lead of orfaos) {
            const chipsDoDono = chipsPorUsuario[lead.user_id];
            
            // Se a empresa desse lead não tem NENHUM chip online agora, ignora. 
            // O lead fica seguro aguardando algum chip dele mesmo voltar.
            if (!chipsDoDono || chipsDoDono.length === 0) continue;

            // Inicializa o contador desse dono se for o primeiro lead
            if (contadoresPorUsuario[lead.user_id] === undefined) {
                contadoresPorUsuario[lead.user_id] = 0;
            }

            // Sorteia apenas entre os chips DESTE usuário
            const indiceSorteado = contadoresPorUsuario[lead.user_id] % chipsDoDono.length;
            const chipSorteado = chipsDoDono[indiceSorteado];
            
            contadoresPorUsuario[lead.user_id]++; // Avança a fila deste usuário

            // Salva no banco com o novo chip
            await supabase.from('leads').update({ instance_id: chipSorteado.id }).eq('id', lead.id);
            chipsAcordados.add(chipSorteado.id);
            redistribuidosCount++;
        }

        if (redistribuidosCount > 0) {
            console.log(`✅ [REDISTRIBUIÇÃO] ${redistribuidosCount} leads redistribuídos com segurança.`);
            for (const chipId of chipsAcordados) {
                sdrEventsGlobal?.emit('NOVO_LEAD_DISPONIVEL', chipId); // Usando a variável global corrigida
            }
        } else {
            console.log(`⏸️ [REDISTRIBUIÇÃO] Órfãos mantidos. (Nenhuma conta dona possui chips online no momento).`);
        }

    } catch (err) {
        console.error('❌ [REDISTRIBUIÇÃO] Erro:', err.message);
    }
}

module.exports = {
    // 👇 Recebe a porta de comunicação (io) e o Alarme (sdrEvents)
    initMultiTenancy: async (io, sdrEvents) => {

        

        
        
        // 🚀 INJEÇÃO DINÂMICA DO BAILEYS (Resolve o Crash ESM)
        const baileys = await import('@whiskeysockets/baileys');
        makeWASocket = baileys.makeWASocket;
        useMultiFileAuthState = baileys.useMultiFileAuthState;
        DisconnectReason = baileys.DisconnectReason;
        delay = baileys.delay;
        fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
        makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
        downloadMediaMessage = baileys.downloadMediaMessage;
        generateMessageID = baileys.generateMessageID;

        ioSocket = io;
        sdrEventsGlobal = sdrEvents;

        // Aquece o cache Redis com os nichos já aprendidos antes do SDR ligar
        await inicializarCache();

         // 🎯 BUG #2 FIX: Destravar leads que ficaram presos como "reservado" após crash/restart
        const { data: travados } = await supabase.from('leads').select('id').eq('status', 'reservado');
        if (travados && travados.length > 0) {
            await supabase.from('leads').update({ status: 'new' }).eq('status', 'reservado');
            console.log(`🔓 [STARTUP] ${travados.length} leads destravados de status "reservado" → "new"`);
        }

        const insts = await db.getActiveInstances(); 
        for (const i of insts) { 
            await startInstance(i.id, i.name); 
            await delay(3000); 
            
            // 🚀 ARRANQUE INICIAL: Liga a turbina para este chip!
            processarFilaDeAtaque(i.id); 
        }
        
        // 🛑 BLINDAGEM MÁXIMA: Garante que o Vigia e o Ouvinte sejam criados UMA ÚNICA VEZ
        if (!loopIniciado) {
            loopIniciado = true;
            loopRecuperacaoConversas(); 
            loopAuditor();
            
            // ⏰ VIGIA NOTURNO: Varredura de segurança a cada 30 minutos
            setInterval(async () => {
                console.log("⏰ [VIGIA] Varredura de segurança ativada...");
                await redistribuirLeadsOrfaos();
                for (const id of sessions.keys()) {
                    processarFilaDeAtaque(id);
                }
            }, 30 * 60 * 1000);

            // 🔔 OUVINTE DO ALARME RAM: Escuta o grito do Scraper
            if (sdrEvents) {
                sdrEvents.on('NOVO_LEAD_DISPONIVEL', (chipIdDestino) => {
                    console.log(`🔔 [ALARME RAM] Novo lead recebido! Acordando o chip ${chipIdDestino}...`);
                    processarFilaDeAtaque(chipIdDestino);
                });

               sdrEvents.on('AGENDAMENTO_CONFIRMADO', async ({ lead, dataEvento, instanceId }) => {
    console.log(`🎊 [WEBHOOK] Agendamento confirmado para ${lead.name}. Preparando feedback...`);
enviarAlerta("🎊 REUNIÃO AGENDADA!", `Lead: ${lead.name}\nData: ${new Date(dataEvento).toLocaleString('pt-BR')}`, 3066993);
    // 🛡️ BLINDAGEM: Em domingos, só registra mas não dispara mensagem (lead recebe na segunda)
    if (!dentroDoExpediente()) {
        console.log(`💤 [WEBHOOK] Fora do expediente. Feedback será enviado no próximo dia útil.`);
        return;
    }
    
    const instancia = sessions.get(instanceId);
    if (instancia && instancia.ready) {
                        const dataObjeto = new Date(dataEvento);
                        const dataFormatada = dataObjeto.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                        const horaFormatada = dataObjeto.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                        const instanceData = await getRegrasEmCache(instanceId);
                        const primeiroNome = lead.dono?.split(' ')?.[0] || 'você';

                        // Template de confirmação — usa o do Supabase se existir, senão fallback
                        const tplConfirmacao = instanceData?.opening_templates?.confirmacao_agendamento
                            || `Perfeito, ${primeiroNome}! Reunião confirmada pra ${dataFormatada} às ${horaFormatada}. Te vejo lá!`;

                        await enviarMensagemIA(instancia.sock, lead.whatsapp_id, { text: tplConfirmacao });
                        await db.saveMessage(lead.whatsapp_id, 'assistant', tplConfirmacao, instanceId);
                        console.log(`✅ [CONFIRMAÇÃO] Mensagem de confirmação enviada para ${lead.name}.`);
                    } else {
                        console.log(`⚠️ [WEBHOOK] Chip ${instanceId} não está pronto para enviar feedback.`);
                    }
                });
            }
        }
    },
    enviarMensagemSDR: async (instanceId, whatsappId, texto) => {
        try {
            // 1. Pega o canal de comunicação correto do chip
            const instancia = sessions.get(instanceId);
            
            if (!instancia || !instancia.ready) {
                console.error(`❌ [FRONTEND] Erro: Chip ${instanceId} não está conectado.`);
                return { success: false, error: 'Chip offline ou não conectado.' };
            }

            console.log(`👤 [FRONTEND] Enviando mensagem manual para ${whatsappId}...`);

            // 2. Simula o "Digitando..." para o lead
            await instancia.sock.sendPresenceUpdate('composing', whatsappId);
            await delay(1500);
            await instancia.sock.sendPresenceUpdate('paused', whatsappId);

            // 3. Envia a mensagem usando a função interna para registrar na memória viva (evita eco do bot)
            const sentMsg = await enviarMensagemIA(instancia.sock, whatsappId, { text: texto });

            if (sentMsg) {
                // 4. Salva a mensagem no banco de dados para o histórico do front-end
                await db.saveMessage(whatsappId, 'assistant', texto, instanceId);

                // 5. PAUSA A IA (Intervenção Humana): Dá o tempo de 10 minutos para você falar
                await supabase.from('leads').update({
                    is_paused: true,
                    last_human_interaction: new Date().toISOString(),
                    internal_notes: `Intervenção humana via Dashboard em ${new Date().toLocaleString('pt-BR')}`
                }).eq('whatsapp_id', whatsappId);

                console.log(`✅ [FRONTEND] Mensagem manual entregue. IA pausada para o lead.`);
                return { success: true, messageId: sentMsg.key.id };
            } else {
                throw new Error("Falha no disparo pelo Baileys.");
            }
            
        } catch (error) {
            console.error("❌ [FRONTEND] Erro no disparo manual:", error.message);
            return { success: false, error: error.message };
        }
    },

    encerrarInstancia: (instanceId) => {
        // 1. Aciona o silenciador ANTES de fechar o socket
        instanciasEncerrandoManualmente.add(instanceId); 

        const instancia = sessions.get(instanceId);
        if (instancia?.sock) {
            try { instancia.sock.end(); } catch(e) {}
        }
        
        // 2. Limpeza profunda da memória RAM
        sessions.delete(instanceId);
        instanciasLigando.delete(instanceId);
        motoresEmExecucao.delete(instanceId);
        cacheRegrasInstancia.delete(instanceId); // 🔥 Novo: Limpa o cache de regras para evitar zumbis

        if (fs.existsSync(`./wpp_sessions/${instanceId}`)) {
            fs.rmSync(`./wpp_sessions/${instanceId}`, { recursive: true, force: true });
        }
        console.log(`🔌 [SDR] Sessão ${instanceId} completamente encerrada e limpa.`);
    },
    criarNovaInstancia: async (n, t, userId) => {
        // Deduz o product_type do perfil do usuário — zero fricção no frontend
        const { data: profile } = await supabase
            .from('profiles')
            .select('default_product_type')
            .eq('id', userId)
            .maybeSingle();

        const productType = profile?.default_product_type || 'solar';
        console.log(`🏷️ [INSTÂNCIA] Criando chip "${n}" para user ${userId} com product_type="${productType}"`);

        const { data } = await supabase
            .from('instances')
            .insert([{ name: n, owner_phone: t, user_id: userId, product_type: productType }])
            .select()
            .single();

        if (data) {
            await startInstance(data.id, data.name);
            processarFilaDeAtaque(data.id);
        }
        return data;
    },

    reconectarInstancia: async (instanceId) => {
        const instanceData = await getRegrasEmCache(instanceId);
        const name = instanceData?.name || instanceId;
        console.log(`🔄 [RECONEXÃO MANUAL] Reiniciando chip ${name}...`);

        // 1. Sinaliza encerramento manual para suprimir auto-reconexão do handler de close
        instanciasEncerrandoManualmente.add(instanceId);
        instanciasLigando.delete(instanceId);

        // 2. Fecha o socket antigo se existir
        const instanciaAtual = sessions.get(instanceId);
        if (instanciaAtual?.sock) {
            try { instanciaAtual.sock.end(); } catch(e) {}
        }
        sessions.delete(instanceId);
        cacheRegrasInstancia.delete(instanceId);

        // 3. Limpa credenciais do Redis — garante que Baileys gera novo QR em vez de reconectar silenciosamente
        await clearRedisSession(redisConnection, instanceId);
        await db.updateInstanceStatus(instanceId, 'DISCONNECTED');

        // 4. Aguarda handlers de close processarem antes de iniciar novo socket
        await new Promise(r => setTimeout(r, 1500));

        // 5. Libera flag de encerramento para o novo socket funcionar normalmente
        instanciasEncerrandoManualmente.delete(instanceId);

        // 6. Inicia nova sessão — sem credenciais no Redis, Baileys vai gerar QR code
        startInstance(instanceId, name);
    }
};