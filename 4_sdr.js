/**
 * 
 * 4_sdr.js - MÓDULO DE VENDAS NEURAL V12 (BAILEYS MULTI-TENANCY)
 * INTEGRAL: Vision, PDF, Regras Regionais Enerzee, Anti-Ban e Horários.
 */
// 🚀 FIX V13: Declaração global para injeção dinâmica (Bypass do erro ESM)
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage, generateMessageID, Browsers;

// Versão do Baileys instalada — comparada com a versão gravada no Redis por chip.
// Se divergir, sessão é limpa automaticamente para evitar incompatibilidade de protocolo.
let BAILEYS_VERSION = 'unknown';
try { BAILEYS_VERSION = require('@whiskeysockets/baileys/package.json').version; } catch (_) {}

// 🔇 Suprime logs internos do libsignal (chaves privadas efêmeras do Double Ratchet)
// Esses blocos não são erros — são ciclos normais do Signal Protocol, mas expõem material criptográfico nos logs de produção.
// Usamos process.stdout.write em vez de console.log porque o libsignal captura a referência de console.log
// antes do nosso override (no momento do require), então só interceptamos na camada inferior.
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function(chunk, encoding, callback) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text.startsWith('Closing session:') || text.includes('privKey:') ||
        text.includes('SessionEntry') || text.startsWith('  _chains:')) {
        if (typeof encoding === 'function') encoding();
        else if (typeof callback === 'function') callback();
        return true;
    }
    return _origStdoutWrite(chunk, encoding, callback);
};

const pino = require('pino');
const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const Groq = require('groq-sdk');
const pdf = require('pdf-parse');
const db = require('./database');
const emailService = require('./emailService');
const budgetGuard = require('./budgetGuard');
const { getTransport, baileysTransport, cloudApiTransport } = require('./transports');
const { useSupabaseAuthState } = require('./auth_adapter');
const { gerarAudioTTS } = require('./ttsElevenLabs');
const { createClient } = require('@supabase/supabase-js');
const routerAgent = require('./agents/routerAgent'); // faz a distribuição entre os agentes dependendo da necessidade 
const closerAgent = require('./agents/closerAgent'); //é o closer que assume a conversa
const intelAgent = require('./agents/intelAgent'); // 
const profilerAgent = require('./agents/profilerAgent'); // identifica o perfil do lead 
const objectionAgent = require('./agents/objectionAgent'); // esse agente assume o controle quando o router identifica objeção 
const auditorAgent = require('./agents/auditorAgent'); // faz auditoria das conversas como um 'juiz'
const handoffAgent = require('./agents/handoffAgent');
const motoresEmExecucao = new Set(); // 🛡️ Impede que o mesmo chip ligue dois loops infinitos
const { useRedisAuthState, clearRedisSession, saveOwnerToRedis, getOwnerFromRedis } = require('./auth_redis_adapter');
const { enviarAlerta, alertaHandoff, alertaCalendly, alertaChipOffline, cancelarDebounceChip } = require('./notifier');
const { getNicheData, inicializarCache } = require('./nicheCache');
const instanciasEncerrandoManualmente = new Set(); // 🛑 Flag para silenciar alertas no Discord ao remover chip

// ============================================================================
// 🚨 CAMADA 1 — CAIXA PRETA: Crash handlers de nível Node.js
// Captura qualquer erro não tratado antes que o processo morra.
// ============================================================================
process.on('uncaughtException', (err, origin) => {
    const mem = process.memoryUsage();
    console.error('🚨🚨🚨 [CRASH FATAL] Exceção não tratada derrubou o Node!');
    console.error(`  origin: ${origin}`);
    console.error(`  message: ${err?.message}`);
    console.error(`  stack:\n${err?.stack}`);
    console.error(`  heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
    console.error(`  uptime: ${Math.round(process.uptime())}s`);
    // Não fazemos process.exit() — deixamos o Railway decidir. O log acima aparece antes da morte.
});

process.on('unhandledRejection', (reason, promise) => {
    const msg = String(reason?.message || reason);
    // Filtra ruído criptográfico normal do libsignal
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt')) return;
    const mem = process.memoryUsage();
    console.error('🚨 [UNHANDLED REJECTION] Promessa rejeitada não tratada:');
    console.error(`  message: ${msg}`);
    if (reason?.stack) console.error(`  stack:\n${reason.stack}`);
    console.error(`  heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB | uptime: ${Math.round(process.uptime())}s`);
});

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


// 👤 Identidade/nome (funções puras) — movidas para lib/textPuros.js pra serem testáveis sem
// subir Redis/BullMQ. Mesma lógica, só mudou de arquivo.
const { extrairNomeHumano, saudacaoPrimeiroNome, extrairNomeDeclarado, empresaConfiavelDoLead } = require('./lib/textPuros');
const { dividirEmBaloes } = require('./lib/baloes');
// 📅 Confirmação diária de reuniões via Google Agenda (feature opt-in por tenant).
const { extrairTelefoneDescricao, eventoEhReuniao, digitosParaJids } = require('./lib/gcalParse');
const { classificarConfirmacao } = require('./lib/confirmacao');
const gcal = require('./integrations/googleCalendar');

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

// Resolve variações inline dentro de templates: "{Oi|Olá|Opa}" → escolha aleatória
// Permite templates mais ricos sem multiplicar o array de variações no Supabase
function resolverSpintax(texto) {
    return texto.replace(/\{([^}]+)\}/g, (_, opcoes) => {
        const lista = opcoes.split('|');
        return lista[Math.floor(Math.random() * lista.length)];
    });
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
const pausasIntradiarias = new Map(); // instanceId → { dataGerada, breaks: [{inicio,fim}] }

// --- CONFIGURAÇÃO E SEGURANÇA ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); // mantido SÓ para transcrição de áudio (Whisper)
// 🤖 Todo LLM de texto/visão passa pelo adaptador único do Claude (lib/llm.js).
const { chamarLLM, MODELOS } = require('./lib/llm');
const { definirTenantLLM } = require('./lib/llmContext');

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
const inboundAtivo = new Map(); // instanceId → nº de jobs inbound em fila/processamento (fast-lane guard)
const tentativasReconexao = new Map(); // instanceId → contador de tentativas automáticas (Phase 4)
const chipsAbandanados = new Set(); // chips que falharam 10x seguidas — Vigia para de reiniciar até Reset Session manual
// 🔁 AUTO-RECUPERAÇÃO DE ABANDONO: em vez de deixar o chip morto pra sempre, o VIGIA re-tenta
// após um cooldown longo (transitório do WhatsApp/proxy se cura sozinho) e re-alerta enquanto down.
const abandonadoEm = new Map();          // instanceId → timestamp (ms) em que entrou em abandono
const ultimoAlertaAbandono = new Map();  // instanceId → timestamp do último alerta Discord (anti-flood)
const ultimoInboundAt = new Map();       // instanceId → timestamp da última mensagem recebida (painel de saúde)
const COOLDOWN_ABANDONO_MS = 20 * 60 * 1000; // espera antes de tentar recuperar um chip abandonado
const REALERTA_ABANDONO_MS = 15 * 60 * 1000; // re-alerta no Discord no máx a cada 15min enquanto down
const instanciasDeletadas = new Set(); // chips removidos pelo painel — bloqueia reentrada de timeouts pendentes
const instanciasEmResetManual = new Set(); // impede duplo reset_session simultâneo no mesmo chip
const mapaRastreioLID = new Map();
const gavetaDeMensagens = new Map(); // 🧠 OUVIDO PACIENTE: Gaveta temporária de mensagens
const mensagensJaProcessadas = new Map(); // 🛡️ DEDUP: Previne reprocessamento de msg.key.id do Baileys
const cacheRegrasInstancia = new Map(); // 🧠 Memória de curto prazo para regras
const cacheAvisosMidia = new Map(); // 🛡️ TTL 5min — previne race condition em flood de fotos/catálogos
let sdrEventsGlobal = null; // 🛡️ Adicione esta linha aqui no topo

// ============================================================================
// 🚦 SEMÁFORO DE CHIPS — Sistema de prioridade tática anti-ban
// Garante que apenas 1 disparo por chip aconteça a cada COOLDOWN_MS
// E que disparos de SAUDAÇÃO tenham prioridade sobre FOLLOW-UPs
// ============================================================================
const semaforoChips = new Map(); // chipId → { ocupado: boolean, ultimoDisparo: timestamp, cooldownMs: number, prioridadeAtual: string }
global.chipsAquecidosHoje = global.chipsAquecidosHoje || new Set(); // cold-start guard por chip, por processo
const sucessosPorSessao = new Map(); // instanceId → nº de envios com SERVER_ACK confirmado nesta sessão WA ativa
const staleContador = new Map(); // instanceId → falhas ACK_TIMEOUT stale consecutivas (0 confirms); reseta no SUCESSO REAL ou hard restart
const sentMessagesStore = new Map(); // `${instanceId}:${msgId}` → { message } para retransmissão RC13
const ultimoHardRestart = new Map(); // instanceId → timestamp do último HARD restart; bloqueia reconexão por 5min
const falhasLeadPorSessao = new Map(); // `${instanceId}:${leadId}` → nº de ACK_TIMEOUT neste lead nesta sessão; quebra loop de requeue
const staleRetryFlag = new Map();   // instanceId → true quando o próximo ciclo é um retry de stale; usa jitter curto (15-45s)
const jidsInvalidos = new Set();    // JIDs confirmados inválidos nesta sessão; skip imediato sem jitter na próxima reserva
const ultimoEnvioTimestamp = new Map(); // jid → timestamp do último envio confirmado (para detecção de autoresposta)
const primeiroEnvioSucesso = new Map(); // instanceId → true se já houve ao menos 1 envio confirmado na sessão atual (soft-ban detection)
const proxy504Tentativas   = new Map(); // instanceId → contador de retries por proxy 504 (máx 3 antes de contar como falha normal)
const chipsEmConflito      = new Set(); // chips que receberam connectionReplaced e aguardam reconnect (para logar [CONFLITO-RECOVERY])
// 🩹 CATCH-UP DE QUEDA: instanceId → timestamp (ms) da última desconexão detectada.
// messages.upsert só processa eventos type='notify' (ao vivo) — mensagens que chegam durante
// o socket caído voltam como sincronização (não-notify) e eram descartadas em silêncio.
// Usado para resgatar só o que caiu DENTRO da janela de queda, sem reprocessar histórico
// antigo (o Map é em memória — reseta a cada deploy, então nunca "recupera" após um restart).
const ultimaQuedaPorChip  = new Map();
const JANELA_MAX_CATCHUP_MS = 10 * 60 * 1000; // não resgata sync mais velho que 10min de queda

// 🔄 Backoff de reconexão (pura, testável) — movida para lib/reconexao.js.
const { calcularBackoffReconexao } = require('./lib/reconexao');

// ============================================================================
// 🗄️ PERSISTÊNCIA DA GAVETA (nunca perder inbound num restart/deploy)
// A gaveta de debounce (OUVIDO PACIENTE) segura o inbound por até 30s só na RAM antes de ir pro
// BullMQ — um restart nessa janela perdia a mensagem em silêncio. Espelhamos a gaveta no Redis
// (TTL curto) e, quando o chip volta a ficar PRONTO, reprocessamos o que ficou pendente.
// ============================================================================
const GAVETA_REDIS_PREFIX = 'gaveta_pend:';
const GAVETA_REDIS_TTL_S = 120; // segundos — cobre a janela de 30s + margem de restart
const _gavetaRedisKey = (instanceId, remoteJid) => `${GAVETA_REDIS_PREFIX}${instanceId}:${remoteJid}`;

async function persistirGavetaRedis(instanceId, remoteJid, textos, msgMeta) {
    try {
        const payload = JSON.stringify({ textos, msgMeta, updatedAt: Date.now() });
        await redisConnection.set(_gavetaRedisKey(instanceId, remoteJid), payload, 'EX', GAVETA_REDIS_TTL_S);
    } catch (e) { /* best-effort: espelho, nunca deve derrubar o fluxo */ }
}

async function limparGavetaRedis(instanceId, remoteJid) {
    try { await redisConnection.del(_gavetaRedisKey(instanceId, remoteJid)); } catch (e) {}
}

// Reprocessa gavetas pendentes quando o chip volta a ficar PRONTO (após restart/reconexão).
// Consome-uma-vez (del antes de processar → sem loop entre restarts). Pula chaves cuja gaveta
// ainda existe na RAM (reconexão sem restart → o timer da RAM já cuida, não duplica). Pré-semeia
// o dedup pelo msgId → se o WhatsApp reenviar via sync, é descartado.
async function recuperarGavetasPendentes(instanceId, sock) {
    let chaves = [];
    try { chaves = await redisConnection.keys(`${GAVETA_REDIS_PREFIX}${instanceId}:*`); } catch (e) { return; }
    if (!chaves.length) return;
    console.log(`♻️ [GAVETA-RECUPERA] ${chaves.length} pendente(s) do chip ${String(instanceId).slice(0, 8)} — reprocessando após reinício.`);
    for (const chave of chaves) {
        try {
            const raw = await redisConnection.get(chave);
            if (!raw) continue;
            const { textos, msgMeta } = JSON.parse(raw);
            if (!Array.isArray(textos) || !textos.length || !msgMeta?.remoteJid) { await redisConnection.del(chave).catch(() => {}); continue; }
            // Se a gaveta ainda está viva na RAM (reconexão sem restart), o timer local processa — não duplica.
            if (gavetaDeMensagens.has(`${instanceId}:${msgMeta.remoteJid}`)) continue;
            await redisConnection.del(chave).catch(() => {}); // consome-uma-vez
            const textoConsolidado = textos.join(' \n');
            if (msgMeta.id) { // pré-dedup contra o sync do WhatsApp
                mensagensJaProcessadas.set(msgMeta.id, Date.now());
                setTimeout(() => mensagensJaProcessadas.delete(msgMeta.id), 300000);
            }
            const synthMsg = {
                key: { remoteJid: msgMeta.remoteJid, fromMe: msgMeta.fromMe || false, id: msgMeta.id,
                       remoteJidAlt: msgMeta.remoteJidAlt, participant: msgMeta.participant },
                pushName: msgMeta.pushName,
                message: { conversation: textoConsolidado },
            };
            await processarMensagem(sock, synthMsg, instanceId, textoConsolidado);
            console.log(`✅ [GAVETA-RECUPERA] Reprocessado: "${textoConsolidado.slice(0, 60)}"`);
        } catch (e) {
            console.error(`❌ [GAVETA-RECUPERA] Falha em ${chave}:`, e.message);
        }
    }
}

// Detecta respostas automáticas de WhatsApp Business / bots de atendimento
const AUTORESPOSTA_REGEX = /agradece (seu|o seu) contato|obrigado por entrar em contato|fora do hor[aá]rio de atendimento|nossa equipe retornar[aá]|atendimento autom[aá]tico|resposta autom[aá]tica|digit[ea] \d para|pressione \d para|selecione uma op[cç][aã]o|para falar com|menu principal|horario de funcionamento/i;

// 🛑 OPT-OUT (LGPD): detecta pedido explícito do lead para não ser mais contatado.
// Conservador para minimizar falso-positivo — exige termos claros ou a mensagem inteira
// sendo só "pare"/"sair"/"stop". Ajustável conforme padrões reais de resposta.
const OPTOUT_REGEX = /descadastr\w*|sair\s+da\s+lista|me\s+tir[ae]\s+(dessa|desta|da)\s+list|me\s+remov\w*|n[ãa]o\s+quero\s+(mais|receber)|n[ãa]o\s+me\s+(mande|envie|perturbe)|n[ãa]o\s+perturbe|nunca\s+mais\s+(me|mande)|par[ae]\s+de\s+(me\s+)?(mand|envi)|unsubscribe|opt[-\s]?out|^\s*(pare|parar|sair|stop)\s*$/i;

// Retorna delay humano randômico entre disparos.
// Chip novo: 10-18 min — janela maior diminui a cadência detectável pelo WA.
// Chip maduro: 4-7 min.
function getHumanCooldown(isWarmup = false) {
    if (isWarmup) return Math.floor(10 * 60000 + Math.random() * 8 * 60000); // 10-18 min
    return Math.floor(4 * 60000 + Math.random() * 3 * 60000);                // 4-7 min
}

// Curva de aquecimento diária. Começa em 2/dia e escala ao longo de 3 semanas.
// Override manual: se daily_limit estiver definido no banco (não null), usa direto sem curva.
// Útil para chips que foram reconectados depois de já estarem mornos.
function calcularLimiteDiario(instanceData) {
    if (instanceData?.daily_limit != null) {
        return instanceData.daily_limit; // controle manual via painel
    }
    if (!instanceData?.created_at) return 30;
    const idadeDias = Math.floor((Date.now() - new Date(instanceData.created_at).getTime()) / 86400000);
    if (idadeDias <= 1)  return 2;    // dia 1: 2 mensagens
    if (idadeDias <= 3)  return 5;    // dias 2-3: 5
    if (idadeDias <= 5)  return 8;    // dias 4-5: 8
    if (idadeDias <= 7)  return 12;   // dias 6-7: 12
    if (idadeDias <= 14) return 20;   // semana 2: 20
    return 30;                         // semana 3+: padrão 30
}

// Chip com menos de 7 dias de vida é tratado como novo: limite reduzido para aquecimento gradual.
// Exceção: se daily_limit foi definido manualmente no painel, o operador assumiu o controle —
// respeita a mesma lógica de override que calcularLimiteDiario() já usa.
function isChipNovo(instanceData) {
    if (instanceData?.daily_limit != null) return false; // override manual → modo maduro
    if (!instanceData?.created_at) return false;
    const idadeMs = Date.now() - new Date(instanceData.created_at).getTime();
    return idadeMs < 7 * 24 * 60 * 60 * 1000;
}

// Gera URL de proxy com sticky session por chip.
// PROXY_BASE_URL deve conter SESSION_ID como placeholder na senha, ex:
//   http://USUARIO:SENHA_session-SESSION_ID_country-br_lifetime-168h@geo.iproyal.com:12321
// 16 chars hex sem hífens garante sessões distintas no pool do IPRoyal.
function generateProxyUrl(instanceId) {
    const base = process.env.PROXY_BASE_URL;
    if (!base) return null;
    // 16 chars = baixíssima chance de dois chips receberem o mesmo IP
    const sessionId = instanceId.replace(/-/g, '').substring(0, 16);
    return base.replace('SESSION_ID', sessionId);
}

// Valida o proxy fazendo GET real via ipify. Retorna o agent pronto ou lança erro se o proxy falhar.
// Se proxyUrl for null (chip sem proxy configurado), retorna null — isso é intencional.
// Se proxyUrl for definido e falhar, ABORTA: jamais expõe o IP do Railway.
async function validateProxy(proxyUrl, instanceId) {
    if (!proxyUrl) return null;
    let agent;
    try {
        agent = new HttpsProxyAgent(proxyUrl);
        const resp = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: agent,
            timeout: 10000,
        });
        if (proxy504Tentativas.get(instanceId)) {
            console.log(`✅ [PROXY-RECOVERY] Chip ${instanceId.slice(0,8)}: proxy respondeu normalmente após ${proxy504Tentativas.get(instanceId)} tentativa(s) com 504`);
            proxy504Tentativas.delete(instanceId);
        }
        console.log(`✅ [PROXY OK] Chip ${instanceId.substring(0, 8)} → IP de saída: ${resp.data.ip}`);
        return agent;
    } catch (err) {
        const safeMsg = (err.message || 'timeout').replace(/:[^:@]*@/g, ':***@');
        const status = err.response?.status;
        const isTimeout = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED';
        if (status === 504) {
            console.warn(`⚠️ [PROXY-504] Chip ${instanceId.slice(0,8)}: gateway timeout no proxy — possível recuperação em minutos`);
            const e = new Error(`PROXY_504: ${safeMsg}`); e.proxyError = '504'; throw e;
        } else if (isTimeout) {
            console.warn(`⚠️ [PROXY-TIMEOUT] Chip ${instanceId.slice(0,8)}: proxy inacessível (${err.code || 'sem resposta'})`);
            const e = new Error(`PROXY_TIMEOUT: ${safeMsg}`); e.proxyError = 'TIMEOUT'; throw e;
        } else {
            console.error(`🚫 [PROXY FAIL] Chip ${instanceId.substring(0, 8)}: ${safeMsg}. Abortando conexão — IP Railway NÃO exposto.`);
            throw new Error(`Proxy validation failed for chip ${instanceId.substring(0, 8)}: ${safeMsg}`);
        }
    }
}

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
    // Cooldown foi gerado no momento da liberação — usa o mesmo valor para garantir consistência.
    // Se nunca houve disparo (chip novo no mapa), gera um cooldown na hora.
    const cooldownMs = estado?.cooldownMs ?? getHumanCooldown();

    // 1. Verifica cooldown por chip (4-7 min randômico, gerado a cada liberação)
    if (estado?.ultimoDisparo && (agora - estado.ultimoDisparo) < cooldownMs) {
        const tempoRestante = Math.round((cooldownMs - (agora - estado.ultimoDisparo)) / 1000);
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
function liberarSemaforoChip(chipId, isWarmup = false) {
    semaforoChips.set(chipId, {
        ocupado: false,
        ultimoDisparo: Date.now(),
        cooldownMs: getHumanCooldown(isWarmup), // warmup=true → 6-10 min; false → 4-7 min
        prioridadeAtual: null
    });
}

/**
 * 🚦 Libera o semáforo SEM reiniciar o cooldown.
 * Usado quando o envio falhou por número inexistente — nenhuma mensagem foi entregue,
 * então o timer do último disparo real deve ser preservado.
 */
function liberarSemaforoSemCooldown(chipId) {
    const estado = semaforoChips.get(chipId);
    semaforoChips.set(chipId, {
        ocupado: false,
        ultimoDisparo: estado?.ultimoDisparo ?? 0,
        cooldownMs:    estado?.cooldownMs    ?? 0,
        prioridadeAtual: null,
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
        if (t >= 480 && t <= 1200) return 'FOLLOWUP';
        return 'DESCANSO';
    }

    // 📅 JANELA DE ATAQUE (segunda a sexta) — 09:00 às 21:00, sem interrupções
    // Follow-ups D1/D3 são gerenciados pelo worker de mensagens (BullMQ), não por esta janela.
    const t = agora.horas * 60 + agora.minutos;
    if (t < 540 || t >= 1260) return 'DESCANSO'; // antes de 09:00 ou 21:00+
    return 'SAUDACAO';
}

// ============================================================================
// ☕ PAUSAS INTRADIÁRIAS — janelas de descanso humano, aleatórias por chip
// Simula comportamento de SDR real: café manhã, almoço, café tarde.
// Cada chip recebe um schedule independente renovado a cada dia em BRT.
// ============================================================================
function gerarPausasDoDia(instanceId) {
    const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0];
    const cached = pausasIntradiarias.get(instanceId);
    if (cached?.dataGerada === hoje) return cached.breaks;

    const r = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const fmt = t => `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}`;

    // Três janelas fixas de comportamento humano, com offsets aleatórios por chip:
    // janela 1 — café manhã: 09:30–10:30, dura 8–18 min
    // janela 2 — almoço:     11:45–13:30, dura 22–42 min
    // janela 3 — café tarde: 15:00–16:30, dura 8–20 min
    const breaks = [
        { inicio: r(570, 630), duracao: r(8, 18)  },
        { inicio: r(705, 810), duracao: r(22, 42) },
        { inicio: r(900, 990), duracao: r(8, 20)  },
    ].map(b => ({ inicio: b.inicio, fim: Math.min(b.inicio + b.duracao, 1199) }));

    pausasIntradiarias.set(instanceId, { dataGerada: hoje, breaks });
    console.log(`📅 [MICRO-PAUSAS] ${instanceId.slice(0, 8)} — schedule: ${breaks.map(b => `${fmt(b.inicio)}-${fmt(b.fim)}`).join(' | ')}`);
    return breaks;
}

function verificarPausaIntradiaria(instanceId) {
    const breaks = gerarPausasDoDia(instanceId);
    const { horas, minutos } = getHoraBrasil();
    const t = horas * 60 + minutos;
    return breaks.find(b => t >= b.inicio && t < b.fim) || null;
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

// Retorna true quando há sinais positivos de que quem escreveu é humano
function detectarSinalHumano(texto) {
    if (!texto) return false;
    const t = texto.trim();
    // "aqui é" removido: bots de imobiliária usam "Aqui é a Francieli" que falseava positivo.
    // "resposta longa" e "emoção" removidos: bots modernos geram respostas longas com !
    return (
        /\b(eu|minha?|meu|noss[ao]|nossa\s+empresa|minha\s+empresa)\b/i.test(t) ||
        /\b(tô|tá|num|tava|tamo|né|cara|ó|oxe|poxa|caramba|rapaz|véi)\b/i.test(t) || // gírias BR
        /R\$\s*[\d.,]+/.test(t) ||           // menciona valor monetário
        /\d{4,}/.test(t) ||                  // número concreto longo (kWh, CNPJ, CEP etc.)
        /\?/.test(t) ||                      // pergunta — quase sempre fala humana
        /\b(hoje|agora|ontem|ainda|j[aá]|nunca|sempre|semana|esta\s+semana)\b/i.test(t) || // marcadores temporais pessoais
        /\b(mas|por[ée]m|contudo|entretanto|ent[ãa]o|depende|[àa]s\s+vezes|geralmente|normalmente|na\s+verdade|de\s+fato|s[óo]\s+que|apesar|embora|acho\s+que|acredito|creio|imagino|talvez)\b/i.test(t) || // conectores de raciocínio/opinião — comuns em objeções humanas naturais
        /\b(n[ãa]o\s+)?(comec[ea]\w*|us[ao]\w*|fiz|sei|entend\w*|consig[ao]\w*|conect\w*|abr[ií]\w*|mex\w*|acesso|acess\w+)\b/i.test(t) || // verbos 1ª pessoa (comecei, usei, fiz, sei...)
        /\b(preciso|quero|gostaria|tento|estou|tô\s+(?:com|sem)|tenho\s+(?:uma?\s+)?d[uú]vida)\b/i.test(t) || // intenção/estado pessoal
        (/\b(sim|n[ãa]o|ok|certo|exato|legal|show|boa|beleza|claro|combinado|perfeito)\b/i.test(t) && t.split(/\s+/).length <= 5) // confirmação curta humana (≤5 palavras)
    );
}

// Analisa o padrão do histórico e detecta bot que passou pelo regex
// Só ativa após o SDR já ter enviado mensagens suficientes para haver padrão
async function avaliarRiscoRoboComHistorico(historico) {
    const respostasSdr = historico.filter(m => m.role === 'assistant').length;
    if (respostasSdr < 5) return false; // aumentado 3→5: evita disparo prematuro em conversas curtas

    const mensagensLead = historico.filter(m => m.role === 'user')
        .filter(m => !m.content.startsWith('[AUTORESPOSTA]') && !m.content.startsWith('[SUSPEITA_BOT]'));

    if (mensagensLead.length === 0) return false;

    // Nenhuma mensagem do lead mostrou sinal humano após 6+ respostas do SDR → bot silencioso
    const algumSinalHumano = mensagensLead.some(m => detectarSinalHumano(m.content));
    if (respostasSdr >= 6 && !algumSinalHumano) return true; // aumentado 4→6

    // Últimas 3 mensagens do lead: todas curtas (< 25 chars) e sem sinal humano.
    // Exige mínimo de 4 mensagens do lead para ter padrão confiável (evita marcar conversas iniciantes).
    const ultimas3 = mensagensLead.slice(-3);
    if (mensagensLead.length >= 4 && ultimas3.length >= 3 && ultimas3.every(m =>
        m.content.trim().length < 25 && !detectarSinalHumano(m.content)
    )) return true;

    return false;
}

// 🎯 Detector de robô por REGEX (custo zero, latência zero)
// Padrões HARD: nunca são fala humana natural → ROBO imediato
// Padrões SOFT: podem aparecer em fala humana → só ROBO se não houver sinal humano
function analisarIntencaoRegex(texto) {
    if (!texto || texto.trim().length === 0) return "[HUMANO]";
    const t = texto.toLowerCase().trim();

    // HARD: estruturas impossíveis em conversa humana espontânea
    const PADROES_HARD = [
        // Menus numerados / URA
        /(?:digite|opcao|opção|selecione|escolha)\s*(?:a|uma)?\s*(?:opção|alternativa)?\s*\d/i,
        /^\s*\d\s*[-–—\.)]\s*.+(\n\s*\d\s*[-–—\.)]\s*.+){1,}/m,  // 2+ linhas numeradas
        /(?:1\s*[-–]\s*.+\n\s*2\s*[-–])/,
        /\*\s*\d+\s*\*/,
        /confirme\s+(?:digitando|enviando|respondendo)\s+(?:com\s+)?\d/i,
        /(?:responda|digite|envie)\s+(?:sim|1|s)\s+para\s+confirmar/i,

        // Protocolo / ticket automático
        /protocolo\s*[:#n°\s]\s*\d+/i,
        /n[°º]\s*(?:do\s+)?atendimento\s*:?\s*\d+/i,
        /ticket\s*(?:aberto|criado|registrado|n[°º]?)/i,
        /sua\s+solicita[çc][ãa]o\s+foi\s+registrada/i,
        /sua\s+mensagem\s+foi\s+recebida/i,

        // Transferência e fila
        /transferindo\s+(?:sua\s+)?(?:chamada|mensagem|atendimento)/i,
        /voc[êe]\s+est[áa]\s+na\s+fila/i,
        /conectando\s+(?:você\s+)?(?:com|ao?)\s+(?:um\s+)?atendente/i,
        /aguarde[,.]?\s*(?:um\s+momento|seu\s+atendimento|transferindo)/i,
        /(?:em\s+breve\s+)?(?:um\s+)?atendente\s+(?:ir[aá]|vai|estará)/i,
        /(?:para\s+falar\s+com\s+(?:um|nosso)\s+atendente)/i,
        /atendimento\s+autom[áa]tico/i,
        /n[ãa]o\s+atendemos\s+liga[çc][õo]es/i,

        // Coleta de dados / formulário
        /(?:informe|deixe|envie|mande)\s+(?:seu|sua|o)\s+(?:nome|cpf|data|pedido|produto)/i,
        /⚠️\s*seu\s+nome/i,
        /para\s+iniciar\s+(?:o\s+)?atendimento/i,
        /atendimento\s+por\s+ordem\s+de/i,

        // Links de sistemas de pedido
        /https?:\/\/(?:instadelivery|menudino|goomer|ola\.click)/i,
        /(?:acesse|confira|veja)\s+(?:nosso|o)\s+(?:cardápio|menu|catálogo)/i,

        // Horários corporativos formatados (blocos de texto de bot)
        /^(?:seg\s+[aà]\s+sex|segunda\s+[aà]|funciona\w+\s+das?\s+\d)/i,
        /(?:segunda\s+[aà]\s+sexta|seg\s+[aà]\s+sex)[^.]{0,40}\d{1,2}h/i,
        /segunda\s+a\s+s[aá]bado[^.]{0,40}\d{1,2}[:h]/i,
        /hor[aá]rio\s+de\s+(?:atendimento|funcionamento)/i,
        /atendimento\s+(?:das|de)\s+\d/i,

        // Listas por letras A) B) C)
        /^\s*(?:\*?[A-Z]\)\*?|\*?[A-Z]\.\*?)\s+\S+/m,

        // Fora do horário
        /(?:n[ãa]o\s+(?:é|e)\s+poss[ií]vel\s+atend|fora\s+do\s+hor[aá]rio)/i,
        /n[ãa]o\s+(?:estamos\s+)?(?:conseguindo\s+)?(?:atender|te\s+atender)\s+no\s+momento/i,

        // Auto-resposta de imobiliária / chatbot comercial (bots que escapam dos padrões genéricos)
        /j[aá]\s+recebi\s+(?:sua|a\s+sua)\s+mensagem/i,          // "Já recebi sua mensagem e logo retorno"
        /logo\s+retorno\s+com\s+as\s+informa[çc][oõ]es/i,         // "logo retorno com as informações"
        /assistente\s+virtual/i,                                   // "sou o assistente virtual"
        /em\s+breve\s+(?:um\s+de\s+)?(?:nosso|nossa)s?\s+(?:consultor|atendente|corretor|especialista)/i, // "em breve um de nossos consultores"
        /logo\s+(?:um\s+de\s+)?(?:nosso|nossa)s?\s+(?:consultor|atendente|corretor)\s+entr/i, // "logo um consultor entrará"
        /agradecemos\s+(?:o\s+)?(?:seu|sua)?\s*contato/i,         // "Agradecemos o contato" (hard — always bot)
        /seja\s+bem[\s-]?vind[oa]\s+[aà]/i,                       // "Seja bem-vindo(a) à [Empresa]"
    ];

    for (const padrao of PADROES_HARD) {
        if (padrao.test(t)) return "[ROBO]";
    }

    // SOFT: frases que bots usam mas humanos também podem usar em contexto
    // Só classifica como ROBO se NÃO houver sinal humano na mensagem
    const PADROES_SOFT = [
        /(?:retornaremos|em\s+breve\s+retorn|entraremos\s+em\s+contato)/i,  // "entraremos em contato" — humanos prometem isso
        /agradec\w+\s+(?:o\s+)?(?:seu|sua\s+)?contato/i,                    // "agradecemos o contato"
        /bem[- ]?vind[oa]/i,                                                  // "seja bem-vindo(a)"
        /(?:em\s+)?hor[aá]rio\s+comercial/i,                                 // "horário comercial"
        /(?:cardapio|card[áa]pio|menu|catalogo|catálogo)\s*(?:digital|online|aqui)/i,
    ];

    const temSinalHumano = detectarSinalHumano(t);
    for (const padrao of PADROES_SOFT) {
        if (padrao.test(t) && !temSinalHumano) return "[ROBO]";
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
        console.log(`📦 [CACHE-HIT] ${instanceId.slice(0,8)} — status="${cache.dados?.whatsapp_status}" idade=${Math.round((agora - cache.timestamp)/1000)}s`);
        return cache.dados;
    }

    console.log(`🔍 [CACHE-MISS] ${instanceId.slice(0,8)} — buscando regras do DB`);
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

    // Herda config da conta (profile) — campos não preenchidos no chip usam o padrão da conta
    if (regrasDoBanco?.user_id) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('calendly_link, opening_templates, default_agent_name, default_company_name, default_daily_limit, default_tts_voice')
            .eq('id', regrasDoBanco.user_id)
            .maybeSingle();

        if (profile?.calendly_link) regrasDoBanco.calendly_link = profile.calendly_link;
        // opening_templates sempre vem do profile — é a fonte única da verdade para A/B/C
        if (profile?.opening_templates) regrasDoBanco.opening_templates = profile.opening_templates;
        if (!regrasDoBanco.agent_name && profile?.default_agent_name) regrasDoBanco.agent_name = profile.default_agent_name;
        if (!regrasDoBanco.company_name && profile?.default_company_name) regrasDoBanco.company_name = profile.default_company_name;
        if (!regrasDoBanco.daily_limit && profile?.default_daily_limit) regrasDoBanco.daily_limit = profile.default_daily_limit;
        if (profile?.default_tts_voice) regrasDoBanco.tts_voice = regrasDoBanco.tts_voice || profile.default_tts_voice;
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

    // Só afirma nome de empresa quando há sinal real (CNPJ/nicho/capital). Em lead inbound
    // orgânico o "name" é o pushName do WhatsApp (nome de pessoa) — nesse caso NÃO presumir empresa.
    const empresaConfiavel = empresaConfiavelDoLead(contextoLead);
    const nomeEmpresa = empresaConfiavel ? limparNomeEmpresa(empresaConfiavel) : 'sua empresa';

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

    const isSolar = !instanceData?.product_type || instanceData.product_type === 'solar';
    const isB2C   = instanceData?.b2c_mode === true; // leads são pessoas físicas/alunos, não empresas

    const secaoIdentidade = isSolar
        ? `[IDENTIDADE]
Você é ${agentName}, especialista em eficiência energética da ${companyName}.
Seu objetivo é qualificar o interesse do lead e levá-lo a agendar uma consultoria gratuita.
Você se comunica como um ser humano no WhatsApp — direto, sem formalidade excessiva, sem robótica.`
        : `[IDENTIDADE]
Você é ${agentName}, representante da ${companyName}.
Seu objetivo é qualificar o interesse do lead e levá-lo a agendar uma conversa com o time.
Você se comunica como um ser humano no WhatsApp — direto, sem formalidade excessiva, sem robótica.`;

    const diretrizGatekeeper = isB2C
        ? `- B2C OBRIGATÓRIO: Quem responde É o próprio aluno/decisor. NUNCA pergunte por "responsável" ou "quem cuida". Se perguntarem de onde somos: explique que é o acompanhamento pós-venda do produto adquirido.`
        : `- EMPATIA COM GATEKEEPER (REGRA DE OURO): Quando alguém disser que não é o decisor, NUNCA pule direto para "vai passar o contato?". Primeiro: agradeça a atenção da pessoa com genuinidade ("que legal que me atendeu", "obrigado pelo tempo"). Só então, de forma leve e natural, pergunte se consegue uma ponte com o responsável. A venda começa com a pessoa que te atendeu — ela pode abrir ou fechar a porta.`;

    const secaoDiretrizes = `[DIRETRIZES DE FECHAMENTO]
- Fale curto e natural: 2 a 4 balões curtos por resposta, ~10-25 palavras cada, uma ideia por balão. Você pode marcar cortes com [QUEBRA]; se não marcar, o sistema quebra sozinho em frases (nunca corta frase no meio).
- Simule digitação humana: uma ideia por vez, sem listas numeradas ou marcadores.
- Faça APENAS UMA pergunta por mensagem. Nunca duas.
- Foco absoluto em converter para agendamento: ${calendlyResolvido}
- Nunca revele que é uma IA antes do REVEAL programado.
- Texto puro: sem asteriscos, sem markdown.
- Termine com uma pergunta ("?") que faça a conversa avançar, EXCETO em REPASSE, REVEAL, no PRIMEIRO CONTATO e quando enviar o link de agendamento (o link é um convite, não uma pergunta — nunca coloque "?" depois dele).
- Tags obrigatórias no final de toda resposta: [ESTAGIO:N] e [CLIMA:X].
${diretrizGatekeeper}`;

    const secaoRegional = isSolar
        ? `[INTELIGÊNCIA REGIONAL]
- Concessionária local do lead: ${concessionariaLocal}
- Redução esperada na fatura: ${percentualTexto}%
- Economia anual estimada: ${economiaAnualFormatada}/ano (use APENAS este valor — nunca mencione o valor mensal)
- Contexto regional: ${contextoBairro}
- ${perfilComportamental}`
        : isB2C
            ? `[CONTEXTO DO LEAD]
- Produto adquirido: ${nomeEmpresa}
- CONTEXTO B2C: O lead é uma pessoa física que já comprou o produto. NÃO há empresa envolvida. Ele é o aluno e o decisor. Modo: acompanhamento pós-venda, não prospecção B2B.`
            : `[CONTEXTO DO LEAD]
- Localização: ${bairroLead}
${empresaConfiavel
    ? `- Empresa: ${nomeEmpresa}`
    : `- Empresa/segmento do lead: DESCONHECIDO. Você ainda não sabe onde ele trabalha nem o que ele faz. NÃO invente, NÃO presuma e NUNCA use o nome do WhatsApp dele como se fosse o nome de uma empresa. Descubra com naturalidade o que ele faz antes de qualquer coisa.`}
- ${perfilComportamental}`;

    const secaoNicho = isSolar
        ? (dadosNicho
            ? `[ESTRATEGIA DO NICHO]
- Nicho identificado: ${contextoLead.niche || 'empresa comercial'}
- Equipamentos de alto consumo: ${dadosNicho.equipamentos}
- Dor principal do negócio: ${dadosNicho.dor_principal}
- Ângulo de abordagem comercial: ${dadosNicho.angulo_venda}`
            : `[ESTRATEGIA DO NICHO]
- Nicho identificado: ${contextoLead.niche || 'empresa comercial'}
- Equipamentos de alto consumo: ar condicionado, iluminação, equipamentos industriais.
- Dor principal do negócio: conta de energia elevada reduzindo margem do negócio.
- Ângulo de abordagem comercial: redução imediata da maior despesa fixa da empresa.`)
        : `[ESTRATEGIA DO NICHO]
- Nicho identificado: ${contextoLead.niche || 'empresa comercial'}
- Siga estritamente a constituição do agente para adaptar o ângulo de abordagem ao nicho.`;

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

    // --- 10. Acolhida de primeiro contato inbound ---
    // Se não há NENHUMA mensagem 'assistant' no histórico, é porque a IA nunca abriu essa
    // conversa — o lead procurou primeiro (chip inbound_only, orgânico, indicação etc.).
    // Em fluxo outbound isso nunca é true: o opening_template já gravou a 1ª msg 'assistant'
    // antes do lead responder. Sem esse aviso, a IA aplica o Passo 1 do roteiro de qualificação
    // como se já tivesse se apresentado, soando como "oi, que bom que me atendeu" fora de contexto.
    const jaFalouAntes = historico.some(m => m.role === 'assistant');
    const secaoAcolhidaInbound = jaFalouAntes ? '' : `

[PRIMEIRO CONTATO — O LEAD FALOU PRIMEIRO]
Ele te procurou por conta própria — você nunca abriu essa conversa antes. Não presuma que ele já sabe quem você é ou por que está falando com você. NÃO dispare a pergunta de qualificação do roteiro (Passo 1) nesta primeira resposta.
Em vez disso: apresente-se em 1 frase curta (quem você é e o que a ${companyName} faz), demonstre curiosidade genuína pelo motivo do contato dele, e responda com clareza qualquer pergunta ou dúvida direta que ele tenha feito. Seja calorosa e humana — acolhimento antes de roteiro.
Só avance para a qualificação (Passo 1 em diante) na mensagem seguinte, depois que ele engajar ou responder.`;

    // use_modular_sections=false no banco → apenas o system_prompt do tenant, sem injeção hardcoded
    if (instanceData?.use_modular_sections === false) return constituicaoResolvida + secaoAcolhidaInbound;
    // Hardcoded vem DEPOIS do system_prompt — tenant tem precedência, seções modulares são complemento
    return `${constituicaoResolvida}${secaoAcolhidaInbound}\n\n${secaoModular}`;
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

    // 💸 Garante o tenant no contexto p/ o teto de custo (caso este cérebro seja
    // chamado fora do workerIA — ex.: caminho de conversa humana).
    definirTenantLLM(userId);

    // 2. Busca o Cérebro Centralizado
    const { data: brain } = await supabase
        .from('tenant_prompts')
        .select('system_prompt')
        .eq('user_id', userId)
        .maybeSingle();

    // Override POR CHIP: se a instância tem system_prompt próprio (ex.: chip de anúncio/
    // inbound, que recebe lead quente e não precisa de quebra-gelo frio), ele vence o
    // prompt da conta. Senão, usa o tenant_prompts (comportamento atual preservado).
    const overrideChip = instanceData?.system_prompt?.trim();
    const promptBase = (overrideChip && overrideChip.length >= 100) ? overrideChip : brain?.system_prompt;
    if (overrideChip && overrideChip.length >= 100) {
        console.log(`🎯 [PROMPT-CHIP] Usando system_prompt específico do chip (override da conta).`);
    }

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
            const respostaDaIA = await chamarLLM({
                system: promptFinal,
                messages: historicoPodado,
                model: MODELOS.cerebro,
                maxTokens: 500, // folga p/ o gpt-oss não cortar a resposta no meio (latência não é gargalo)
            });
            if (!respostaDaIA) throw new Error('resposta vazia da LLM');
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
        const rawResponse = await chamarLLM({
            messages: [{ role: 'user', content: `Você é um motor de extração de dados.
                        Analise a imagem e identifique se é uma conta de energia.
                        Se não for, retorne: {"error": "invalid_media"}.
                        Se for, extraia EXATAMENTE neste formato JSON, convertendo valores para números puros:
                        {
                          "concessionaria": "nome da empresa",
                          "valor_total": 0.00,
                          "consumo_kwh": 0,
                          "estado": "UF",
                          "mes_referencia": "MM/AAAA"
                        }` }],
            imagens: [{ media_type: 'image/jpeg', dataBase64: buffer.toString('base64') }],
            model: MODELOS.visao,
            maxTokens: 500,
        });
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

async function startInstance(instanceId, instanceName, preloadedUserId = null) {
    if (instanciasLigando.has(instanceId)) return; // Se já está ligando, ignora
    instanciasLigando.add(instanceId);
    // Safety net: qualquer exceção antes do socket subir limpa o lock para permitir retry
    const _cleanupLock = (err) => { instanciasLigando.delete(instanceId); throw err; };

    // Encerra socket anterior se existir (evita dois sockets concorrentes no mesmo chip).
    // Usa instanciasEncerrandoManualmente para silenciar o handler de close e impedir
    // que o socket antigo sobrescreva as sessions com ready:false quando fechar.
    const sessaoExistente = sessions.get(instanceId);
    if (sessaoExistente?.sock) {
        instanciasEncerrandoManualmente.add(instanceId);
        try { sessaoExistente.sock.end(); } catch (_) {}
        sessions.delete(instanceId);
        // Aguarda 100ms para o close event do socket antigo disparar (e ser silenciado),
        // depois limpa a flag para que o NOVO socket não receba SHUTDOWN SILENCIOSO se falhar rápido.
        await new Promise(r => setTimeout(r, 100));
        instanciasEncerrandoManualmente.delete(instanceId);
    }

    console.log(`[MANAGER] 🚀 Ligando SDR: ${instanceName}`);

    // ─── CASCATA DE RESOLUÇÃO DO USER_ID ────────────────────────────────────
    // Nível 1: parâmetro direto (criação nova — zero latência, sem race condition)
    let instanceUserId = preloadedUserId || null;

    // Nível 2: Redis (reconexões — sub-milissegundo, sem tocar no Supabase)
    if (!instanceUserId) {
        instanceUserId = await getOwnerFromRedis(redisConnection, instanceId);
        if (instanceUserId) console.log(`⚡ [CACHE] userId de ${instanceName} resolvido via Redis.`);
    }

    // Nível 3: Supabase (fallback — busca user_id + created_at + daily_limit para cold-start delay)
    const { data: instData } = await supabase
        .from('instances')
        .select('user_id, created_at, daily_limit')
        .eq('id', instanceId)
        .maybeSingle();

    if (!instanceUserId && instData?.user_id) {
        instanceUserId = instData.user_id;
        await saveOwnerToRedis(redisConnection, instanceId, instanceUserId); // cacheia para próximas reconexões
        console.log(`💾 [CACHE] userId de ${instanceName} resolvido via Supabase e salvo no Redis.`);
    }

    // Sem user_id após as 3 tentativas → aborta para não vazar dados entre tenants
    if (!instanceUserId) {
        console.error(`🚨 [CRÍTICO] Instância ${instanceId} (${instanceName}) sem user_id após Parâmetro→Redis→Supabase. Abortando.`);
        instanciasLigando.delete(instanceId);
        return;
    }
    // ────────────────────────────────────────────────────────────────────────

    // Proxy dinâmico por chip via sticky session (sem consulta ao banco):
    // PROXY_BASE_URL define o template; SESSION_ID é substituído pelo instanceId.
    // Fallback: PROXY_URL (global) → sem proxy (Railway IP).
    const proxyUrl = generateProxyUrl(instanceId) || process.env.PROXY_URL || null;
    // validateProxy lança erro se proxyUrl estiver definido mas falhar — chip não sobe sem proxy.
    // Retorna null apenas quando proxyUrl é null (chip sem proxy configurado intencionalmente).
    let agent;
    try {
        agent = await validateProxy(proxyUrl, instanceId);
    } catch (err) {
        if (err.proxyError === '504') {
            const tentativas = (proxy504Tentativas.get(instanceId) || 0) + 1;
            proxy504Tentativas.set(instanceId, tentativas);
            if (tentativas <= 3) {
                console.log(`[PROXY-RETRY-AGENDADO] Chip ${instanceId.slice(0,8)}: tentativa ${tentativas}/3 em 3min (proxy 504 transitório — não conta como reconexão)`);
                instanciasLigando.delete(instanceId);
                setTimeout(() => startInstance(instanceId, instanceName, preloadedUserId), 3 * 60 * 1000);
                return;
            }
            proxy504Tentativas.delete(instanceId);
            console.warn(`⚠️ [PROXY-504-PERSISTENTE] Chip ${instanceId.slice(0,8)}: 3 retries esgotados — proxy ainda em 504. Tratando como falha normal.`);
        }
        return _cleanupLock(err); // limpa instanciasLigando e re-lança
    }
    if (!agent) console.log(`ℹ️ [PROXY] ${instanceName} sem proxy configurado — modo direto.`);

    // Jitter de startup: evita burst de logins simultâneos quando Railway reinicia todos os chips de uma vez.
    const startupJitter = Math.floor(Math.random() * 30000); // 0-30s
    if (startupJitter > 0) {
        console.log(`⏳ [JITTER] ${instanceName} aguardando ${Math.round(startupJitter / 1000)}s antes de conectar...`);
        await new Promise(resolve => setTimeout(resolve, startupJitter));
    }

    //const { state, saveCreds } = await useMultiFileAuthState(`wpp_sessions/${instanceId}`);
    // Agora as chaves do WhatsApp vivem no Supabase, protegidas contra restarts

    // Detecta atualização do Baileys: se a versão gravada no Redis for diferente da atual,
    // limpa a sessão antes de carregar — evita incompatibilidade silenciosa de protocolo.
    const redisVersionKey = `wpp_auth:${instanceId}:baileys_version`;
    const storedBaileysVersion = await redisConnection.get(redisVersionKey).catch(() => null);
    if (storedBaileysVersion && storedBaileysVersion !== BAILEYS_VERSION) {
        console.log(`🔄 [VERSION] ${instanceName} — Baileys atualizado (${storedBaileysVersion} → ${BAILEYS_VERSION}). Limpando sessão para evitar incompatibilidade...`);
        await clearRedisSession(redisConnection, instanceId);
    }

    const { state, saveCreds } = await useRedisAuthState(redisConnection, instanceId);
    const { version } = await fetchLatestBaileysVersion();

    // keepAlive dentro do range do WA Web real (~25-30s) mas seguro para NAT de proxy residencial.
    // Ubuntu/IPRoyal têm timeout ~30-60s — 20-28s mantém o túnel sem parecer agressivo.
    const keepAliveMs = 20000 + Math.floor(Math.random() * 8000); // 20-28s

    let sock;
    try {
        sock = makeWASocket({
            version,
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.windows('Chrome'), // Windows é o OS mais comum entre usuários reais de WA Web
            keepAliveIntervalMs: keepAliveMs,
            connectTimeoutMs: 60000,
            markOnlineOnConnect: false,
            retryRequestDelayMs: 3000 + Math.floor(Math.random() * 7000),
            syncFullHistory: false,              // não sincroniza histórico — bots fazem isso, humanos não
            generateHighQualityLinkPreview: false, // não gera preview instantâneo — padrão de bot
            getMessage: async (key) => sentMessagesStore.get(`${instanceId}:${key.id}`) || undefined,
            ...(agent ? { agent } : {}),
        });
    } catch (socketErr) {
        const safeMsg = (socketErr.message || 'erro desconhecido').replace(/:[^:@]*@/g, ':***@');
        console.error(`🚫 [SOCKET FAIL] ${instanceName} falhou ao criar socket: ${safeMsg}`);
        await supabase.from('instances').update({ whatsapp_status: 'proxy_failed' }).eq('id', instanceId);
        instanciasLigando.delete(instanceId);
        return;
    }

    // Guardamos o socket com uma flag 'ready' falsa inicialmente
    sessions.set(instanceId, { sock, ready: false, userId: instanceUserId });
    sock.ev.on('creds.update', saveCreds);
 
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            if (!ioSocket)       console.warn(`⚠️ [QR] ioSocket null — QR de ${instanceName} não enviado ao front`);
            else if (!instanceUserId) console.warn(`⚠️ [QR] instanceUserId null — instância ${instanceId} sem user_id no banco`);
            else ioSocket.to(`user:${instanceUserId}`).emit('qr_code', { qr, instanceId, name: instanceName });
        }

        if (connection === 'open') {
            if (chipsEmConflito.has(instanceId)) {
                console.log(`✅ [CONFLITO-RECOVERY] ${instanceName}: reconectou com sucesso após connectionReplaced`);
                chipsEmConflito.delete(instanceId);
            }
            console.log(`✅ [SDR] Canal Pronto e Estável: ${instanceName}`);
            cancelarDebounceChip(instanceId); // Chip voltou — cancela alerta de desconexão se ainda no debounce
            tentativasReconexao.delete(instanceId); // Fase 4: conexão bem-sucedida — zera o contador
            chipsAbandanados.delete(instanceId); // conexão bem-sucedida remove bloqueio de auto-reconexão
            abandonadoEm.delete(instanceId);
            ultimoAlertaAbandono.delete(instanceId);
            // 🗄️ Chip pronto: reprocessa inbound que ficou pendente na gaveta durante um restart/queda.
            recuperarGavetasPendentes(instanceId, sock).catch(e => console.error(`❌ [GAVETA-RECUPERA] ${instanceName}:`, e.message));
            // staleContador NÃO é limpo aqui: soft reconnect preserva a contagem de falhas stale para que
            // o chip acumule até o limite (4) e acione o hard restart. Só reseta em envio confirmado ou hard restart.
            // falhasLeadPorSessao NÃO é limpo aqui: soft reconnect preserva o histórico de falhas por lead
            // para que o anti-loop de 2 strikes continue a funcionar entre reconexões da mesma sessão WA.
            cacheRegrasInstancia.delete(instanceId); // força releitura do DB no próximo ciclo — garante whatsapp_status=CONNECTED após reconexão
            // Encerra socket fantasma: se havia um socket diferente registrado (ex: QR re-scan sem Remove+Add),
            // fecha o antigo antes de registrar o novo — impede que mensagens saiam pelo socket morto
            const sessaoAnterior = sessions.get(instanceId);
            if (sessaoAnterior && sessaoAnterior.sock !== sock) {
                try { sessaoAnterior.sock.end(); } catch (_) {}
                console.log(`🔁 [SOCKET] ${instanceName} — socket antigo encerrado, novo ativo.`);
            }
            sessions.set(instanceId, { sock, ready: true, userId: instanceUserId, name: instanceName }); // <--- LIBERADO PARA ENVIO
            instanciasLigando.delete(instanceId);

            // Presença periódica: aparece online 30-90s a cada 8-20min — simula humano pegando o celular
            ;(function agendarPresencaPeriodica() {
                const ms = (8 + Math.random() * 12) * 60000;
                const t = setTimeout(async () => {
                    const s = sessions.get(instanceId);
                    if (!s?.ready || !s?.sock) return;
                    try {
                        await s.sock.sendPresenceUpdate('available');
                        await delay(30000 + Math.random() * 60000);
                        await s.sock.sendPresenceUpdate('unavailable');
                    } catch (_) {}
                    agendarPresencaPeriodica();
                }, ms);
                if (t.unref) t.unref();
            })();
            // Emit imediato ao frontend — não depende do DB para não bloquear a UI
            if (ioSocket && instanceUserId) ioSocket.to(`user:${instanceUserId}`).emit('whatsapp_status', { status: 'CONNECTED', instanceId });
            // DB update separado: falha silenciosa não afeta o emit nem o motor
            db.updateInstanceStatus(instanceId, 'CONNECTED')
                .then(() => console.log(`✅ [STATUS-DB] ${instanceName} gravado como CONNECTED no banco`))
                .catch(e => console.error(`⚠️ [STATUS-DB] Falha ao gravar CONNECTED para ${instanceName}: ${e.message}`));
            // Grava versão do Baileys desta sessão — usada para detectar incompatibilidade na próxima atualização
            redisConnection.set(redisVersionKey, BAILEYS_VERSION).catch(() => {});
            // Realoca leads órfãos do mesmo tenant para este chip
            setTimeout(() => redistribuirLeadsOrfaos(), 3000);
            // Liga o motor de ataque deste chip se ainda não estiver rodando.
            // Cold-start delay: chip novo espera 25 min antes do primeiro disparo —
            // evita o padrão "recém autenticado → imediato outreach" que o WA detecta.
            if (!motoresEmExecucao.has(instanceId)) {
                const chipNovoAgora = isChipNovo(instData);
                const coldStartMs = chipNovoAgora ? 25 * 60000 : 90000; // 25 min novo / 90s maduro
                console.log(`🚀 [MOTOR] ${instanceName} — cold-start de ${Math.round(coldStartMs / 60000)}min ${chipNovoAgora ? '(chip novo, warmup)' : '(chip maduro)'}`);
                setTimeout(() => processarFilaDeAtaque(instanceId), coldStartMs);
            }
        }

       if (connection === 'close') {
            // 👇 A barreira de silêncio (Encerramento Manual)
            if (instanciasEncerrandoManualmente.has(instanceId)) {
                console.log(`🔇 [SHUTDOWN SILENCIOSO] Chip ${instanceName} removido pelo painel. Alerta abortado.`);
                instanciasEncerrandoManualmente.delete(instanceId);
                return; // 🛑 Mata a execução aqui!
            }

            sessions.set(instanceId, { sock, ready: false, userId: instanceUserId, name: instanceName });
            instanciasLigando.delete(instanceId);
            sucessosPorSessao.delete(instanceId); // sessão encerrada — contador zerado para a próxima sessão
            ultimaQuedaPorChip.set(instanceId, Date.now()); // 🩹 marca início da janela de catch-up
            const reason = (lastDisconnect?.error)?.output?.statusCode;

            // Notifica frontend imediatamente (sem esperar o DB)
            if (ioSocket && instanceUserId) ioSocket.to(`user:${instanceUserId}`).emit('whatsapp_status', { status: 'DISCONNECTED', instanceId });
            // Move leads 'new' deste chip para outros chips saudáveis do mesmo tenant
            // Não espera o DB.updateStatus — usa sessions Map como fonte de verdade (já atualizado acima)
            setTimeout(() => redistribuirLeadsOrfaos(), 1500);

            // Avisa no Discord via debounce de 3 min (exceto loggedOut/banido)
            if (reason !== DisconnectReason.loggedOut && reason !== 403 && reason !== 401) {
                alertaChipOffline(instanceId, instanceName);
            }

            // 🔴 ERROS FATAIS (Deslogado, Banido, ou Rejeitado pela Meta)
            if (reason === DisconnectReason.loggedOut || reason === 403 || reason === 401) {
                console.log(`🔴 [FATAL ${reason}] ${instanceName} foi rejeitado ou deslogado. Limpando sessão Redis + Supabase para novo QR...`);
                console.warn(`[REDIS-WIPE-CAUSE] Chip ${instanceId}: wipe por FATAL ${reason} (sessão rejeitada pelo WA)`);
                await clearRedisSession(redisConnection, instanceId);
                await supabase.from('whatsapp_sessions').delete().eq('id', instanceId);
                await supabase.from('whatsapp_keys').delete().eq('instance_id', instanceId);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                // Fase 2: avisa frontend para mostrar botão "re-escanear QR" específico
                if (ioSocket && instanceUserId) ioSocket.to(`user:${instanceUserId}`).emit('chip_needs_reauth', { instanceId, instanceName });
                tentativasReconexao.delete(instanceId); // reseta counter — nova sessão começa do zero
                sucessosPorSessao.delete(instanceId);
                primeiroEnvioSucesso.delete(instanceId);
                for (const key of falhasLeadPorSessao.keys()) {
                    if (key.startsWith(instanceId + ':')) falhasLeadPorSessao.delete(key);
                }
                return; // 🛑 MATA O LOOP AQUI! Sem setTimeout, sem insistir.
            }

            // Fase 4: helper para tentar reconexão com limite de 10 tentativas
            const tentarReconexao = (delayMs, motivo) => {
                const tentativas = (tentativasReconexao.get(instanceId) || 0) + 1;
                if (tentativas > 10) {
                    console.error(`🚫 [RECONEXÃO] ${instanceName} atingiu 10 tentativas sem sucesso. Pausando auto-reconexão por ${Math.round(COOLDOWN_ABANDONO_MS/60000)}min (auto-recuperação no VIGIA).`);
                    enviarAlerta(`🚫 *Chip caído*: ${instanceName} falhou 10x seguidas. Vou tentar recuperar sozinho em ~${Math.round(COOLDOWN_ABANDONO_MS/60000)}min; se não voltar, clique em *Resetar Sessão* no dashboard.`).catch(() => {});
                    chipsAbandanados.add(instanceId);
                    abandonadoEm.set(instanceId, Date.now());
                    ultimoAlertaAbandono.set(instanceId, Date.now());
                    return;
                }
                tentativasReconexao.set(instanceId, tentativas);
                // Após HARD restart, WA fica suspeito: aguarda mínimo 5min antes de reconectar
                const msDesdeHard = Date.now() - (ultimoHardRestart.get(instanceId) || 0);
                const COOLDOWN_HARD = 5 * 60 * 1000;
                const delayFinal = msDesdeHard < COOLDOWN_HARD
                    ? Math.max(delayMs, COOLDOWN_HARD - msDesdeHard)
                    : delayMs;
                if (delayFinal > delayMs) console.warn(`⏳ [HARD-COOLDOWN] ${instanceName} — aguardando ${Math.round(delayFinal/1000)}s para não estressar o WA após wipe de sessão.`);
                console.log(`🔄 [RECONEXÃO] ${instanceName} — tentativa ${tentativas}/10 (${motivo}) em ${Math.round(delayFinal/1000)}s...`);
                setTimeout(() => {
                    if (instanciasDeletadas.has(instanceId)) return;
                    startInstance(instanceId, instanceName).catch(e =>
                        console.error(`❌ [RECONEXÃO] startInstance falhou para ${instanceName}: ${e.message}`)
                    );
                }, delayFinal);
            };

            // 🔴 Sessão corrompida localmente (Bad Session)
            if (reason === DisconnectReason.badSession) {
                console.log(`🔴 [BAD SESSION] ${instanceName} com chaves corrompidas. Limpando e pedindo novo QR...`);
                await supabase.from('whatsapp_sessions').delete().eq('id', instanceId);
                await supabase.from('whatsapp_keys').delete().eq('instance_id', instanceId);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                tentarReconexao(3000, 'bad session');
                return;
            }

            // 🔴 Conflito (logou em outro lugar)
            if (reason === DisconnectReason.connectionReplaced) {
                console.log(`⚠️ [CONFLITO-DETECTADO] ${instanceName}: session replaced (celular ou outra aba). Credenciais Redis preservadas. Reconectando em 45s.`);
                chipsEmConflito.add(instanceId);
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                // Usa startInstance() (não reconectarInstancia) — preserva credenciais Redis, evita wipe desnecessário.
                // instanciasLigando já foi limpo no início deste handler (linha ~1474) — sem race condition com vigia.
                setTimeout(() => startInstance(instanceId, instanceName, instanceUserId), 45000);
                return;
            }

            // Timeout de conexão → reconecta com backoff por tentativa + jitter (desincroniza chips)
            if (reason === DisconnectReason.timedOut || reason === DisconnectReason.connectionLost) {
                const tentativasAtuais = (tentativasReconexao.get(instanceId) || 0) + 1;
                const backoffMs = calcularBackoffReconexao(tentativasAtuais);
                console.warn(`🔬 [CONN-DIAG] ${instanceName} | reason=${reason} | tentativas=${tentativasAtuais} | ligando=${instanciasLigando.size} | backoff=${backoffMs}ms`);
                // Na 5ª tentativa de timeout consecutivo as credenciais em Redis são provavelmente stale.
                // Wipe forçado → próximo startInstance emite QR novo e estabelece sessão limpa.
                if (tentativasAtuais === 5) {
                    console.warn(`🔁 [AUTO-WIPE] ${instanceName} — 5 timeouts consecutivos. Limpando sessão Redis para forçar QR...`);
                    clearRedisSession(redisConnection, instanceId).catch(() => {});
                }
                await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
                tentarReconexao(backoffMs, 'timeout/connection lost');
                return;
            }

            // Demais casos (515/503/428/etc) → mesmo backoff quadrático + jitter do branch de timeout,
            // em vez do delay fixo de 5s que martelava e brickava o chip em ~1min de oscilação.
            const tentativasGen = (tentativasReconexao.get(instanceId) || 0) + 1;
            const delayMs = calcularBackoffReconexao(tentativasGen);
            console.log(`🔄 [SDR] Conexão instável em ${instanceName} (reason: ${reason ?? 'desconhecido'}). Reiniciando em ${Math.round(delayMs/1000)}s (tentativa ${tentativasGen})...`);
            await db.updateInstanceStatus(instanceId, 'DISCONNECTED');
            tentarReconexao(delayMs, `reason ${reason ?? 'desconhecido'}`);
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
                if (!jid) continue;
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
        if (type !== 'notify') {
            // 🩹 CATCH-UP: evento de sincronização (não "ao vivo") — normalmente descartado, mas se
            // este chip caiu recentemente, pode conter mensagens que chegaram DURANTE a queda e
            // seriam perdidas para sempre. Resgata só o que é mais novo que a última queda, dentro
            // de uma janela curta (evita reprocessar histórico inteiro após queda longa/redeploy).
            const ultimaQueda = ultimaQuedaPorChip.get(instanceId);
            if (!ultimaQueda || (Date.now() - ultimaQueda) > JANELA_MAX_CATCHUP_MS) return;

            const tsMs = (m) => {
                const t = m.messageTimestamp;
                if (t == null) return 0;
                const n = (typeof t === 'object' && typeof t.toNumber === 'function') ? t.toNumber() : Number(t);
                return n * 1000;
            };
            messages = messages.filter(m => tsMs(m) >= ultimaQueda);
            if (messages.length === 0) return;
            console.log(`🩹 [CATCH-UP] ${instanceName}: ${messages.length} mensagem(ns) resgatada(s) de sincronização após queda de conexão.`);
        }

        for (const msg of messages) {
            if (!msg.message) continue;

            // Normaliza a mensagem via camada de transporte — desacopla do formato cru do Baileys.
            const evento = baileysTransport.normalizarInbound(msg);
            const remoteJid = evento.remoteJid;
            if (remoteJid.includes('@g.us')) continue; // Ignora grupos

            // Acusa leitura imediatamente (ticks azuis) — bots normalmente não fazem isso
            if (!evento.fromMe) {
                sock.readMessages([msg.key]).catch(() => {});
            }

            const isFromMe = evento.fromMe;
            const messageType = evento.tipo;
            const isMedia = ['audioMessage', 'imageMessage', 'documentMessage', 'contactMessage', 'contactsArrayMessage'].includes(messageType);

            // ⚡ VIA RÁPIDA: Se for VOCÊ digitando ou se o cliente mandou ÁUDIO/CONTA DE LUZ, processa na hora!
            if (isFromMe || isMedia) {
                console.log(`⚡ [VIA RÁPIDA] Processando mídia ou intervenção humana imediatamente...`);
                await processarMensagem(sock, msg, instanceId);
                continue;
            }

            // 📝 Texto já extraído na normalização (evento.texto)
            const texto = evento.texto;
            if (!texto) continue;

            // 🤖 FILTRO AUTOBOT: Detecta respostas automáticas de WhatsApp Business antes de processar
            {
                const tipoMsg = Object.keys(msg.message).find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
                const tipoWaBusiness = ['templateMessage', 'buttonsMessage', 'listMessage', 'buttonsResponseMessage', 'listResponseMessage'].includes(tipoMsg);
                const deltaMs = Date.now() - (ultimoEnvioTimestamp.get(remoteJid) || 0);
                const chegouRapido = deltaMs < 8000; // < 8s após envio confirmado → humano não tiparia tão rápido
                const pareceBot = AUTORESPOSTA_REGEX.test(texto);

                if (tipoWaBusiness || (chegouRapido && pareceBot)) {
                    console.log(`🤖 [AUTOBOT] Descartando autoresposta de ${remoteJid.split('@')[0]} (Δ${deltaMs}ms, tipo=${tipoMsg}): "${texto.slice(0, 80)}"`);
                    continue;
                }

                if (chegouRapido && !pareceBot) {
                    // Chegou rápido mas não bateu no regex — aguarda mais 30s na gaveta normal.
                    // Se vier msg humana real a seguir, ela se junta na gaveta. Se não vier, processa.
                    console.log(`⚡ [AUTOBOT?] Resposta em ${deltaMs}ms de ${remoteJid.split('@')[0]} — não bateu no regex, segue para gaveta (aguardando 30s)`);
                }
            }

            // 🛡️ DEDUP: Baileys multi-device pode reenviar o mesmo evento várias vezes
            const msgId = msg.key?.id;
            if (msgId) {
                if (mensagensJaProcessadas.has(msgId)) {
                    console.log(`⚠️ [DEDUP] Mensagem ${msgId} já processada. Ignorando duplicata do Baileys.`);
                    continue;
                }
                mensagensJaProcessadas.set(msgId, Date.now());
                setTimeout(() => mensagensJaProcessadas.delete(msgId), 300000); // TTL 5min
            }

            // 🗄️ LÓGICA DA GAVETA (OUVIDO PACIENTE)
            // Chave composta instance:jid para nunca misturar mensagens de chips diferentes
            const gavetaKey = `${instanceId}:${remoteJid}`;
            if (!gavetaDeMensagens.has(gavetaKey)) {
                gavetaDeMensagens.set(gavetaKey, { textos: [], timer: null, ultimaMsg: null });
            }

            const gaveta = gavetaDeMensagens.get(gavetaKey);
            gaveta.textos.push(texto); // Guarda o texto na gaveta
            gaveta.ultimaMsg = msg; // Guarda a estrutura do Baileys para conseguir responder depois

            clearTimeout(gaveta.timer); // O cliente digitou rápido de novo! Zera o cronômetro.

            // 🗄️ Espelha no Redis (metadados mínimos) — se o processo reiniciar nos próximos 30s,
            // recuperarGavetasPendentes reprocessa quando o chip voltar. Fire-and-forget.
            const msgMeta = {
                remoteJid: msg.key?.remoteJid,
                fromMe: msg.key?.fromMe || false,
                id: msg.key?.id,
                remoteJidAlt: msg.key?.remoteJidAlt,
                participant: msg.key?.participant,
                pushName: msg.pushName,
            };
            persistirGavetaRedis(instanceId, remoteJid, gaveta.textos.slice(), msgMeta);

            console.log(`⏳ [OUVIDO PACIENTE] Lead ${remoteJid.split('@')[0]} enviou mensagem. Aguardando 30s para ver se ele manda mais...`);

            gaveta.timer = setTimeout(async () => {
                try {
                    const textoConsolidado = gaveta.textos.join(' \n');
                    const msgFinal = gaveta.ultimaMsg;

                    gavetaDeMensagens.delete(gavetaKey);
                    limparGavetaRedis(instanceId, remoteJid); // já vai processar — remove o espelho

                    console.log(`🧠 [OUVIDO PACIENTE] Lead concluiu raciocínio. Processando bloco: "${textoConsolidado}"`);

                    await processarMensagem(sock, msgFinal, instanceId, textoConsolidado);
                } catch (errGaveta) {
                    console.error(`❌ [GAVETA] Erro ao processar bloco consolidado:`, errGaveta.message);
                    gavetaDeMensagens.delete(gavetaKey); // Limpa mesmo com erro
                    limparGavetaRedis(instanceId, remoteJid);
                }
            }, 30000); // 30s para consolidar mensagens picotadas antes de processar
        }
    });
   
}

// ============================================================================
// 🛡️ PASSO 1: O "CARIMBO" E RASTREIO DIGITAL DO ROBÔ (NATIVO E SEGURO)
// ============================================================================

// Aguarda SERVER_ACK (status ≥ 2) do WA server para a mensagem específica.
// Resolve também se o socket fechar após o envio — RC13 fecha conexão após entregar a mensagem
// ao servidor, então socket-close = mensagem transmitida com sucesso.
// ACK_TIMEOUT só dispara se o socket PERMANECER conectado por 45s sem resposta (sessão stale real).
function esperarAckServidor(sock, messageId, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        let done = false;

        const cleanup = () => {
            sock.ev.off('messages.update', handler);
            sock.ev.off('connection.update', connHandler);
        };

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            cleanup();
            reject(new Error(`ACK_TIMEOUT: WA server não confirmou msg ${messageId} em ${timeoutMs / 1000}s`));
        }, timeoutMs);

        function handler(updates) {
            if (done) return;
            for (const upd of updates) {
                if (upd.key?.id === messageId && (upd.update?.status ?? 0) >= 2) {
                    done = true;
                    clearTimeout(timer);
                    cleanup();
                    resolve();
                    return;
                }
            }
        }

        function connHandler({ connection }) {
            if (done || connection !== 'close') return;
            done = true;
            clearTimeout(timer);
            cleanup();
            resolve(); // socket fechou após envio — mensagem transmitida ao servidor WA
        }

        sock.ev.on('messages.update', handler);
        sock.ev.on('connection.update', connHandler);
    });
}

async function enviarMensagemIA(sock, jid, content, instanceId = null, timeoutAck = 45000) {
    // 🌐 ROTEAMENTO DE TRANSPORTE: instâncias oficiais (Cloud API via 360dialog) não têm
    // socket Baileys — enviam por HTTP, sem ACK de socket nem presença. Guarda por provider:
    // chips Baileys (default) caem no fluxo normal abaixo, 100% inalterados (ramo inerte).
    if (instanceId) {
        const _regras = await getRegrasEmCache(instanceId);
        if (_regras?.whatsapp_provider === 'official') {
            const _texto = (content && typeof content === 'object') ? (content.text ?? '') : String(content ?? '');
            const _r = await cloudApiTransport.enviarTexto({ apiKey: _regras.cloud_api_key, baseUrl: _regras.cloud_base_url }, jid, _texto);
            ultimoEnvioTimestamp.set(jid, Date.now());
            console.log(`🌐 [CLOUD-API] Enviado para ${jid.split('@')[0]} via 360dialog (msgId: ${_r.id || 'n/a'}).`);
            return { key: { id: _r.id || `cloud_${Date.now()}` } }; // formato compatível: callers checam sentMsg?.key?.id
        }
    }
    // Envio primitivo via camada de transporte (Baileys). A lógica de ACK/soft-ban abaixo
    // é específica do Baileys e permanece aqui de propósito.
    const sentMsg = await baileysTransport.enviar(sock, jid, content);
    if (sentMsg?.key?.id) {
        mensagensEnviadasPelaIA.add(sentMsg.key.id);
        mapaRastreioLID.set(sentMsg.key.id, jid);
        // Armazena mensagem para retransmissão — RC13 pode pedir a mensagem de volta via getMessage
        if (instanceId && sentMsg.message) {
            const storeKey = `${instanceId}:${sentMsg.key.id}`;
            sentMessagesStore.set(storeKey, { message: sentMsg.message });
            setTimeout(() => sentMessagesStore.delete(storeKey), 3600000); // limpa após 1h
        }
        try {
            await esperarAckServidor(sock, sentMsg.key.id, timeoutAck);
        } catch (ackErr) {
            if (ackErr.message.startsWith('ACK_TIMEOUT') && instanceId) {
                // RC13 fecha o socket logo após entregar a mensagem ao servidor WA.
                // Se o chip reconectou (novo sock na sessão), o socket antigo morreu APÓS o envio.
                // Se ainda é o mesmo socket, é sessão stale real — propaga o erro.
                const sessaoAtual = sessions.get(instanceId);
                if (sessaoAtual?.sock !== sock) {
                    console.warn(`⚠️ [ACK-MISS] ${instanceId.slice(0,8)} — chip reconectou após envio. Mensagem transmitida.`);
                    // cai no bloco de sucesso abaixo
                } else {
                    throw ackErr; // mesmo socket ainda ativo = stale real
                }
            } else {
                throw ackErr;
            }
        }
        if (instanceId) {
            if (!primeiroEnvioSucesso.get(instanceId)) {
                primeiroEnvioSucesso.set(instanceId, true);
                console.log(`✅ [SESSION-FIRST-SUCCESS] Chip ${instanceId.slice(0,8)}: primeiro envio confirmado nessa sessão — fora da zona de risco de soft-ban`);
            }
            sucessosPorSessao.set(instanceId, (sucessosPorSessao.get(instanceId) || 0) + 1);
            staleContador.delete(instanceId);
        }
        ultimoEnvioTimestamp.set(jid, Date.now()); // registra momento do envio confirmado para detecção de autoresposta
    }
    return sentMsg;
}


async function enviarAudioTTS(sock, remoteJid, texto, lead, instanceId, voz = null) {
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
        // 🎙️ DELAY PROPORCIONAL: ~2.4 palavras/seg é a cadência média de fala natural em
        // pt-BR. Roda em paralelo com a geração real do áudio — o indicador "gravando"
        // fica visível pelo MAIOR entre o tempo de processamento da API e o tempo que um
        // humano levaria de fato pra falar aquele texto (evita "gravou" um áudio de 10s em 2s).
        const palavras = textoHumanizado.split(/\s+/).filter(Boolean).length;
        const duracaoFalaEstimadaMs = Math.min(Math.max((palavras / 2.4) * 1000, 1200), 14000);
        const [buffer] = await Promise.all([
            gerarAudioTTS(textoHumanizado, voz || undefined),
            delay(duracaoFalaEstimadaMs)
        ]);

        await baileysTransport.enviar(sock, remoteJid, {
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


// Converte texto de data em português para ISO 8601 (BRT) via Groq rápido.
// Retorna string ISO ou null em caso de falha.
async function extrairDataISO(textoData) {
    try {
        const agora = new Date(Date.now() - 3 * 60 * 60 * 1000); // BRT
        const hoje  = agora.toISOString().split('T')[0];
        const iso = (await chamarLLM({
            messages: [{ role: 'user', content: `Converta a expressão de data/hora "${textoData}" para ISO 8601 no fuso UTC-3 (BRT). Hoje é ${hoje}. Responda APENAS com a string ISO (ex: 2026-06-24T15:00:00-03:00), sem nenhum texto adicional.` }],
            model: MODELOS.rapido,
            maxTokens: 25,
        }) || '').trim();
        if (!iso) return null;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
        return null;
    }
}

// ============================================================================
// 🧠 NÚCLEO UNIFICADO DE RESPOSTA — elimina duplicação entre processarMensagem
// e processarMensagemManual. Toda lógica de áudio e envio vive aqui.
// ============================================================================
async function filtrarEEnviarResposta(sock, remoteJid, resposta, historico, lead, instanceId, ttsVoz = null) {
    if (!resposta) {
        console.warn(`⚠️ [FILTRO] Resposta NULA chegou pro envio. Lead: ${lead.name}`);
        return;
    }

    // 🔍 LOG DE DIAGNÓSTICO: mostra o que a LLM gerou
    console.log(`📝 [FILTRO] Resposta RAW da LLM (${resposta.length} chars): "${resposta.substring(0, 200)}..."`);

    // ── 0. EXTRAÇÃO DE [FOLLOW_UP] — DEVE rodar ANTES da limpeza de tags ──
    const _matchFollowUp = resposta.match(/\[FOLLOW_UP:\s*([^\]]+)\]/i);
    if (_matchFollowUp && lead?.id) {
        try {
            const followUpAt = new Date(_matchFollowUp[1].trim());
            if (!isNaN(followUpAt.getTime())) {
                await supabase.from('leads').update({
                    is_paused:    true,
                    follow_up_at: followUpAt.toISOString(),
                }).eq('id', lead.id);
                console.log(`⏳ [FOLLOW-UP] Lead ${lead.name} pausado até ${followUpAt.toLocaleString('pt-BR')}.`);
            } else {
                // Data em português natural ("amanhã às 15h") — converter via Groq
                const isoResolvida = await extrairDataISO(_matchFollowUp[1].trim());
                if (isoResolvida) {
                    await supabase.from('leads').update({
                        is_paused:    true,
                        follow_up_at: isoResolvida,
                    }).eq('id', lead.id);
                    console.log(`⏳ [FOLLOW-UP] Lead ${lead.name} pausado (data natural) até ${new Date(isoResolvida).toLocaleString('pt-BR')}.`);
                } else {
                    console.warn(`⚠️ [FOLLOW-UP] Não foi possível interpretar a data: "${_matchFollowUp[1]}". Tag removida sem salvar.`);
                }
            }
        } catch (errFU) {
            console.error(`❌ [FOLLOW-UP] Erro ao salvar follow-up para ${lead?.name}:`, errFU.message);
        }
    }

    // ── 1. LIMPEZA TOTAL DE TAGS (À PROVA DE ALUCINAÇÃO) ──
    const regexTags = /\[\s*(ESTAGIO|ESTÁGIO|CLIMA|RAIO-X|PERFIL|ROBO|CONTADOR|ENGANO|GATEKEEPER|AGENDAMENTO_MANUAL|PAUSA\s*PARA\s*RESPOSTA|REVERSAO_TENTADA|FOLLOW_UP|AGUARDANDO_RETORNO)[^\]]*\]/gi;
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
    // last_contact_at sempre atualizado: mantém a ordenação do War Room correta após cada resposta da IA
    let updates = { last_contact_at: new Date().toISOString() };
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
        updates.current_stage = 5;
    }
    await supabase.from('leads').update(updates).eq('id', lead.id);
    console.log(`📊 [FILTRO] Lead atualizado:`, updates);

    // 🔕 ENCERRADO: pausa o lead após mensagem de encerramento ser enviada
    if (matchEncerrado) {
        await supabase.from('leads').update({
            is_paused: true,
            internal_notes: `Conversa encerrada pela IA em ${new Date().toLocaleString('pt-BR')}`
        }).eq('id', lead.id);
        console.log(`🔕 [ENCERRADO] Conversa finalizada para ${lead.name}. Lead pausado.`);
    }

    // ── 3. ENVIO FATIADO ──
    // Split humano no CÓDIGO (não depende do LLM emitir [QUEBRA]): respeita o [QUEBRA] se veio,
    // depois quebra frases longas em balões curtos sem NUNCA cortar frase no meio, protege URLs,
    // tira "?" colado após link e joga o link de agendamento pro último balão.
    const mensagensSplit = dividirEmBaloes(textoLimpo);
    console.log(`📤 [FILTRO] Enviando ${mensagensSplit.length} balão(ões) para ${lead.name}...`);

    // 🎙️ LÓGICA TTS: Decide se o último balão vai como áudio
    const ultimaMsgUser = historico.filter(m => m.role === 'user').slice(-1)[0];
    const leadEnviouAudio = ultimaMsgUser?.content?.startsWith('(Áudio)');
    const audiosJaEnviados = historico.filter(m => m.content?.includes('[AUDIO_TTS]')).length;
    const temCalendly = textoLimpo.includes('calendly.com');
    // Nos estágios 2-3 (revelação da economia) o áudio reforça o impacto emocional.
    // Checa tanto o estágio atual (lead.current_stage) quanto o que a IA declarou nessa resposta
    // (matchEstagio), pois lead.current_stage ainda reflete o estágio ANTERIOR nessa chamada.
    const estagioNaResposta = matchEstagio ? parseInt(matchEstagio[1]) : (lead.current_stage || 0);
    const estagioEmocional = (lead.current_stage >= 2 && lead.current_stage <= 3) ||
                              (estagioNaResposta >= 2 && estagioNaResposta <= 3);
    // Estágio 2/3 → sempre áudio (máx 2 por conversa). Outros: lead enviou áudio OU 25% aleatório.
    // !!sock: instâncias oficiais (Cloud API) não têm socket nem áudio nativo → sempre texto.
    const usarTTS = !!sock && audiosJaEnviados < 2 && !temCalendly && (leadEnviouAudio || estagioEmocional || Math.random() < 0.25);
    console.log(`🎙️ [TTS-DECISAO] usarTTS=${usarTTS} | audiosJá=${audiosJaEnviados} | calendly=${temCalendly} | leadAudio=${leadEnviouAudio} | emocional=${estagioEmocional} | estágio=${estagioNaResposta}`);

    for (let i = 0; i < mensagensSplit.length; i++) {
        const trecho = mensagensSplit[i];
        const isUltimoBalao = i === mensagensSplit.length - 1;
        try {
            // 🎙️ Último balão como áudio (quando aplicável)
            if (usarTTS && isUltimoBalao) {
                console.log(`🎙️ [TTS] Enviando último balão como áudio para ${lead.name}...`);
                const audioOk = await enviarAudioTTS(sock, remoteJid, trecho, lead, instanceId, ttsVoz);
                if (audioOk) continue;
                console.log(`⚠️ [TTS FALLBACK] Áudio falhou. Enviando como texto para ${lead.name} não ficar no vácuo.`);
            }

            if (sock) await sock.sendPresenceUpdate('composing', remoteJid); // oficial (Cloud API) não tem presença

            // ⚡ CÁLCULO DE JITTER DINÂMICO: Simula tempo de leitura + raciocínio + digitação
            const isObjecao = resposta.includes('CLIMA:DESCONFIADO') || resposta.includes('CLIMA:OCUPADO');
            const multiplicador = isObjecao ? 90 : 65;
            const tempoBase = Math.min(trecho.length * multiplicador + 3000, 12000);

            await delay(tempoBase);
            // Salva no banco ANTES de enviar: se o job retentar, o anti-loop de 3 msgs bloqueia reenvio
            await db.saveMessage(lead.whatsapp_id, 'assistant', trecho, instanceId);
            const enviado = await enviarMensagemIA(sock, remoteJid, { text: trecho }, instanceId);

            if (enviado) {
                console.log(`✅ [ENVIO ${i + 1}/${mensagensSplit.length}] [${cacheRegrasInstancia.get(instanceId)?.dados?.name || instanceId.slice(0,8)} → ${lead.name}] Balão entregue: "${trecho.substring(0, 80)}..."`);

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
    if (!fromMe) ultimoInboundAt.set(instanceId, Date.now()); // painel de saúde: última msg recebida
    
    // --- 🛡️ NORMALIZAÇÃO UNIVERSAL (JID vs LID) ---
    const idPuro = remoteJid.split(':')[0].split('@')[0];
    const dominio = remoteJid.includes('@lid') ? '@lid' : '@s.whatsapp.net';
    const cleanJid = idPuro + dominio;

  // ========================================================================
// 🌟 TÓPICO 1: FILTRO ANTI-FANTASMA E TRADUTOR DE LID (VIA BANCO DE DADOS)
// ========================================================================
// 1. Busca normal pelo JID — sempre filtrada pela instância que recebeu a mensagem
let { data: lead } = await supabase.from('leads').select('*').eq('whatsapp_id', cleanJid).eq('instance_id', instanceId).maybeSingle();

// Identificador que vamos gravar no lead novo (se precisar criar). Por padrão é o cleanJid;
// no caso @lid pode virar o número real quando o WhatsApp deixa vazar, ou o próprio @lid.
let jidParaSalvar = cleanJid;
let lidAssociado = null;

// 2. Se for um fantasma (@lid), tenta amarrar a um lead já salvo (por lid, msg citada ou nº vazado).
if (!lead && cleanJid.includes('@lid')) {
    console.log(`⚠️ [LID SOLTO] Mensagem de ${cleanJid}. Buscando no banco de dados...`);
    const { data: leadLid } = await supabase.from('leads').select('*').eq('whatsapp_lid', cleanJid).eq('instance_id', instanceId).maybeSingle();

    if (leadLid) {
        console.log(`✅ [ARIADNE INFALÍVEL] O banco dedurou: É a ${leadLid.name}`);
        lead = leadLid;

    } else {
        // 🚨 TENTATIVA DE RESGATE DE EMERGÊNCIA (O XEQUE-MATE) 🚨
        // 👇 AQUI ESTÁ A MÁGICA: Ele vai olhar no remoteJidAlt que descobrimos!
        const realJidRescue = msg.key.remoteJidAlt || msg.key.participant || msg.message?.extendedTextMessage?.contextInfo?.participant;
        const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;

        let originalLead = null;
        let cleanRescue = null;

        // 🥷 RESGATE NINJA 1: Ele citou a nossa mensagem?
        if (quotedMsgId && mapaRastreioLID.has(quotedMsgId)) {
            const memoryJid = mapaRastreioLID.get(quotedMsgId);
            console.log(`🥷 [RESGATE NINJA 1] Lead descoberto através da mensagem citada!`);
            const { data } = await supabase.from('leads').select('*').eq('whatsapp_id', memoryJid).eq('instance_id', instanceId).maybeSingle();
            originalLead = data;
        }

        // 🥷 RESGATE NINJA 2: O WhatsApp mandou o número oculto no remoteJidAlt?
        if (realJidRescue) {
            cleanRescue = realJidRescue.split(':')[0].split('@')[0] + '@s.whatsapp.net';
            if (!originalLead) {
                console.log(`🥷 [RESGATE NINJA 2] Analisando bolso secreto da Meta: ${cleanRescue}`);
                const { data } = await supabase.from('leads').select('*').eq('whatsapp_id', cleanRescue).eq('instance_id', instanceId).maybeSingle();
                originalLead = data;
            }
        }

        if (originalLead) {
            console.log(`✅ [RESGATE BEM-SUCEDIDO] Identidade revelada: ${originalLead.name}. Salvando LID no banco!`);
            await supabase.from('leads').update({ whatsapp_lid: cleanJid }).eq('id', originalLead.id);
            lead = originalLead;
        } else {
            // 🚪 PORTA ABERTA (funil email→WhatsApp): número novo, fora da base, chegou via @lid.
            // Antes a gente ABORTAVA (BLINDAGEM TOTAL — só falávamos com quem já estava salvo).
            // Agora esses são leads legítimos do funil receptivo: seguimos pra criação de inbound
            // orgânico abaixo. Se o WhatsApp vazou o número real, usamos ele; senão, o próprio @lid.
            jidParaSalvar = cleanRescue || cleanJid;
            lidAssociado = cleanJid;
            console.log(`🚪 [LID NOVO] Contato fora da base via @lid — seguindo como inbound (${jidParaSalvar}).`);
        }
    }
}

// 3. Ainda sem lead? Número novo (JID normal fora da base OU @lid não-amarrado acima).
//    Chips inbound_only acolhem: cria o lead na hora e injeta na esteira (funil receptivo).
if (!lead) {
    const instanceDataInbound = await getRegrasEmCache(instanceId);
    if (!instanceDataInbound?.inbound_only) {
        return; // Chip não-receptivo: mantém o padrão de só falar com quem está na base.
    }

    console.log(`📥 [INBOUND ORGÂNICO] Chip inbound-only recebeu contato novo de ${jidParaSalvar}. Criando lead.`);
    const userIdInbound = instanceDataInbound.user_id;
    const { data: leadCriado, error: erroLeadOrganico } = await supabase
        .from('leads')
        .insert({
            whatsapp_id: jidParaSalvar,
            whatsapp_lid: lidAssociado,
            instance_id: instanceId,
            user_id: userIdInbound,
            name: msg.pushName || 'Contato Orgânico',
            dono: extrairNomeHumano(msg.pushName) || null,
            origin: 'inbound_organic',
            status: 'contact',
            first_touch_channel: 'inbound', // lead recém-criado — sempre primeiro toque
            first_touch_at: new Date().toISOString(),
        })
        .select('*')
        .single();

    if (erroLeadOrganico || !leadCriado) {
        console.error(`❌ [INBOUND ORGÂNICO] Falha ao criar lead para ${jidParaSalvar}:`, erroLeadOrganico?.message);
        return;
    }
    lead = leadCriado;
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

    // 🗣️ CORREÇÃO DE NOME EM TEMPO REAL: se o lead DECLARA o próprio nome na conversa
    // ("meu nome é Carlos", "aqui é o João"), isso é alta confiança e SOBRESCREVE o dono atual
    // (a pessoa falando o próprio nome vence Receita/pushName). O card reflete no próximo fetch.
    if (!fromMe && texto) {
        const nomeDeclarado = extrairNomeDeclarado(texto);
        if (nomeDeclarado && nomeDeclarado !== lead.dono) {
            console.log(`👤 [IDENTIDADE-CHAT] Lead se identificou: "${nomeDeclarado}" (era "${lead.dono || '—'}"). Atualizando.`);
            lead.dono = nomeDeclarado; // memória viva — a IA já usa neste ciclo
            supabase.from('leads')
                .update({ dono: nomeDeclarado })
                .eq('id', lead.id)
                .then(() => {})
                .catch(e => console.error("Erro ao salvar nome declarado:", e.message));
        }
    }

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
        // 🧠 Salva como 'human_operator' (≠ 'assistant') para a IA saber que foi um humano
        await db.saveMessage(lead.whatsapp_id, 'human_operator', texto, instanceId);
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

        // 🛑 OPT-OUT (LGPD): honrado ANTES de qualquer outra lógica, mesmo se o lead estiver pausado.
        // Adiciona à blacklist (primeiro caminho de escrita real dessa tabela) e encerra o lead.
        if (OPTOUT_REGEX.test(texto)) {
            console.log(`🛑 [OPT-OUT] ${lead.name} pediu para não ser mais contatado: "${texto.substring(0, 60)}"`);
            await db.adicionarBlacklist(lead.whatsapp_id, `opt-out do lead: "${texto.substring(0, 80)}"`);
            await supabase.from('leads').update({
                status: 'blacklisted',
                is_paused: true,
                internal_notes: `Opt-out (LGPD) detectado em ${new Date().toLocaleString('pt-BR')}: "${texto.substring(0, 80)}"`
            }).eq('id', lead.id);
            await db.saveMessage(lead.whatsapp_id, 'user', `[OPT-OUT] ${texto}`, instanceId);
            await enviarAlerta(`🛑 *Opt-out solicitado*\n*Lead:* ${lead.name}\n*Chip:* ${instanceId}\nNúmero adicionado à blacklist automaticamente.`).catch(() => {});
            return;
        }

        if (lead.is_paused) {
            console.log(`⏸️ [TRAVA HUMANA] A IA ignorou ${lead.name} porque o lead está pausado no banco (is_paused = true).`);
            return;
        }

        // 🧟 GUARD: flood de mensagens idênticas antes do is_paused propagar no banco
        // Usa lead.whatsapp_id (JID limpo) — remoteJid pode ter ":11" (multi-device) que
        // não existe na tabela messages, causando 0 resultados e loop infinito.
        if (await verificarLoopZumbi(lead.whatsapp_id, instanceId, texto)) {
            console.log(`🧟 [LOOP ZUMBI] Flood detectado para ${lead.name}. Pausando e alertando.`);
            await supabase.from('leads').update({
                is_paused: true,
                internal_notes: `Loop zumbi em ${new Date().toLocaleString('pt-BR')}: "${texto.substring(0, 80)}"`
            }).eq('id', lead.id);
            await enviarAlerta(`🧟 *Loop Zumbi* detectado\n*Lead:* ${lead.name}\n*Chip:* ${instanceId}\nLead pausado automaticamente.`);
            return;
        }

        const intencao = analisarIntencaoRegex(texto);
        console.log(`🎯 [Filtro] A IA classificou a mensagem de ${lead.name} como: ${intencao}`);

        if (intencao === "[ROBO]") {
            // 🎯 4 STRIKES: só pausa de verdade na 4ª mensagem com padrão estrutural de autoresposta
            // (menu numerado, "protocolo nº", "transferindo pra atendente"...). Antes pausava na 1ª
            // detecção — falso positivo isolado matava a conversa pra sempre sem ninguém perceber.
            await db.saveMessage(lead.whatsapp_id, 'user', `[AUTORESPOSTA] ${texto}`, instanceId);
            const histParaRobo = await db.getHistory(lead.whatsapp_id, instanceId);
            const totalAutorespostas = histParaRobo.filter(m => m.role === 'user' && m.content.startsWith('[AUTORESPOSTA]')).length;

            if (totalAutorespostas >= 4) {
                console.log(`🤖 [SILÊNCIO] ${totalAutorespostas}ª autoresposta estrutural detectada para ${lead.name}. Pausando.`);
                await supabase.from('leads').update({
                    is_paused: true,
                    internal_notes: `${totalAutorespostas} autorespostas estruturais detectadas até ${new Date().toLocaleString('pt-BR')}. Pausado.`
                }).eq('id', lead.id);
                await enviarAlerta(`🤖 *Bot confirmado (${totalAutorespostas}x)*\n*Lead:* ${lead.name}\n*Chip:* ${instanceId}\nPausado automaticamente após 4 strikes.`);
            } else {
                console.log(`⚠️ [SUSPEITA ROBO ${totalAutorespostas}/4] Padrão estrutural de autoresposta para ${lead.name}. Ainda não atingiu o limiar — sem pausar, só sem responder esta mensagem.`);
            }
            return;
        }

        // 🧠 CAMADA 2: padrão histórico de bot (muitas msgs do SDR, zero sinal humano).
        // Só roda em chips OUTBOUND: nesse modo, quem "responde" pode ser uma autoresposta
        // disparada pelo nosso próprio contato inicial. Em chips inbound_only, o lead que nos
        // procura por conta própria não é acionado por nós — risco de bot automático é residual,
        // então essa camada estatística (mais propensa a falso positivo) fica desligada ali.
        // Chips B2C (bot_detection_enabled=false) não passam por esta camada — clientes de curso
        // respondem de forma natural mas sem vocabulário B2B (kWh, CNPJ, "nossa empresa")
        const instanceDataBot = await getRegrasEmCache(instanceId);
        const botDetectionAtivo = instanceDataBot?.bot_detection_enabled !== false && !instanceDataBot?.inbound_only;
        if (botDetectionAtivo) {
            const histParaBot = await db.getHistory(lead.whatsapp_id, instanceId);
            if (await avaliarRiscoRoboComHistorico(histParaBot)) {
                console.log(`🤖 [SILÊNCIO POR PADRÃO] Histórico indica bot para ${lead.name}. Pausando.`);
                await db.saveMessage(lead.whatsapp_id, 'user', `[SUSPEITA_BOT] ${texto}`, instanceId);
                await supabase.from('leads').update({ is_paused: true }).eq('id', lead.id);
                await enviarAlerta(`🤖 *Bot por Padrão Histórico*\n*Lead:* ${lead.name}\n*Chip:* ${instanceId}\nSDR enviou várias msgs sem resposta humana. Lead pausado.`);
                return;
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
            const limiteMáximo = 15 * 1024 * 1024; // 15MB em bytes

            if (fileSize > limiteMáximo) {
                console.log(`⚠️ [BARREIRA] Arquivo de ${lead.name} é muito grande (${(fileSize / 1024 / 1024).toFixed(2)}MB). Abortando download.`);
                
                if (!lead.is_paused) {
                    const msgErroCarga = "Opa, meu sistema não conseguiu carregar esse arquivo por causa do tamanho rs. Consegue me mandar um print da primeira página da fatura? Fica mais fácil de eu ler aqui.";
                    await baileysTransport.enviar(sock, remoteJid, { text: msgErroCarga });
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

                const _pdfRaw = await chamarLLM({
                    messages: [{ role: 'user', content: promptPDF }],
                    model: MODELOS.rapido,
                    maxTokens: 300,
                });
                const match = (_pdfRaw || '').match(/\{[\s\S]*\}/);
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
                    await baileysTransport.enviar(sock, remoteJid, { text: estudo });
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
                            await baileysTransport.enviar(sock, remoteJid, { text: msgFoto });
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
            if (intencaoDespertador === "[HUMANO]" && detectarSinalHumano(texto) && !lead.manual_pause) {
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
            await db.saveMessage(lead.whatsapp_id, 'user', texto, instanceId, lead.user_id);
        }
        // 2. Atualiza last_contact_at + temperatura do lead
        // last_contact_at aqui garante que o War Room re-ordena quando o lead responde
        const atualizacaoLead = { last_contact_at: new Date().toISOString() };
        if (lead.lead_temperature === 'cold' || !lead.lead_temperature) {
            atualizacaoLead.lead_temperature = 'warm';
        }
        await supabase.from('leads').update(atualizacaoLead).eq('id', lead.id);

        // 3. JOGA NA FILA DO REDIS — priority:1 garante que inbound sempre fura a fila do outbound
        inboundAtivo.set(instanceId, (inboundAtivo.get(instanceId) || 0) + 1);
        await filaMensagensIA.add('gerar_resposta', {
            leadId: lead.id,
            whatsappId: lead.whatsapp_id,
            instanceId: instanceId,
            remoteJid: remoteJid
        }, {
            priority: 1,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true
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

// Detecta erros do Baileys que indicam número inexistente no WhatsApp.
// Retorna true para 404/item-not-found; false para erros de rede/socket (que devem ser relançados).
function isNumeroInexistente(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.output?.statusCode || err?.statusCode || 0;
    return (
        code === 404 ||
        msg.includes('item-not-found') ||
        msg.includes('not-authorized') ||
        msg.includes('no such contact') ||
        msg.includes('invalid jid') ||
        (msg.includes('bad-request') && msg.includes('jid'))
    );
}

// Gera um resumo executivo de até 2 frases para o consultor que vai assumir o chat.
async function gerarResumoHandoff(historicoRecente) {
    try {
        const msgs = (historicoRecente || []).slice(-12)
            .map(m => `${m.role === 'user' ? 'Lead' : 'IA'}: ${m.content}`)
            .join('\n');
        const res = await chamarLLM({
            messages: [{ role: 'user', content: `Analise o histórico de conversa de energia solar abaixo e gere um resumo executivo de no máximo 2 frases para o consultor humano assumir o chat. Foque em: 1. Perfil do negócio (o que é, porte), 2. Dor/Dados coletados (valor da conta se houver), 3. Motivo do travamento/handoff. Seja direto, sem introduções.\n\n${msgs}` }],
            model: MODELOS.rapido,
            maxTokens: 100,
        });
        return (res || '').trim() || 'Resumo indisponível.';
    } catch (err) {
        console.error('[HANDOFF] Erro ao gerar resumo:', err.message);
        return 'Resumo indisponível.';
    }
}

// Dispara Socket.io + Discord sempre que um lead entrar em handoff humano.
async function emitirEventoHandoff(lead, motivo, historico) {
    console.log(`📥 [HANDOFF] Disparando resumo e alerta para o lead ${lead.name}`);
    const resumoIA = await gerarResumoHandoff(historico);
    if (ioSocket) {
        ioSocket.emit('handoff_detected', {
            leadId:     lead.id,
            name:       lead.name,
            business:   lead.name,
            niche:      lead.niche  || '—',
            reason:     motivo,
            resumoIA,
            instanceId: lead.instance_id,
            pausadoEm:  new Date().toISOString(),
        });
    }
    await alertaHandoff({
        leadId:    lead.id,
        leadName:  lead.dono || lead.name,
        empresa:   lead.name,
        niche:     lead.niche || '—',
        motivo,
        resumoIA,
        instanceId: lead.instance_id,
    });
}

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
        let currentLead = null;  // espelho de lead acessível no errInner catch
        let chipNovo = false; // declarado aqui para ser acessível no catch interno
            
            if (isBaseVazia(instanceId)) {
                setBaseVazia(instanceId, false);
                console.log(`✨ [FALLBACK] Base voltou a ter leads para ${instanceId.slice(0,8)}. Modo SAUDAÇÃO retomado.`);
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
                    const sessaoMem = sessions.get(instanceId);
                    console.log(`🔕 [MOTOR SILENCIADO] Chip ${instanceId} ignorado. DB="${instanceData?.whatsapp_status}" | mem.ready=${sessaoMem?.ready} | mem.ws=${sessaoMem?.sock?.ws?.isOpen} — ${sessaoMem?.ready ? 'cache desatualizado (DB atrás da memória)' : 'chip genuinamente offline'}`);
                    break; // 🛑 HÍBRIDO: Morre aqui se não estiver conectado
                }

                if (instanceData.firing_paused) {
                    console.log(`⏸️ [PAUSADO MANUAL] Chip ${instanceData.name || instanceId.slice(0,8)} está pausado pelo operador. Motor inativo até ser retomado.`);
                    break; // Motor para; o VIGIA não reinicia enquanto firing_paused=true
                }

                if (instanceData.inbound_only) {
                    console.log(`[CHIP INBOUND-ONLY] ignorando fila de ataque.`);
                    break; // Chip só responde ao que chegar organicamente — motor não prospecta
                }

                console.log(`⚡ [MOTOR ATIVO] Chip ${instanceData.name || instanceId.slice(0,8)} — status CONNECTED confirmado, iniciando ciclo de disparo`);

                chipNovo = isChipNovo(instanceData);
                const limiteAdaptativo = calcularLimiteDiario(instanceData);
                const idadeDias = instanceData?.created_at
                    ? Math.floor((Date.now() - new Date(instanceData.created_at).getTime()) / 86400000)
                    : 999;
                if (chipNovo) console.log(`🌱 [WARMUP] ${instanceData.name} — dia ${idadeDias} de vida, limite: ${limiteAdaptativo} disparos/dia.`);
                const config = {
                    nome: instanceData.name || `Chip-${instanceId.substring(0, 4)}`,
                    limite: limiteAdaptativo,
                    agente: instanceData.agent_name || "Agente",
                    empresa: instanceData.company_name || "nossa empresa"
                };

                // ☕ MICRO-PAUSA INTRADIÁRIA — janela de descanso deste chip
                const pausaAtiva = verificarPausaIntradiaria(instanceId);
                if (pausaAtiva) {
                    const { horas: hP, minutos: mP } = getHoraBrasil();
                    const tAtual = hP * 60 + mP;
                    const msRestantes = Math.min((pausaAtiva.fim - tAtual) * 60000 + 30000, 60 * 60000);
                    const fimFmt = `${Math.floor(pausaAtiva.fim / 60)}h${String(pausaAtiva.fim % 60).padStart(2, '0')}`;
                    console.log(`☕ [MICRO-PAUSA] ${config.nome} descansando até ${fimFmt} (${Math.round(msRestantes / 60000)}min). Anti-ban ativo.`);
                    await delay(msRestantes);
                    continue;
                }

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
currentLead = lead;

console.log(`🔒 [RESERVA] Lead ${lead.name} travado atomicamente para chip ${config.nome}`);

                // 🛡️ 2. TRAVA NA MEMÓRIA
                if (leadsEmProcessamento.has(lead.id)) {
                    console.log(`🔐 [TRAVA-LEAD] Lead "${lead.name}" já está em processamento por outro ciclo. Aguardando 5s...`);
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

                // 📧 4b. CANAL OUTBOUND — chips com use_email_outbound pulam o WhatsApp inteiramente
                if (instanceData.use_email_outbound) {
                    // 🧪 DRY-RUN: loga a decisão de canal sem gerar copy nem consumir orçamento —
                    // não toca status do lead, não chama Resend/Groq. Serve pra testar mudança de
                    // canal em leads reais sem risco.
                    if (instanceData.dry_run) {
                        console.log(`🧪 [DRY-RUN] Chip ${instanceData.name || instanceId.slice(0,8)} enviaria EMAIL para ${lead.name} (${lead.email || 'SEM EMAIL — cairia em no_email'}). Nenhum envio real ocorreu.`);
                        leadsEmProcessamento.delete(lead.id);
                        continue;
                    }
                    if (lead.email) {
                        // 💸 GUARDRAIL: teto diário AGREGADO de emails por conta (não só por chip).
                        // DAILY_EMAIL_BUDGET=0 (ou ausente) → sem teto, comportamento atual preservado.
                        const limiteEmail = parseInt(process.env.DAILY_EMAIL_BUDGET) || 0;
                        const userIdChip = instanceData.user_id;
                        if (limiteEmail > 0 && !(await budgetGuard.podeGastar(userIdChip, 'email', limiteEmail))) {
                            console.log(`💸 [BUDGET] Conta ${String(userIdChip).slice(0,8)} atingiu o teto de ${limiteEmail} emails/dia. Parando envios de email deste chip.`);
                            // Libera o lead de volta pra fila (estava 'reservado') e desliga o motor deste chip.
                            await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id).eq('status', 'reservado');
                            leadsEmProcessamento.delete(lead.id);
                            break;
                        }
                        const resultadoEmail = await emailService.enviarEmailOutbound(lead, instanceData);
                        if (resultadoEmail.success) {
                            await budgetGuard.registrarGasto(userIdChip, 'email', limiteEmail);
                            // 🎯 first_touch_channel: campo IMUTÁVEL — guard de null evita sobrescrever
                            // se o lead já tinha um canal de origem anterior (ex.: redistribuição).
                            const _ftcEmail = !lead.first_touch_channel ? { first_touch_channel: 'email', first_touch_at: new Date() } : {};
                            await supabase.from('leads').update({ status: 'email_sent', last_contact_at: new Date(), ..._ftcEmail }).eq('id', lead.id);
                            console.log(`📧 [EMAIL OUTBOUND] ${lead.name} → email enviado, pulando WhatsApp.`);
                        } else {
                            console.error(`❌ [EMAIL OUTBOUND] Falha ao enviar para ${lead.name}: ${resultadoEmail.error}`);
                            // 'Email suprimido' não é falha transitória — não reprocessar em loop.
                            const novoStatus = resultadoEmail.error === 'Email suprimido' ? 'blacklisted' : 'new';
                            await supabase.from('leads').update({ status: novoStatus }).eq('id', lead.id);
                        }
                    } else {
                        await supabase.from('leads').update({ status: 'no_email' }).eq('id', lead.id);
                        console.log(`⚠️ [EMAIL OUTBOUND] ${lead.name} sem email cadastrado. Marcado como no_email.`);
                    }
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
                // 👻 GHOST SESSION: ready=true mas WebSocket TCP morto (sem 'close' event)
                // sock.ws é um WebSocketClient (wrapper do Baileys) — usa .isOpen, não .readyState
                if (!instancia.sock?.ws?.isOpen) {
                    console.log(`👻 [GHOST SESSION] ${config.nome} — WebSocket morto (isOpen: ${instancia.sock?.ws?.isOpen}). Forçando reconexão.`);
                    sessions.set(instanceId, { sock: instancia.sock, ready: false, userId: instancia.userId });
                    await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                    leadsEmProcessamento.delete(lead.id);
                    break;
                }

                const hist = await db.getHistory(lead.whatsapp_id, instanceId);

                // 1. O número já foi contatado antes?
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

                // 6b. JID cache: número confirmado inválido nesta sessão → skip sem jitter
                const preCheckJid = lead.whatsapp_id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                if (jidsInvalidos.has(preCheckJid)) {
                    console.log(`🚫 [JID-CACHE] ${lead.name} (${preCheckJid}) já confirmado inválido nesta sessão. Descartando sem jitter.`);
                    await supabase.from('leads').update({ status: 'invalid', internal_notes: `Número inválido (JID-CACHE: confirmado sem WhatsApp nesta sessão) em ${new Date().toLocaleString('pt-BR')}` }).eq('id', lead.id);
                    leadsEmProcessamento.delete(lead.id);
                    continue;
                }

                // ⏳ 6. JITTER SEQUENCIAL — cold-start uma única vez por dia; chip novo já aquecido usa jitter curto
                const isStaleRetry = staleRetryFlag.get(instanceId) === true;
                if (isStaleRetry) staleRetryFlag.delete(instanceId);
                const isColdStart = !isStaleRetry && chipNovo && enviosHoje === 0 && !global.chipsAquecidosHoje.has(instanceId);
                const jitter = isStaleRetry
                    ? Math.random() * 30000 + 15000     // retry pós-stale: 15-45s (chip já provou conectividade)
                    : isColdStart
                        ? Math.random() * 300000 + 300000   // cold-start: 5-10 min (uma vez por dia)
                        : chipNovo
                            ? Math.random() * 120000 + 60000   // chip novo aquecido: 1-3 min
                            : Math.random() * 180000 + 120000; // maduro: 2-5 min
                console.log(`🎯 [${config.nome}] Mirando em: ${lead.name} (${enviosHoje + 1}/${config.limite}). Aguardando ${Math.round(jitter/1000)}s${isColdStart ? " (cold-start)" : isStaleRetry ? " (stale-retry)" : ""}...`);

                // ⚡ FAST-LANE CHECK 1: antes de entrar no jitter, verifica se chegou inbound neste chip
                // Se sim, devolve o lead e cede a via — chip responde primeiro, prospeta depois
                if (inboundAtivo.has(instanceId)) {
                    console.log(`⚡ [FAST-LANE] ${config.nome} tem inbound pendente. Devolvendo ${lead.name} à fila e aguardando 10s.`);
                    leadsEmProcessamento.delete(lead.id);
                    await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                    await delay(10000);
                    continue;
                }

                await delay(jitter);
                if (isColdStart) global.chipsAquecidosHoje.add(instanceId);

                // 7. Normalização do JID + pre-check onWhatsApp
                let cleanJid = lead.whatsapp_id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
                if (lead.whatsapp_id !== cleanJid) {
                    await supabase.from('leads').update({ whatsapp_id: cleanJid }).eq('id', lead.id);
                    lead.whatsapp_id = cleanJid;
                }

                // Verifica existência no WA antes de enviar — evita queimar quality rating com JIDs inválidos.
                if (!jidsInvalidos.has(cleanJid)) {
                    try {
                        const [waStat] = await instancia.sock.onWhatsApp(cleanJid.replace('@s.whatsapp.net', ''));
                        if (!waStat?.exists) {
                            console.warn(`⚠️ [PRE-CHECK WA] ${lead.name} não está no WhatsApp. Descartando.`);
                            await supabase.from('leads').update({ status: 'invalid', internal_notes: `Número inválido (PRE-CHECK WA: onWhatsApp retornou inexistente) em ${new Date().toLocaleString('pt-BR')}` }).eq('id', lead.id).eq('status', 'reservado');
                            leadsEmProcessamento.delete(lead.id);
                            jidsInvalidos.add(cleanJid);
                            liberarSemaforoSemCooldown(instanceId);
                            continue;
                        }
                        // JID canônico do WA resolve automaticamente o formato 12↔13 dígitos
                        if (waStat.jid && waStat.jid !== cleanJid) {
                            console.log(`🔧 [PRE-CHECK WA] Formato corrigido: ${cleanJid.replace('@s.whatsapp.net','')} → ${waStat.jid.replace('@s.whatsapp.net','')}`);
                            await supabase.from('leads').update({ whatsapp_id: waStat.jid }).eq('id', lead.id);
                            lead.whatsapp_id = waStat.jid;
                            cleanJid = waStat.jid;
                        }
                    } catch (errWa) {
                        console.warn(`⚠️ [PRE-CHECK WA] Falha na verificação para ${lead.name}: ${errWa.message}. Prosseguindo.`);
                    }
                }

              // 8. MONTAGEM DA SAUDAÇÃO — BALÃO ÚNICO (FIX #1 + #2 + #10)
              
              // ⚡ FAST-LANE CHECK 2: segundo checkpoint antes do semáforo — inbound tem precedência absoluta
              if (inboundAtivo.has(instanceId)) {
                  console.log(`⚡ [FAST-LANE] ${config.nome} tem inbound ativo. Abortando disparo frio de ${lead.name} e cedendo por 5s.`);
                  leadsEmProcessamento.delete(lead.id);
                  await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                  await delay(5000);
                  continue;
              }

              // 🚦 SEMÁFORO: Saudação tem PRIORIDADE 1 — toma vaga de qualquer follow-up rodando
              const semaforoOk = await adquirirSemaforoChip(instanceId, 'SAUDACAO');
              if (!semaforoOk) {
                  // Calcula o tempo real restante de cooldown para não reutilizar o mesmo lead em loop
                  const _sem = semaforoChips.get(instanceId);
                  const _elapsed = _sem?.ultimoDisparo ? Date.now() - _sem.ultimoDisparo : 0;
                  const _restante = _sem?.cooldownMs ? Math.max(5000, _sem.cooldownMs - _elapsed) : 60000;
                  console.log(`⏸️ [SAUDACAO] Chip ${config.nome} em cooldown. Devolvendo ${lead.name} e aguardando ${Math.round(_restante/1000)}s reais...`);
                  leadsEmProcessamento.delete(lead.id);
                  await supabase.from('leads').update({ status: 'new' }).eq('id', lead.id);
                  await delay(_restante + 2000);
                  continue;
              }

console.log(`🚀 [DISPARANDO] ${config.nome} enviando saudação para ${lead.name}...`);
await instancia.sock.sendPresenceUpdate('available', cleanJid);
await delay(1000 + Math.random() * 2000);
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

// Persona do CHIP (quem está disparando): nome do agente e nome da nossa empresa.
// Antes o nome ficava hardcoded no template (ex.: "Lorena") e não trocava ao editar o nome do
// chip. Agora o template usa ${nomeAgente}/${nomeMinhaEmpresa} e resolve pelo instances.agent_name.
const nomeAgente = instanceData?.agent_name || 'nossa equipe';
const nomeMinhaEmpresa = instanceData?.company_name || 'nossa empresa';

// Substitui variáveis nos templates vindos do Supabase
const substituirVarsAbertura = (tpl) => resolverSpintax(tpl
    .replace(/\[Nome\]/gi, primeiroNomeDono || 'você') // alias legado — aceita [Nome] além de ${nomeDono}
    .replace(/\$\{saudacao\}/g, saudacao)
    .replace(/\$\{nomeAgente\}/g, nomeAgente)
    .replace(/\$\{nomeMinhaEmpresa\}/g, nomeMinhaEmpresa)
    .replace(/\$\{nomeDono\}/g, primeiroNomeDono || 'você')
    .replace(/\$\{nomeEmpresa\}/g, nomeEmpresa)
    .replace(/\$\{concessionariaLocal\}/g, concessionariaLocal)
    .replace(/\$\{bairroLead\}/g, bairroLead)
    .replace(/\$\{origem\}/g, lead.origin_company_name || '')
    .replace(/\s*--\s*/g, ', ') // remove em-dash do template antes de enviar
    .trim());

// ── ABERTURA: cache → REPASSE → LLM → spintax ──────────────────────────
const tplsInstancia = instanceData?.opening_templates;
let textoFinal;

if (lead.opening_template && lead.opening_template.length > 15 && lead.opening_template.includes(' ')) {
    // PASSO 1: Cache hit — reutiliza abertura original (redistribuição de chip)
    textoFinal = lead.opening_template;
    console.log(`💾 [OPENER] Cache hit para ${lead.name}.`);
} else if (tplsInstancia && Array.isArray(tplsInstancia.decisor) && lead.is_decisor && lead.origin_company_name) {
    // PASSO 2a: Decisor com template customizado no Supabase
    const vars = tplsInstancia.decisor.map(substituirVarsAbertura);
    textoFinal = vars[Math.floor(Math.random() * vars.length)];
} else if (lead.is_decisor && lead.origin_company_name) {
    // PASSO 2b: Decisor sem template — hardcoded com contexto de repasse
    const fallbacks = tplsInstancia && Array.isArray(tplsInstancia.decisor_fallback)
        ? tplsInstancia.decisor_fallback.map(substituirVarsAbertura)
        : [
            `${saudacao}, o pessoal da ${lead.origin_company_name} me passou seu contato. Tenho uma informação que achei que valia compartilhar — vc que cuida da parte comercial/financeira aí?`,
            `${saudacao}, falei com a equipe da ${lead.origin_company_name} e me indicaram vc. Queria confirmar uma coisa rápida — é vc que responde por essa área?`,
          ];
    textoFinal = fallbacks[Math.floor(Math.random() * fallbacks.length)];
} else {
    // PASSO 3: Spintax padrao tem PRIORIDADE — LLM só é acionado se não houver template configurado
    const tplsPadrao = (tplsInstancia && Array.isArray(tplsInstancia.padrao) && tplsInstancia.padrao.length > 0)
        ? tplsInstancia.padrao.map(substituirVarsAbertura)
        : null;

    if (tplsPadrao) {
        textoFinal = tplsPadrao[Math.floor(Math.random() * tplsPadrao.length)];
        console.log(`📋 [SPINTAX] Abertura via template para ${lead.name}: "${textoFinal}"`);
    } else {
        // Sem template padrao configurado: usa LLM com fallbacks hardcoded
        // isSolar: mesma expressão usada em resolverPromptCompleto (linha ~1071) — tenants
        // fora do nicho solar não podem herdar vocabulário de "conta de energia/luz" aqui.
        const isSolarFallback = !instanceData?.product_type || instanceData.product_type === 'solar';
        const spintaxFallback = isSolarFallback ? [
            `${saudacao}, vi algo sobre a conta de energia da ${nomeEmpresa} que achei que valia te passar. Vc cuida dessa parte de contas fixas aí?`,
            `${saudacao}, dei uma olhada no cadastro da ${nomeEmpresa} e tem uma coisa sobre a conta de luz da ${concessionariaLocal} que achei que valia te avisar. Tô falando com quem cuida disso?`,
            `${saudacao}, mapeamos empresas da região que podem estar pagando a mais na ${concessionariaLocal}. A ${nomeEmpresa} apareceu na lista. Vc é quem cuida dessa parte?`
        ] : [
            `${saudacao}, vi algo sobre a ${nomeEmpresa} que achei que valia te passar. Vc cuida dessa parte de contas fixas aí?`,
            `${saudacao}, dei uma olhada no cadastro da ${nomeEmpresa} e tem uma coisa que achei que valia te avisar. Tô falando com quem cuida disso?`,
            `${saudacao}, mapeamos empresas da região com uma oportunidade parecida. A ${nomeEmpresa} apareceu na lista. Vc é quem cuida dessa parte?`
        ];

        try {
            const capitalDesc = !lead.capital_social_numeric ? 'não informado'
                : lead.capital_social_numeric >= 500000 ? 'grande (R$ 500k+)'
                : lead.capital_social_numeric >= 150000 ? 'médio (R$ 150k-500k)'
                : 'pequeno (< R$ 150k)';
            const descontoEstimado = MAPA_DESCONTO_REGIONAL[ufLead] ? `${Math.round(MAPA_DESCONTO_REGIONAL[ufLead] * 100)}` : '12-18';
            const nicheCtx = gerarContextoNicho(lead.niche || '');

            // Prompt LLM: lido do Supabase (opening_templates.llm_prompt) — editável por tenant sem deploy.
            // Variáveis disponíveis: ${nomeEmpresa}, ${nomeDono}, ${nicho},
            // ${bairroLead}, ${concessionariaLocal}, ${capitalDesc}, ${descontoEstimado}, ${nicheCtx}
            const _llmTpl = tplsInstancia?.llm_prompt ||
                'Aja como um especialista em redução de custos operacionais. Crie uma ÚNICA mensagem curta de WhatsApp para iniciar conversa com o decisor da empresa alvo.\n\nEmpresa: ${nomeEmpresa}\nDono: ${nomeDono}\nBairro: ${bairroLead}\n\nRegras ABSOLUTAS:\n1. Inicie EXATAMENTE com: "Opa ${nomeDono}, tudo bem?" (ou "bom dia/boa tarde").\n2. NUNCA diga seu nome, não diga "sou eu", não diga de onde você é.\n3. Vá direto ao assunto: faça um comentário curto sobre a empresa no bairro ${bairroLead} e pergunte se ele é a pessoa que cuida dos custos fixos.\n4. Máximo de 20 palavras.\n5. SEM emojis, SEM mencionar energia solar.\nRetorne APENAS o texto da mensagem.';
            const llmPromptFinal = _llmTpl
                .replace(/\$\{nomeEmpresa\}/g,        nomeEmpresa)
                .replace(/\$\{nomeDono\}/g,            primeiroNomeDono || 'não identificado')
                .replace(/\$\{nicho\}/g,               lead.niche || 'comércio')
                .replace(/\$\{bairroLead\}/g,          bairroLead)
                .replace(/\$\{concessionariaLocal\}/g, concessionariaLocal)
                .replace(/\$\{capitalDesc\}/g,         capitalDesc)
                .replace(/\$\{descontoEstimado\}/g,    descontoEstimado)
                .replace(/\$\{nicheCtx\}/g,            nicheCtx ? '\nContexto do setor: ' + nicheCtx : '');
            const llmPromise = chamarLLM({
                messages: [{ role: 'user', content: llmPromptFinal }],
                model: MODELOS.rapido,
                maxTokens: 80,
            });
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 3500));
            const llmTexto = (await Promise.race([llmPromise, timeoutPromise]) || '').trim().replace(/^["'`]|["'`]$/g, '');
            if (llmTexto && llmTexto.length > 10) {
                textoFinal = llmTexto;
                console.log(`🧠 [LLM] Abertura gerada para ${lead.name}: "${textoFinal}"`);
            } else {
                throw new Error('texto vazio');
            }
        } catch (errLLM) {
            console.warn(`⚠️ [LLM TIMEOUT] Usando spintax para ${lead.name}: ${errLLM.message}`);
            textoFinal = spintaxFallback[Math.floor(Math.random() * spintaxFallback.length)];
        }
    }
}

const mensagensSplit = textoFinal.split('[QUEBRA]').map(t => t.trim()).filter(t => t.length > 0);

                // 🧪 DRY-RUN: loga o que seria enviado por WhatsApp sem enviar de fato — não toca
                // status do lead (fica 'reservado' até a varredura de startup liberá-lo, linha ~4407;
                // esperado em sessão de teste curta, não use dry_run em chip de produção contínua).
                if (instanceData.dry_run) {
                    console.log(`🧪 [DRY-RUN] Chip ${config.nome} enviaria WHATSAPP para ${lead.name} (${mensagensSplit.length} balão(ões)): "${textoFinal.substring(0, 120)}${textoFinal.length > 120 ? '...' : ''}"`);
                    leadsEmProcessamento.delete(lead.id);
                    liberarSemaforoChip(instanceId, chipNovo);
                    continue;
                }

                // 9. FATIADOR HUMANO E ENVIO (Com interrupção intacta!)
                // Sessão sem nenhum envio confirmado usa timeout ACK reduzido (20s):
                // WA server retorna ACK imediatamente se o número existe — 45s é tempo demais para stale.
                const timeoutAckEnvio = (sucessosPorSessao.get(instanceId) || 0) === 0 ? 20000 : 45000;

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

                    const sentMsg = await enviarMensagemIA(instancia.sock, cleanJid, { text: trecho }, instanceId, timeoutAckEnvio);
                    if (!sentMsg?.key?.id) {
                        throw new Error(`FALHA_SILENCIOSA: Envio sem confirmacao de key.id para ${cleanJid}`);
                    }
                    // Marca 'contact' logo após o 1º balão confirmado — se o socket cair antes do 2º,
                    // o lead já está marcado e não será reenviado na próxima rodada do motor.
                    if (i === 0) {
                        // 🎯 first_touch_channel: primeiro toque real deste lead (imutável, guard de null).
                        const _ftcWa = !lead.first_touch_channel
                            ? { first_touch_channel: instanceData.whatsapp_provider === 'official' ? 'whatsapp_oficial' : 'whatsapp', first_touch_at: new Date().toISOString() }
                            : {};
                        await supabase.from('leads').update({ status: 'contact', last_contact_at: new Date().toISOString(), opening_template: textoFinal, ..._ftcWa }).eq('id', lead.id);
                    }
                    await db.saveMessage(cleanJid, 'assistant', trecho, instanceId);

                    if (i < mensagensSplit.length - 1) {
                        await instancia.sock.sendPresenceUpdate('paused', cleanJid);
                        await delay(Math.random() * 2000 + 2500);
                    }
                }

                // 10. CONCLUSÃO E SUCESSO (cobre caso de break antecipado — lead respondeu antes do último chunk)
                await supabase.from('leads').update({ status: 'contact', last_contact_at: new Date().toISOString(), opening_template: textoFinal }).eq('id', lead.id);
                console.log(`✅ [SUCESSO REAL] Entregue por ${config.nome} para ${lead.name}!`);
                ultimoEnvioTimestamp.set(cleanJid, Date.now()); // base de tempo para detecção de autoresposta
                if (!primeiroEnvioSucesso.get(instanceId)) {
                    primeiroEnvioSucesso.set(instanceId, true);
                    console.log(`✅ [SESSION-FIRST-SUCCESS] Chip ${instanceId.slice(0,8)}: primeiro envio confirmado nessa sessão — fora da zona de risco de soft-ban`);
                }
                sucessosPorSessao.set(instanceId, (sucessosPorSessao.get(instanceId) || 0) + 1);
                staleContador.delete(instanceId); // envio confirmado — zera contador de falhas stale consecutivas
                leadsEmProcessamento.delete(lead.id);
                liberarSemaforoChip(instanceId, chipNovo); // 🚦 warmup=chipNovo → 6-10 min; maduro → 4-7 min
                falhasConsecutivas = 0;

            } catch (errInner) {
                // 🚫 ANTI-BAN: Número inexistente no WA — descarta lead SEM penalizar o chip
                // Nenhuma mensagem foi entregue → não reinicia cooldown, não conta no limite diário
                if (isNumeroInexistente(errInner)) {
                    if (currentLead) {
                        if (!currentLead.backup_tried && currentLead.backup_whatsapp_id) {
                            console.log(`🔄 [BACKUP] Tombando ${currentLead.name} para o número reserva...`);
                            await supabase.from('leads').update({
                                whatsapp_id: currentLead.backup_whatsapp_id,
                                phone: currentLead.backup_phone,
                                backup_tried: true,
                                status: 'new',
                            }).eq('id', currentLead.id);
                        } else {
                            console.log(`🚫 [INVÁLIDO] ${currentLead.name} (${currentLead.phone || currentLead.whatsapp_id}) sem WhatsApp. Descartando sem cooldown.`);
                            await supabase.from('leads').update({ status: 'invalid', internal_notes: `Número inválido (sem WhatsApp, descartado sem cooldown) em ${new Date().toLocaleString('pt-BR')}` }).eq('id', currentLead.id);
                            if (currentLead.whatsapp_id) jidsInvalidos.add(currentLead.whatsapp_id);
                        }
                        leadsEmProcessamento.delete(currentLead.id);
                        liberarSemaforoSemCooldown(instanceId); // ⚡ sem penalidade de tempo
                    }
                    continue; // próximo lead imediatamente
                }

                // 🔇 FALHA SILENCIOSA: Baileys sem key.id (número fantasma, socket degradado)
                // Não recoloca em 'new' para evitar loop eterno — descarta sem penalizar cooldown
                if (errInner.message?.includes('FALHA_SILENCIOSA')) {
                    console.warn(`⚠️ [FALHA SILENCIOSA] ${currentLead?.name} — sem confirmação de entrega. Descartando sem cooldown.`);
                    if (currentLead) {
                        await supabase.from('leads').update({ status: 'invalid', internal_notes: `Número inválido (FALHA SILENCIOSA: sem confirmação de entrega) em ${new Date().toLocaleString('pt-BR')}` }).eq('id', currentLead.id);
                        if (currentLead.whatsapp_id) jidsInvalidos.add(currentLead.whatsapp_id);
                        leadsEmProcessamento.delete(currentLead.id);
                        liberarSemaforoSemCooldown(instanceId); // ⚡ sem penalidade de tempo
                    }
                    continue;
                }

                // ⏱️ ACK_TIMEOUT: WA server não confirmou entrega em 15s.
                // BIFURCAÇÃO: distingue sessão stale real de falha isolada no lead.
                if (errInner.message?.includes('ACK_TIMEOUT')) {
                    const sucessosNestaSessao = sucessosPorSessao.get(instanceId) || 0;
                    console.warn(`🔬 [ACK-DIAG] ${instanceId.slice(0,8)} | sucessos=${sucessosNestaSessao} | stale=${staleContador.get(instanceId) || 0} | lead="${currentLead?.name}" | jid=${currentLead?.whatsapp_id}`);

                    if (sucessosNestaSessao > 0) {
                        // Sessão tem histórico de sucesso → problema é o lead específico (número sem WA,
                        // Signal keys incompatíveis, destinatário inacessível). NÃO destruir sessão.
                        // Tentamos primeiro o formato alternativo BR (12↔13 dígitos); só marcamos inválido
                        // se não houver alternativa — pois o chip é saudável e podemos confiar no diagnóstico.
                        if (currentLead) {
                            const jidAtual = currentLead.whatsapp_id || '';
                            const numPart = jidAtual.replace('@s.whatsapp.net', '');
                            let novoJid = null;
                            if (numPart.startsWith('55') && numPart.length === 13) {
                                novoJid = `55${numPart.slice(2, 4)}${numPart.slice(5)}@s.whatsapp.net`;
                            } else if (numPart.startsWith('55') && numPart.length === 12) {
                                novoJid = `55${numPart.slice(2, 4)}9${numPart.slice(4)}@s.whatsapp.net`;
                            }
                            if (novoJid && novoJid !== jidAtual) {
                                console.warn(`⚠️ [ACK TIMEOUT ISOLADO] ${instanceId} — sessão saudável. Lead ${currentLead.name}: tentando formato BR alternativo ${numPart} → ${novoJid.replace('@s.whatsapp.net','')}`);
                                await supabase.from('leads').update({ status: 'new', whatsapp_id: novoJid }).eq('id', currentLead.id).eq('status', 'reservado');
                            } else {
                                console.warn(`⚠️ [ACK TIMEOUT ISOLADO] ${instanceId} — sessão saudável (${sucessosNestaSessao} envios OK). Lead ${currentLead.name} descartado como inválido.`);
                                await supabase.from('leads').update({ status: 'invalid', internal_notes: `Número inválido (ACK TIMEOUT ISOLADO: sessão saudável, sem ACK deste lead) em ${new Date().toLocaleString('pt-BR')}` }).eq('id', currentLead.id);
                                if (currentLead.whatsapp_id) jidsInvalidos.add(currentLead.whatsapp_id);
                            }
                            leadsEmProcessamento.delete(currentLead.id);
                            liberarSemaforoSemCooldown(instanceId);
                        }
                        continue; // próximo lead, sessão intacta
                    }

                    // Sessão nunca validou um envio → pode ser proxy lento ou rate-limiting do WA.
                    // 1ª falha: soft restart (reinicia socket, preserva credenciais — evita wipe desnecessário).
                    // 2ª falha consecutiva: hard restart (wipe completo + novo QR).
                    const stalesFalhas = (staleContador.get(instanceId) || 0) + 1;
                    const _jaNovaSessao = !primeiroEnvioSucesso.get(instanceId);
                    if (_jaNovaSessao) {
                        console.warn(`🚨 [SOFT-BAN-SUSPEITA] Chip ${instanceId.slice(0,8)}: ACK_TIMEOUT antes do 1º envio confirmado — possível soft-ban no número ou IP do proxy. JID: ${currentLead?.whatsapp_id}`);
                    }
                    console.warn(`[ACK-FAIL-DETAIL] Chip ${instanceId.slice(0,8)}: falha ACK | JID=${currentLead?.whatsapp_id} | lead="${currentLead?.name}" | stale=${stalesFalhas} | primeiraSessão=${_jaNovaSessao}`);
                    staleContador.set(instanceId, stalesFalhas);

                    if (currentLead) {
                        const chaveLeadSessao = `${instanceId}:${currentLead.id}`;
                        const falhasEsteLead = (falhasLeadPorSessao.get(chaveLeadSessao) || 0) + 1;
                        falhasLeadPorSessao.set(chaveLeadSessao, falhasEsteLead);

                        if (falhasEsteLead >= 2) {
                            // Mesmo lead falhou 2x nesta sessão — quebra o loop marcando como inválido
                            console.warn(`🔁 [ACK-LOOP QUEBRADO] Lead "${currentLead.name}" causou ACK_TIMEOUT ${falhasEsteLead}x em ${instanceId.slice(0,8)} sem nenhum sucesso. Marcando inválido para evitar loop infinito.`);
                            await supabase.from('leads').update({ status: 'invalid', internal_notes: `Número inválido (ACK-LOOP QUEBRADO: 2 ACK_TIMEOUT no mesmo lead sem sucesso) em ${new Date().toLocaleString('pt-BR')}` }).eq('id', currentLead.id);
                            if (currentLead.whatsapp_id) jidsInvalidos.add(currentLead.whatsapp_id);
                            leadsEmProcessamento.delete(currentLead.id);
                            falhasLeadPorSessao.delete(chaveLeadSessao);
                            liberarSemaforoSemCooldown(instanceId);
                        } else {
                            // 1ª falha com chip stale (sucessos=0): NÃO trocamos o JID aqui porque
                            // não conseguimos distinguir "JID errado" de "chip sem conectividade".
                            // Troca de formato só ocorre no ACK TIMEOUT ISOLADO (chip saudável).
                            console.warn(`🔁 [ACK-LOOP] Lead "${currentLead.name}" falhou 1ª vez em ${instanceId.slice(0,8)} (stale). Retornando à fila sem alterar JID — será marcado inválido na 2ª falha.`);
                            await supabase.from('leads').update({ status: 'new' }).eq('id', currentLead.id).eq('status', 'reservado');
                            leadsEmProcessamento.delete(currentLead.id);
                            liberarSemaforoSemCooldown(instanceId);
                        }
                    }

                    // Chips virgens (sem histórico outbound) recebem 4 chances; chips com histórico recebem 2
                    const limiteStale = (sucessosPorSessao.get(instanceId) || 0) === 0 ? 4 : 2;
                    if (stalesFalhas < limiteStale) {
                        console.warn(`⏱️ [ACK TIMEOUT - SOFT] ${instanceId} — falha stale ${stalesFalhas}/${limiteStale}. Reiniciando socket sem apagar credenciais...`);
                        staleRetryFlag.set(instanceId, true); // próximo ciclo usa jitter curto (15-45s)
                        const _instAtual = sessions.get(instanceId);
                        if (_instAtual?.sock) { try { _instAtual.sock.end(); } catch(_) {} }
                        break;
                    }

                    // Limite atingido → wipe completo
                    console.error(`⏱️ [ACK TIMEOUT - HARD] ${instanceId} — ${stalesFalhas} falhas stale (limite=${limiteStale}). Limpando credenciais e pedindo novo QR...`);
                    console.warn(`[REDIS-WIPE-CAUSE] Chip ${instanceId}: wipe por ACK_TIMEOUT_HARD (${stalesFalhas} falhas consecutivas sem SERVER_ACK)`);
                    staleContador.delete(instanceId);
                    primeiroEnvioSucesso.delete(instanceId);
                    sucessosPorSessao.delete(instanceId); // nova sessão começa do zero
                    for (const key of falhasLeadPorSessao.keys()) {
                        if (key.startsWith(instanceId + ':')) falhasLeadPorSessao.delete(key);
                    }
                    ultimoHardRestart.set(instanceId, Date.now()); // bloqueia reconexão por 5min
                    await clearRedisSession(redisConnection, instanceId).catch(() => {});
                    await supabase.from('whatsapp_sessions').delete().eq('id', instanceId);
                    await supabase.from('whatsapp_keys').delete().eq('instance_id', instanceId);
                    const _instAtual = sessions.get(instanceId);
                    if (_instAtual?.sock) { try { _instAtual.sock.end(); } catch(_) {} }
                    break;
                }

                // Erros de rede/socket/chip — lógica original de retry
                console.error(`❌ Erro no motor do chip ${instanceId}:`, errInner.message);
                if (currentLeadId) {
                    leadsEmProcessamento.delete(currentLeadId);
                    liberarSemaforoChip(instanceId, chipNovo);
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
// 📅 CONFIRMAÇÃO DIÁRIA DE REUNIÕES (Google Agenda) — opt-in POR TENANT
// ============================================================================
// Lê a agenda do tenant, extrai o telefone da DESCRIÇÃO do evento e manda WhatsApp
// confirmando presença. Marca ❓ no card do lead e no título do evento. A resposta
// (✅/❌) é tratada no workerIA (hook de confirmação). Isolamento total: só roda pra
// tenants com confirmacao_ativa=true e dispara pelo chip do PRÓPRIO tenant.

// Mesmo dia no fuso BRT (-03:00)? Compara as datas deslocadas 3h.
function _ehHojeBRT(iso) {
    if (!iso) return false;
    const d1 = new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    return d1 === d2;
}

async function processarConfirmacoesDeUmTenant(userId) {
    const { data: conn } = await supabase.from('calendar_connections')
        .select('calendar_id, confirmacao_ativa').eq('user_id', userId).maybeSingle();
    if (!conn || !conn.confirmacao_ativa || !conn.calendar_id) return { ok: false, motivo: 'nao_configurado' };

    // Chip PRONTO do tenant — dispara por ele (isolamento).
    const entrada = [...sessions.entries()].find(([, s]) => s.userId === userId && s.ready);
    if (!entrada) {
        enviarAlerta(`📅 *Confirmação de reuniões*: nenhum chip conectado pro tenant \`${userId.slice(0, 8)}\`. Tento de novo no próximo ciclo.`).catch(() => {});
        return { ok: false, motivo: 'sem_chip' };
    }
    const [instanceId, sess] = entrada;
    const regras = await getRegrasEmCache(instanceId);
    const nomeAgente = regras?.agent_name || 'nossa equipe';
    const nomeEmpresa = regras?.company_name || 'nossa equipe';

    let eventos = [];
    try { eventos = await gcal.listarEventosDeHoje(userId, conn.calendar_id); }
    catch (e) { console.error(`❌ [CONFIRMA] Falha ao ler agenda do tenant ${userId.slice(0, 8)}: ${e.message}`); return { ok: false, motivo: 'erro_agenda' }; }

    let enviados = 0, pulados = 0;
    for (const ev of eventos) {
        if (!eventoEhReuniao(ev)) { pulados++; continue; }
        const digitos = extrairTelefoneDescricao(ev.description);
        if (!digitos) { console.log(`⏭️ [CONFIRMA] Evento "${ev.summary}" sem telefone na descrição — pulado.`); pulados++; continue; }
        const jids = digitosParaJids(digitos);
        if (!jids.length) { pulados++; continue; }

        // Idempotência: já pedimos confirmação hoje pra esse evento? Não repete.
        const { data: existente } = await supabase.from('leads')
            .select('id, whatsapp_id, dono, confirmacao_pedido_em')
            .eq('gcal_event_id', ev.id).eq('user_id', userId).maybeSingle();
        if (existente && _ehHojeBRT(existente.confirmacao_pedido_em)) continue;

        // Acha lead por qualquer variação de JID (dentro do tenant).
        let lead = existente || null;
        if (!lead) {
            for (const jid of jids) {
                const { data } = await supabase.from('leads').select('id, whatsapp_id, dono')
                    .eq('whatsapp_id', jid).eq('user_id', userId).maybeSingle();
                if (data) { lead = data; break; }
            }
        }

        const convidado = Array.isArray(ev.attendees)
            ? ev.attendees.find(a => a.email && a.email.toLowerCase() !== (ev.organizer?.email || '').toLowerCase())
            : null;
        const nomeConvidado = convidado?.displayName || null;
        const jidEnvio = lead?.whatsapp_id || jids[0];
        const primeiroNome = saudacaoPrimeiroNome(lead?.dono || nomeConvidado, 'tudo bem');
        const horaReuniao = ev.start?.dateTime
            ? new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
            : 'hoje';

        const tpl = regras?.opening_templates?.confirmacao_reuniao;
        const msg = (tpl || `${primeiroNome}, aqui é ${nomeAgente} da ${nomeEmpresa}. Passando pra confirmar nossa reunião de hoje às ${horaReuniao}. Você consegue participar?`)
            .replace(/\$\{primeiroNome\}/g, primeiroNome)
            .replace(/\$\{hora\}/g, horaReuniao)
            .replace(/\$\{nomeAgente\}/g, nomeAgente)
            .replace(/\$\{nomeMinhaEmpresa\}/g, nomeEmpresa);

        const patch = {
            gcal_event_id: ev.id,
            gcal_calendar_id: conn.calendar_id,
            calendly_event_at: ev.start?.dateTime || null,
            confirmacao_status: 'pendente',
            confirmacao_pedido_em: new Date().toISOString(),
        };
        try {
            if (lead) {
                await supabase.from('leads').update(patch).eq('id', lead.id);
            } else {
                await supabase.from('leads').insert({
                    whatsapp_id: jidEnvio, user_id: userId, instance_id: instanceId,
                    name: nomeConvidado || 'Convidado', dono: extrairNomeHumano(nomeConvidado) || null,
                    origin: 'gcal_confirmacao', status: 'booked', ...patch,
                });
            }
            await enviarMensagemIA(sess.sock, jidEnvio, { text: msg }, instanceId);
            await db.saveMessage(jidEnvio, 'assistant', msg, instanceId);
            gcal.atualizarEmojiTitulo(userId, conn.calendar_id, ev.id, '❓').catch(() => {});
            enviados++;
            console.log(`📅 [CONFIRMA] Confirmação enviada p/ ${primeiroNome} (${jidEnvio}) — reunião ${horaReuniao}.`);
        } catch (e) {
            console.error(`❌ [CONFIRMA] Falha ao enviar p/ ${jidEnvio}: ${e.message}`);
        }
        await delay(Math.floor(Math.random() * 20000) + 20000); // ritmo humano entre envios
    }
    console.log(`📅 [CONFIRMA] Tenant ${userId.slice(0, 8)}: ${enviados} enviado(s), ${pulados} pulado(s).`);
    return { ok: true, enviados, pulados };
}

// Varre todos os tenants opt-in; roda 1x/dia/tenant a partir da hora configurada (idempotente).
async function varrerConfirmacoesDiarias() {
    const horaAtual = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
    const hojeStr = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const { data: conns } = await supabase.from('calendar_connections')
        .select('user_id, confirmacao_hora').eq('confirmacao_ativa', true);
    if (!conns || !conns.length) return;
    global.ultimaConfirmacaoPorTenant = global.ultimaConfirmacaoPorTenant || {};
    for (const c of conns) {
        const hora = Number.isInteger(c.confirmacao_hora) ? c.confirmacao_hora : 11;
        if (horaAtual < hora) continue;                                         // ainda não deu a hora dele
        if (global.ultimaConfirmacaoPorTenant[c.user_id] === hojeStr) continue; // já rodou hoje
        try {
            await processarConfirmacoesDeUmTenant(c.user_id);
            global.ultimaConfirmacaoPorTenant[c.user_id] = hojeStr;
        } catch (e) { console.error(`❌ [CONFIRMA] Tenant ${c.user_id?.slice(0, 8)}: ${e.message}`); }
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
    .limit(2)
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

                    const chipNome = cacheRegrasInstancia.get(lf.instance_id)?.dados?.name || lf.instance_id.slice(0, 8);

                    if (followupAtual === 0) {
                        const primeiroNome = saudacaoPrimeiroNome(lf.dono, 'Opa');
                        const nomeEmpresa = (lf.name || 'empresa').replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim();

                        const msgFollowUp = `${primeiroNome}, conseguiu dar uma olhada na mensagem acima? Como a gente tem poucas vagas com isenção pra região, queria confirmar se faz sentido pra ${nomeEmpresa} antes de liberar o espaço.`;

                        // ⚡ FAST-LANE: não dispara follow-up enquanto há inbound pendente no chip
                        if (inboundAtivo.has(lf.instance_id)) {
                            console.log(`⚡ [FAST-LANE] ${chipNome} tem inbound pendente. Pulando follow-up D1 de ${lf.name}.`);
                            continue;
                        }

                        // 🚦 SEMÁFORO: Follow-up D1 tem prioridade 3 (cede pra saudação E recuperação)
                        const semaforoOk = await adquirirSemaforoChip(lf.instance_id, 'FOLLOWUP');
                        if (!semaforoOk) {
                            console.log(`⏸️ [FOLLOWUP-D1] [${chipNome}] Chip ocupado por prioridade maior. Pulando ${lf.name} desta rodada.`);
                            continue;
                        }

                        console.log(`🔔 [FOLLOW-UP D1] [${chipNome} → ${lf.name}] Disparando...`);
await instancia.sock.sendPresenceUpdate('composing', lf.whatsapp_id);

// ⏳ Tempo de "digitação" proporcional ao tamanho da mensagem (humanização)
const tempoDigitacao = Math.min(Math.max(msgFollowUp.length * 80, 4000), 9000);
await delay(tempoDigitacao);

await enviarMensagemIA(instancia.sock, lf.whatsapp_id, { text: msgFollowUp }, lf.instance_id);
await db.saveMessage(lf.whatsapp_id, 'assistant', msgFollowUp, lf.instance_id);

await supabase.from('leads').update({ followup_count: 1, last_contact_at: dataAgoraDate.toISOString() }).eq('id', lf.id);
liberarSemaforoChip(lf.instance_id); // 🚦 Libera vaga

// 🛡️ ANTI-BAN: Jitter de 3-6 minutos entre follow-ups do mesmo chip
const jitterAntiBan = Math.floor(Math.random() * 180000) + 180000;
console.log(`⏸️ [ANTI-BAN] [${chipNome} → ${lf.name}] Aguardando ${Math.round(jitterAntiBan/1000)}s antes do próximo follow-up...`);
await delay(jitterAntiBan);
                    }
                    else if (followupAtual === 1) {
                        // D3 — segunda e última tentativa antes do tombamento
                        const primeiroNome = saudacaoPrimeiroNome(lf.dono, 'Opa');
                        const nomeEmpresa = (lf.name || 'empresa').replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim();

                        const msgD3 = `${primeiroNome}, última tentativa da minha parte. Se a conversa sobre a ${nomeEmpresa} ainda fizer sentido, é só me responder aqui. Se não for a hora certa, sem problema — desejo sucesso pra vcs!`;

                        if (inboundAtivo.has(lf.instance_id)) {
                            console.log(`⚡ [FAST-LANE] ${chipNome} tem inbound pendente. Pulando follow-up D3 de ${lf.name}.`);
                            continue;
                        }

                        const semaforoOk = await adquirirSemaforoChip(lf.instance_id, 'FOLLOWUP');
                        if (!semaforoOk) { continue; }

                        console.log(`🔔 [FOLLOW-UP D3] [${chipNome} → ${lf.name}] Disparando...`);
                        await instancia.sock.sendPresenceUpdate('composing', lf.whatsapp_id);
                        await delay(Math.min(Math.max(msgD3.length * 80, 4000), 9000));
                        await enviarMensagemIA(instancia.sock, lf.whatsapp_id, { text: msgD3 }, lf.instance_id);
                        await db.saveMessage(lf.whatsapp_id, 'assistant', msgD3, lf.instance_id);
                        await supabase.from('leads').update({ followup_count: 2, last_contact_at: dataAgoraDate.toISOString() }).eq('id', lf.id);
                        liberarSemaforoChip(lf.instance_id);
                        await delay(Math.floor(Math.random() * 180000) + 180000);
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
            .limit(1)
            : { data: null };

        if (leadsLink) {
            for (const ll of leadsLink) {
                try {
                    const instancia = sessions.get(ll.instance_id);
                    if (!instancia || !instancia.ready || iaRespondendo.has(ll.whatsapp_id)) continue;

                    // Honesto e não-acusatório: "não vi cair aqui" coloca a checagem do NOSSO lado
                    // (calendly_booked=false), cobrindo tanto quem não reservou quanto quem reservou
                    // e o sistema não detectou — e oferece ajuda em vez de inventar um erro de sistema.
                    const primeiroNome = saudacaoPrimeiroNome(ll.dono, 'Opa');

                    const msgFollowUpLink = `${primeiroNome}, não vi seu horário cair aqui na nossa agenda depois da nossa conversa. Conseguiu reservar direitinho, ou ficou alguma dúvida que eu possa te ajudar?`;

                 // ⚡ FAST-LANE: follow-up de link tem prioridade mínima — cede para inbound imediatamente
                    if (inboundAtivo.has(ll.instance_id)) {
                        console.log(`⚡ [FAST-LANE] Chip tem inbound pendente. Pulando follow-up link de ${ll.name}.`);
                        continue;
                    }

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

await enviarMensagemIA(instancia.sock, ll.whatsapp_id, { text: msgFollowUpLink }, ll.instance_id);
await db.saveMessage(ll.whatsapp_id, 'assistant', msgFollowUpLink, ll.instance_id);

await supabase.from('leads').update({ last_followup_type: 'link_abandoned' }).eq('id', ll.id);
liberarSemaforoChip(ll.instance_id); // 🚦 Libera vaga

// 🛡️ ANTI-BAN: Jitter de 3-6 minutos
const jitterAntiBan = Math.floor(Math.random() * 180000) + 180000;
console.log(`⏸️ [ANTI-BAN] [${cacheRegrasInstancia.get(ll.instance_id)?.dados?.name || ll.instance_id.slice(0,8)} → ${ll.name}] Aguardando ${Math.round(jitterAntiBan/1000)}s antes do próximo follow-up...`);
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

            // status: o webhook do Calendly grava 'booked' (server.js), não 'closed' — filtrar só
            // 'closed' fazia o lembrete NUNCA disparar. Aceita ambos por segurança.
            const { data: leadsReuniao } = await supabase
                .from('leads')
                .select('id, name, whatsapp_id, instance_id, dono, calendly_event_at')
                .in('status', ['booked', 'closed'])
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
                    const nome    = saudacaoPrimeiroNome(lr.dono, 'você');
                    const instanceData = await getRegrasEmCache(lr.instance_id);

                    const msgLembrete = instanceData?.opening_templates?.lembrete_reuniao
                        || `${nome}, só passando pra lembrar da nossa conversa amanhã às ${horaF}. Até lá!`;

                    await enviarMensagemIA(instanciaL.sock, lr.whatsapp_id, { text: msgLembrete }, lr.instance_id);
                    await db.saveMessage(lr.whatsapp_id, 'assistant', msgLembrete, lr.instance_id);
                    await supabase.from('leads').update({ reminder_sent: new Date().toISOString() }).eq('id', lr.id);
                    console.log(`🔔 [LEMBRETE] Enviado para ${lr.name} — reunião às ${horaF}`);
                    await delay(Math.floor(Math.random() * 30000) + 30000);
                }
            }

            // 📅 CONFIRMAÇÃO DIÁRIA DE REUNIÕES (opt-in por tenant) — 1x/dia/tenant a partir da
            // hora configurada. Idempotente por evento, então rodar no ciclo de 5min é seguro.
            await varrerConfirmacoesDiarias().catch(e => console.error(`❌ [CONFIRMA] varredura: ${e.message}`));
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
            .in('status', ['booked', 'dead', 'invalid', 'closed'])
            .or('is_audited.eq.false,is_audited.is.null')
            .in('instance_id', chipsAudit)
            .limit(5);

        if (leadsParaAuditar && leadsParaAuditar.length > 0) {
            // Busca product_type de cada instância para o auditor contextualizar corretamente
            const uniqueInstIds = [...new Set(leadsParaAuditar.map(l => l.instance_id))];
            const { data: instProdData } = await supabase
                .from('instances').select('id, product_type').in('id', uniqueInstIds);
            const productTypeMap = Object.fromEntries((instProdData || []).map(i => [i.id, i.product_type]));
            console.log(`📋 [QA AUDITOR] ${leadsParaAuditar.length} leads na fila. Iniciando análise...`);

            let auditadosComSucesso = 0;
            let errosCriticosEncontrados = [];

            for (const lead of leadsParaAuditar) {
                const histRaw = await db.getHistory(lead.whatsapp_id, lead.instance_id);

                const hasLeadReply = histRaw?.some(m => m.role === 'user');
                if (!histRaw || histRaw.length <= 2 || !hasLeadReply) {
                    // Sem resposta do lead: marca auditado mas sem relatório — não contamina métricas
                    await supabase.from('leads').update({
                        is_audited:   true,
                        audit_report: null,
                    }).eq('id', lead.id);
                    continue;
                }

                const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
                const relatorio = await auditorAgent.gerarAuditoria(historico, lead, productTypeMap[lead.instance_id] || 'solar');

                if (!relatorio) continue; // LLM falhou — tenta na próxima rodada

                await supabase.from('leads').update({
                    audit_report: relatorio,
                    is_audited:   true,
                }).eq('id', lead.id);

                auditadosComSucesso++;
                console.log(`✅ [QA AUDITOR] ${lead.name} — desfecho: ${relatorio.desfecho} | nota: ${relatorio.nota_ia}`);

                // Emite para o dashboard em tempo real — apenas para o dono da instância
                if (ioSocket) {
                    const auditUserId = sessions.get(lead.instance_id)?.userId;
                    if (auditUserId) {
                        ioSocket.to(`user:${auditUserId}`).emit('audit_complete', {
                            leadId:   lead.id,
                            leadName: lead.name,
                            relatorio,
                        });
                    }
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
        const historico = histRaw.map(m => ({
            role: m.role === 'human_operator' ? 'assistant' : m.role,
            content: m.role === 'human_operator' ? `[ATENDENTE_HUMANO]: ${m.content}` : m.content
        }));
        const instanceData = await getRegrasEmCache(instanceId);
        
        let resposta = await gerarRespostaIA(historico, lead, instanceData);
        await filtrarEEnviarResposta(sock, remoteJid, resposta, historico, lead, instanceId, instanceData?.tts_voice || null);

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
        // 2. Regras do chip primeiro — precisamos do provider antes de exigir socket.
        const instanceData = await getRegrasEmCache(instanceId);
        const ehOficial = instanceData?.whatsapp_provider === 'official';

        // 💸 Marca o tenant do fluxo p/ o teto de custo de LLM contar por conta
        // (cobre os agentes despachados abaixo, que não recebem userId na assinatura).
        definirTenantLLM(lead.user_id || instanceData?.user_id);

        // Socket Baileys: exigido só para chips Baileys. Oficiais (Cloud API) respondem por
        // HTTP e não têm socket na memória — pulam essa checagem.
        const instancia = sessions.get(instanceId);
        if (!ehOficial && (!instancia || !instancia.ready)) throw new Error("Socket do WhatsApp não está conectado.");

        // 3. Monta o contexto pesado
        const histRaw = await db.getHistory(whatsappId, instanceId);
        // 🧠 human_operator → assistant + prefixo visual para o LLM reconhecer stand-by
        const historico = histRaw.map(m => ({
            role: m.role === 'human_operator' ? 'assistant' : m.role,
            content: m.role === 'human_operator' ? `[ATENDENTE_HUMANO]: ${m.content}` : m.content
        }));

        // 👋 PRIMEIRO CONTATO: a IA nunca respondeu esse lead antes (ele procurou primeiro).
        // Vira flag DURO pro closer acolher em vez de disparar qualificação abrupta no 1º turno.
        const primeiroContato = !historico.some(m => m.role === 'assistant');

        const ultimaMsg = historico[historico.length - 1].content;

        // 📅 HOOK DE CONFIRMAÇÃO DE REUNIÃO: se esse lead recebeu um pedido de confirmação hoje,
        // interpretamos a resposta (✅/❌) e NÃO rodamos o funil de venda. 'indefinido' segue normal.
        if (lead.confirmacao_status === 'pendente' && _ehHojeBRT(lead.calendly_event_at)) {
            const veredito = classificarConfirmacao(ultimaMsg);
            if (veredito !== 'indefinido') {
                const primeiroNome = saudacaoPrimeiroNome(lead.dono, 'perfeito');
                const horaR = lead.calendly_event_at
                    ? new Date(lead.calendly_event_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
                    : 'no horário';
                const novoStatus = veredito === 'confirmado' ? 'confirmado' : 'desmarcado';
                const emoji = veredito === 'confirmado' ? '✅' : '❌';
                await supabase.from('leads').update({ confirmacao_status: novoStatus }).eq('id', lead.id);
                if (lead.gcal_event_id && lead.gcal_calendar_id) {
                    gcal.atualizarEmojiTitulo(lead.user_id, lead.gcal_calendar_id, lead.gcal_event_id, emoji).catch(() => {});
                }
                const ack = veredito === 'confirmado'
                    ? `${primeiroNome}, combinado! Tô te esperando às ${horaR} então. Até já 🙌`
                    : `Sem problema, ${primeiroNome}. Quer que eu veja um outro horário pra gente remarcar?`;
                const sockConf = instancia?.sock || sessions.get(instanceId)?.sock;
                if (sockConf) await enviarMensagemIA(sockConf, whatsappId, { text: ack }, instanceId);
                await db.saveMessage(whatsappId, 'assistant', ack, instanceId);
                console.log(`📅 [CONFIRMA] ${lead.name}: ${novoStatus} (resposta: "${ultimaMsg.slice(0, 40)}").`);
                return; // confirmação tratada — não aciona o funil de venda
            }
        }

// 🚀 Executa os 3 agentes EM PARALELO com SKIP INTELIGENTE
        console.log(`🧠 [WORKER-IA] Despachando Router + Intel + Profiler em paralelo para ${lead.name}...`);

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

const { data: brain } = await supabase
    .from('tenant_prompts')
    .select('system_prompt, qualifier_prompt, closer_prompt, objection_prompt')
    .eq('user_id', userId)
    .maybeSingle();

// Roteamento de prompt: seleciona a constituição certa para o modo do lead.
// Fallback para system_prompt garante compatibilidade com tenants sem migração.
let promptBase;
// Override POR CHIP tem precedência total: chip com system_prompt próprio (ex.: anúncio/
// inbound) usa ele em TODAS as intenções, ignorando o roteamento da conta.
const overrideChipWorker = instanceData?.system_prompt?.trim();
if (overrideChipWorker && overrideChipWorker.length >= 100) {
    promptBase = overrideChipWorker;
    console.log(`🎯 [PROMPT-CHIP] Chip ${instanceId.slice(0,8)} usa system_prompt próprio (override) — ignora roteamento da conta.`);
} else if (intencao === 'COMPRA') {
    promptBase = brain?.closer_prompt || brain?.system_prompt;
    console.log(`🎯 [ROUTER-PROMPT] Intenção COMPRA → closer_prompt ${brain?.closer_prompt ? '✅' : '⚠️ fallback system_prompt'}`);
} else if (intencao === 'OBJECAO') {
    promptBase = brain?.objection_prompt || brain?.system_prompt;
    console.log(`🛡️ [ROUTER-PROMPT] Intenção OBJECAO → objection_prompt ${brain?.objection_prompt ? '✅' : '⚠️ fallback system_prompt'}`);
} else {
    // DUVIDA, CONTINUAR, LIXO, REPASSE
    promptBase = brain?.qualifier_prompt || brain?.system_prompt;
    console.log(`🔍 [ROUTER-PROMPT] Intenção ${intencao} → qualifier_prompt ${brain?.qualifier_prompt ? '✅' : '⚠️ fallback system_prompt'}`);
}

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
        // 🛡️ ANTI-LOOP: Se a IA já mandou 15+ mensagens sem agendar, a conversa está em loop
        // (bot sofisticado ou lead que ignora). Encerra antes de chamar qualquer agente.
        const totalMsgsIA = historico.filter(m => m.role === 'assistant').length;
        if (totalMsgsIA >= 15 && lead.status !== 'booked') {
            console.log(`🛑 [ANTI-LOOP] ${lead.name}: ${totalMsgsIA} msgs da IA sem conversão. Marcando como inválido.`);
            await supabase.from('leads').update({
                status: 'invalid',
                is_paused: true,
                internal_notes: `Anti-loop: ${totalMsgsIA} respostas sem conversão em ${new Date().toLocaleString('pt-BR')}`
            }).eq('id', lead.id);
            emitirEventoHandoff(lead, `${totalMsgsIA} msgs da IA sem conversão — lead não engajou`, historico).catch(() => {});
            return;
        }

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
    const tplDespedida = instanceData?.opening_templates?.despedida;
    if (tplDespedida && !lead.is_paused) {
        const primeiroNome = (lead.name || '').split(' ')[0];
        const textoDespedida = tplDespedida.replace(/\$\{nome\}/g, primeiroNome);
        const partes = textoDespedida.split('[QUEBRA]').map(t => t.trim()).filter(t => t);
        for (let i = 0; i < partes.length; i++) {
            if (i > 0) await delay(1500 + Math.random() * 1000);
            await enviarMensagemIA(instancia.sock, lead.whatsapp_id, { text: partes[i] }, instanceId).catch(() => {});
        }
    }
    await supabase.from('leads').update({
        is_paused: true,
        manual_pause: false,
        internal_notes: `Conversa encerrada cordialmente em ${new Date().toLocaleString('pt-BR')}.`
    }).eq('id', lead.id);
    console.log(`🔕 [WORKER-IA] Lead ${lead.name} pausado após despedida cordial.`);
    return;

} else if (intencao === 'ENGANO') {
    console.log(`🚫 [WORKER-IA] ENGANO detectado para ${lead.name}. Encerrando com resposta de cortesia.`);
    await supabase.from('leads').update({
        status: 'invalid',
        is_paused: true,
        internal_notes: `Número errado/engano detectado em ${new Date().toLocaleString('pt-BR')}.`
    }).eq('id', lead.id);
    resposta = 'Puxa, desculpas pelo incômodo! O cadastro devia estar desatualizado. Um abraço e boa semana!';

} else if (intencao === 'SOLAR') {
    console.log(`☀️ [WORKER-IA] Lead já tem solar: ${lead.name}. Aplicando KNOCK-OUT.`);
    await supabase.from('leads').update({
        status: 'invalid',
        is_paused: true,
        internal_notes: `Lead já tem geração solar ativa. Encerrado em ${new Date().toLocaleString('pt-BR')}.`
    }).eq('id', lead.id);
    resposta = 'Entendi! Como vocês já têm geração ativa, a ANEEL não permite acumular dois benefícios. Parabéns pela gestão energética!';

} else if (intencao === 'AGENDA_RETORNO') {
    console.log(`📅 [WORKER-IA] Lead ${lead.name} pediu retorno em horário específico. Gerando confirmação...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'COMPRA', {
        calendlyLink: instanceData?.calendly_link,
        instanceType: instanceData?.product_type || 'solar'
    });
    // [FOLLOW_UP] já é extraído e salvo em filtrarEEnviarResposta (etapa 0).
    // Fallback: se o closer esqueceu a tag, tenta extrair a data da última mensagem do lead.
    if (resposta && !resposta.match(/\[FOLLOW_UP:/i)) {
        const ultimaMsgUser = [...historico].reverse().find(m => m.role === 'user');
        const isoExtraida   = ultimaMsgUser
            ? await extrairDataISO(ultimaMsgUser.content).catch(() => null)
            : null;
        if (isoExtraida) {
            await supabase.from('leads').update({
                is_paused:      true,
                follow_up_at:   isoExtraida,
                internal_notes: `Follow-up extraído da msg do lead em ${new Date().toLocaleString('pt-BR')}.`
            }).eq('id', lead.id);
            console.log(`⏳ [AGENDA_RETORNO] Data extraída da mensagem: ${new Date(isoExtraida).toLocaleString('pt-BR')} → lead ${lead.name} pausado.`);
        } else {
            await supabase.from('leads').update({
                is_paused:      true,
                internal_notes: `Lead pediu retorno posterior. Pausado em ${new Date().toLocaleString('pt-BR')}.`
            }).eq('id', lead.id);
            console.log(`⏸️ [AGENDA_RETORNO] Sem data identificável. Lead ${lead.name} pausado preventivamente.`);
            emitirEventoHandoff(lead, 'Lead pediu retorno posterior — sem data extraída automaticamente', historico).catch(() => {});
        }
    }

} else if (intencao === 'COMPRA') {
    // ... resto do código igual
    console.log(`💰 [WORKER-IA] Sinal de COMPRA! Acionando Closer em modo fechamento para ${lead.name}...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'COMPRA', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });

} else if (intencao === 'DUVIDA' || intencao === 'CONTINUAR') {
    console.log(`🔍 [WORKER-IA] Fluxo de CONTINUIDADE/DÚVIDA. Acionando Closer para ${lead.name}...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'DUVIDA', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar', primeiroContato });

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

    // 📧 Email tem prioridade: se o lead passou um email no repasse, dispara o fluxo de email
    // em vez do fluxo de decisor por telefone.
    const emailMatch = ultimaMsg.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const emailDetectado = emailMatch ? emailMatch[0] : null;

    if (emailDetectado) {
        console.log(`📧 [REPASSE] Email detectado na mensagem: ${emailDetectado}`);
        const resultadoEmailRepasse = await emailService.enviarEmailRepasse(emailDetectado, lead, instanceData);
        await supabase.from('leads').update({ email: emailDetectado }).eq('id', lead.id);
        lead.email = emailDetectado;

        if (resultadoEmailRepasse.success) {
            resposta = `Perfeito, vou encaminhar por lá também. Obrigado pela indicação! 🙏`;
            console.log(`✅ [REPASSE] Email de repasse enviado para ${emailDetectado}`);
        } else {
            console.error(`❌ [REPASSE] Falha ao enviar email de repasse:`, resultadoEmailRepasse.error);
            resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'REPASSE', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });
        }
    } else {
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
        } else if (lead.backup_whatsapp_id) {
            // 🚪 GATEKEEPER SEM REPASSE: lead confirmou que não é quem decide mas não passou
            // contato — se já existe um backup_whatsapp_id cadastrado, migra automaticamente
            // em vez de esperar o lead voltar com o número.
            console.log(`🔁 [GATEKEEPER] Sem repasse explícito, mas backup_whatsapp_id já cadastrado. Migrando automaticamente.`);
            try {
                await db.atualizarLeadParaDecisor({
                    leadId:            lead.id,
                    novoNomeDecisor:   nomeDecisor,
                    novoPhone:         lead.backup_whatsapp_id.replace(/\D/g, ''),
                    labelNumeroAntigo: 'recepcao',
                });
                sdrEventsGlobal?.emit('NOVO_LEAD_DISPONIVEL', lead.instance_id);
                resposta = `Sem problemas, vou tentar por outro contato. Obrigado! 🙏`;
                console.log(`✅ [GATEKEEPER] Lead ${lead.id} migrado para backup_whatsapp_id automaticamente.`);
            } catch (erroBackup) {
                console.error(`❌ [GATEKEEPER] Falha ao migrar para backup_whatsapp_id:`, erroBackup.message);
                resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'REPASSE', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });
            }
        } else {
            // Nenhum telefone na mensagem — closer pergunta pelo contato do decisor
            console.log(`⚠️ [REPASSE] Nenhum telefone extraído para ${lead.name}. Closer assumindo para solicitar o contato...`);
            resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'REPASSE', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar' });
            // Pausa o lead para evitar loop: mesmo email chegando de novo não dispara nova resposta
            await supabase.from('leads').update({
                is_paused: true,
                internal_notes: `Aguardando telefone do decisor — email recebido: "${ultimaMsg.substring(0, 80)}"`
            }).eq('id', lead.id);
            console.log(`⏸️ [REPASSE] Lead ${lead.name} pausado. Aguardando retorno com telefone.`);
            emitirEventoHandoff(lead, 'Aguardando telefone do decisor — lead indicou outra pessoa sem passar o número', historico).catch(() => {});
        }
    }

} else {
    console.log(`🧹 [WORKER-IA] Mensagem LIXO. Closer seguirá estágio atual da Constituição...`);
    resposta = await closerAgent.gerarRespostaCloser(historico, lead, promptResolvido, 'LIXO', { calendlyLink: instanceData?.calendly_link, instanceType: instanceData?.product_type || 'solar', primeiroContato });
}

// 🛡️ Blindagem final: se todos os agentes falharam, avisa o log
if (!resposta) {
    console.error(`❌ [WORKER-IA] Nenhum agente gerou resposta válida para ${lead.name}. Abortando envio.`);
    return;
}

        // 4.3. Filtra, Carimba no WPP e Envia (instancia?.sock: oficial não tem socket → null, envio vai por HTTP)
        await filtrarEEnviarResposta(instancia?.sock, remoteJid, resposta, historico, lead, instanceId, instanceData?.tts_voice || null);

    } catch (error) {
        console.error(`❌ [WORKER-ERRO] Falha ao processar job ${job.id}:`, error.message);
        enviarAlerta("⚠️ ERRO NA IA (WORKER)", `Falha ao responder o lead.\nErro: ${error.message}`, 15158332);
        throw error; // Força o BullMQ a tentar de novo (Retry)
    } finally {
        iaRespondendo.delete(whatsappId);
        const _restantes = (inboundAtivo.get(instanceId) || 1) - 1;
        if (_restantes <= 0) inboundAtivo.delete(instanceId); else inboundAtivo.set(instanceId, _restantes);
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
let ultimaRedistribuicao = 0;
async function redistribuirLeadsOrfaos() {
    if (Date.now() - ultimaRedistribuicao < 30000) return; // debounce: no máximo 1 execução a cada 30s
    ultimaRedistribuicao = Date.now();
    try {
        // 1. Busca instâncias trazendo também o DONO (user_id)
        const { data: instancias } = await supabase
            .from('instances')
            .select('id, name, whatsapp_status, user_id');
        if (!instancias?.length) return;

        // Usa sessions Map como fonte de verdade live — evita race condition
        // entre o DB.updateStatus e a redistribuição chamada no disconnect
        const conectados = instancias.filter(i => {
            const sessao = sessions.get(i.id);
            return sessao?.ready === true;
        });
        if (!conectados.length) return;

        const idsDesconectados = instancias
            .filter(i => {
                const sessao = sessions.get(i.id);
                return !sessao || sessao.ready !== true;
            })
            .map(i => i.id);

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

        // 3. Busca leads órfãos: sem chip (instance_id IS NULL) OU de chips desconectados
        // Separa as duas condições para evitar query inválida quando idsDesconectados está vazio
        let orfaosQuery = supabase
            .from('leads')
            .select('id, user_id')
            .eq('status', 'new');

        if (idsDesconectados.length > 0) {
            orfaosQuery = orfaosQuery.or(`instance_id.in.(${idsDesconectados.join(',')}),instance_id.is.null`);
        } else {
            orfaosQuery = orfaosQuery.is('instance_id', null);
        }

        const { data: orfaos } = await orfaosQuery;
        if (!orfaos?.length) return;

        console.log(`♻️ [REDISTRIBUIÇÃO] ${orfaos.length} leads órfãos detectados. Isolando por Tenant...`);

        let redistribuidosCount = 0;
        const chipsAcordados = new Set();

        // 4. Distribuição Cirúrgica
        for (const lead of orfaos) {
            // Lead sem dono definido não pode ser redistribuído — evita cross-tenant com chipsPorUsuario[null]
            if (!lead.user_id) {
                console.warn(`⚠️ [REDISTRIBUIÇÃO] Lead ${lead.id} sem user_id ignorado. Não redistribuir.`);
                continue;
            }

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

// ============================================================
// 📅 MOTOR DE FOLLOW-UP — Despertador de leads agendados
// ============================================================
async function verificarFollowUpsVencidos() {
    try {
        const agora = new Date().toISOString();
        const { data: leads, error } = await supabase
            .from('leads')
            .select('id, name, dono, whatsapp_id, instance_id')
            .eq('is_paused', true)
            .not('follow_up_at', 'is', null)
            .lte('follow_up_at', agora)
            .limit(20);

        if (error) {
            console.error('[FOLLOW-UP] Erro ao buscar follow-ups vencidos:', error.message);
            return;
        }
        if (!leads || leads.length === 0) return;

        for (const lead of leads) {
            try {
                // 1. Despausa o lead antes de tentar enviar
                await supabase.from('leads')
                    .update({ is_paused: false, follow_up_at: null })
                    .eq('id', lead.id);

                console.log(`⏰ [FOLLOW-UP] Acordando lead ${lead.name} no prazo combinado!`);

                // 2. Tenta obter o socket ativo para o chip do lead
                const instancia = sessions.get(lead.instance_id);
                if (!instancia?.sock || !instancia?.ready) {
                    console.warn(`⚠️ [FOLLOW-UP] Chip ${lead.instance_id} offline. Lead ${lead.name} despausado; próximo disparo retoma contato.`);
                    continue;
                }

                // 3. Monta e envia a mensagem de reativação
                const primeiroNome = saudacaoPrimeiroNome(lead.dono, '');
                const msgReativacao = `Oi${primeiroNome ? ' ' + primeiroNome : ''}, passando aqui conforme combinamos! Como estão as coisas por aí?`;
                const cleanJid = lead.whatsapp_id.includes('@')
                    ? lead.whatsapp_id
                    : `${lead.whatsapp_id}@s.whatsapp.net`;

                await instancia.sock.sendPresenceUpdate('composing', cleanJid);
                await delay(2000 + Math.random() * 2000);
                await instancia.sock.sendPresenceUpdate('paused', cleanJid);

                await enviarMensagemIA(instancia.sock, cleanJid, { text: msgReativacao }, lead.instance_id);
                await db.saveMessage(cleanJid, 'assistant', msgReativacao, lead.instance_id);

                console.log(`✅ [FOLLOW-UP] Mensagem de reativação enviada para ${lead.name}.`);
            } catch (errLead) {
                console.error(`❌ [FOLLOW-UP] Erro ao acordar lead ${lead.name}:`, errLead.message);
            }
        }
    } catch (err) {
        console.error('[FOLLOW-UP] Erro geral na verificação de follow-ups:', err.message);
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
        Browsers = baileys.Browsers;

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
            try {
                await startInstance(i.id, i.name, i.user_id);
                // 🚀 ARRANQUE INICIAL: Liga a turbina para este chip!
                processarFilaDeAtaque(i.id);
            } catch (err) {
                // Proxy fail ou outro erro fatal neste chip — limpa o lock e continua com os demais
                instanciasLigando.delete(i.id);
                console.error(`🚫 [MANAGER] Chip ${i.name} abortado na inicialização: ${err.message}. Continuando com os demais.`);
            }
            const arranqueDelay = Math.floor(Math.random() * 5000) + 10000; // 10–15s por chip — anti-burst de deploy
            console.log(`⏳ [ARRANQUE] Aguardando ${Math.round(arranqueDelay / 1000)}s antes do próximo chip...`);
            await delay(arranqueDelay);
        }

        // 🛑 BLINDAGEM MÁXIMA: Garante que o Vigia e o Ouvinte sejam criados UMA ÚNICA VEZ
        if (!loopIniciado) {
            loopIniciado = true;
            loopRecuperacaoConversas();
            loopAuditor();

            // ============================================================================
            // 🩺 CAMADA 2 — HEARTBEAT DE SAÚDE: snapshot do processo a cada 5 minutos
            // Permite detectar quando o servidor está vivo mas chips estão todos mortos.
            // ============================================================================
            setInterval(() => {
                const mem = process.memoryUsage();
                const totalSessions = sessions.size;
                const prontos = [...sessions.values()].filter(s => s.ready).length;
                const ligando = instanciasLigando.size;
                const motores = motoresEmExecucao.size;
                const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
                const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
                const rss = Math.round(mem.rss / 1024 / 1024);
                const uptime = Math.round(process.uptime() / 60);

                console.log(`💓 [HEARTBEAT] uptime=${uptime}min | heap=${heapMB}/${heapTotalMB}MB rss=${rss}MB`);
                console.log(`💓 [HEARTBEAT] chips: total=${totalSessions} prontos=${prontos} ligando=${ligando} motores=${motores}`);

                // Snapshot por chip
                for (const [id, sess] of sessions) {
                    const nome = sess.name || id.slice(0, 8);
                    const estado = sess.ready ? 'PRONTO' : 'OFFLINE';
                    const motor = motoresEmExecucao.has(id) ? 'MOTOR_ON' : 'MOTOR_OFF';
                    const stale = staleContador.get(id) || 0;
                    const sucessos = sucessosPorSessao.get(id) || 0;
                    const tentativas = tentativasReconexao.get(id) || 0;
                    console.log(`   🔌 ${nome} | ${estado} | ${motor} | stale=${stale} | sucessos=${sucessos} | reconexoes=${tentativas}`);
                }

                // Alerta se heap absoluto > 400MB (V8 pode crescer heapTotal até 512MB — % relativo é enganoso)
                if (heapMB > 400) {
                    console.error(`⚠️ [HEARTBEAT] ALERTA: heap em ${heapMB}MB/${heapTotalMB}MB — risco de OOM`);
                }
                // Alerta silencioso: processo vivo mas nenhum chip pronto
                if (totalSessions > 0 && prontos === 0 && ligando === 0) {
                    console.error(`⚠️ [HEARTBEAT] ALERTA: ${totalSessions} chips no Map mas NENHUM pronto e nenhum conectando — sistema morto em silêncio!`);
                }
            }, 5 * 60 * 1000);
            
            // ⏰ VIGIA NOTURNO: Varredura de segurança a cada 30 minutos
            setInterval(async () => {
                // ============================================================================
                // 🔭 CAMADA 3 — SNAPSHOT DO VIGIA: estado completo de todos os chips
                // ============================================================================
                console.log("⏰ [VIGIA] Varredura de segurança ativada...");
                const mem = process.memoryUsage();
                console.log(`🔭 [VIGIA-SNAP] uptime=${Math.round(process.uptime()/60)}min | heap=${Math.round(mem.heapUsed/1024/1024)}MB | rss=${Math.round(mem.rss/1024/1024)}MB`);
                try {
                    const instsDB = await db.getActiveInstances();
                    for (const inst of instsDB) {
                        const sess = sessions.get(inst.id);
                        const pronto = sess?.ready === true;
                        const wsAberto = sess?.sock?.ws?.isOpen === true;
                        const motor = motoresEmExecucao.has(inst.id);
                        const ligando = instanciasLigando.has(inst.id);
                        const stale = staleContador.get(inst.id) || 0;
                        const suc = sucessosPorSessao.get(inst.id) || 0;
                        const tent = tentativasReconexao.get(inst.id) || 0;
                        const icone = pronto ? '✅' : (ligando ? '⏳' : '❌');
                        console.log(`${icone} [VIGIA-SNAP] ${inst.name} | pronto=${pronto} ws=${wsAberto} motor=${motor} ligando=${ligando} stale=${stale} suc=${suc} recon=${tent}`);
                    }
                } catch (e) {
                    console.error(`❌ [VIGIA-SNAP] Erro ao gerar snapshot:`, e.message);
                }

                await redistribuirLeadsOrfaos();

                // Auto-reconecta chips DISCONNECTED que estão no DB mas sem sessão ativa
                try {
                    const instsAtivas = await db.getActiveInstances();
                    for (const inst of instsAtivas) {
                        const sessao = sessions.get(inst.id);
                        const estaConectado = sessao?.ready === true;
                        const estaConectando = instanciasLigando.has(inst.id);
                        if (!estaConectado && !estaConectando && !chipsAbandanados.has(inst.id)) {
                            console.log(`🔄 [VIGIA] Auto-reconectando chip desconectado: ${inst.name}`);
                            staleContador.delete(inst.id); // fresh start no auto-reconnect
                            startInstance(inst.id, inst.name, inst.user_id).catch(e =>
                                console.error(`❌ [VIGIA] Falha ao reconectar ${inst.name}:`, e.message)
                            );
                            await delay(2000); // escalonamento para evitar burst de reconexões simultâneas
                        } else if (!estaConectado && !estaConectando && chipsAbandanados.has(inst.id)) {
                            // 🔁 AUTO-RECUPERAÇÃO: chip abandonado não fica mais morto pra sempre.
                            const desde = abandonadoEm.get(inst.id) || Date.now();
                            const paradoMs = Date.now() - desde;
                            if (paradoMs >= COOLDOWN_ABANDONO_MS) {
                                console.warn(`🔁 [VIGIA-RECUPERA] ${inst.name} parado há ${Math.round(paradoMs/60000)}min — limpando sessão e tentando reconectar do zero.`);
                                enviarAlerta(`🔁 *Auto-recuperação*: ${inst.name} está caído há ${Math.round(paradoMs/60000)}min. Tentando reconectar do zero agora. Se pedir QR, faça *Resetar Sessão* no dashboard.`).catch(() => {});
                                await clearRedisSession(redisConnection, inst.id).catch(() => {});
                                chipsAbandanados.delete(inst.id);
                                abandonadoEm.delete(inst.id);
                                tentativasReconexao.delete(inst.id);
                                staleContador.delete(inst.id);
                                ultimoAlertaAbandono.set(inst.id, Date.now());
                                startInstance(inst.id, inst.name, inst.user_id).catch(e =>
                                    console.error(`❌ [VIGIA-RECUPERA] Falha ao reconectar ${inst.name}:`, e.message)
                                );
                                await delay(2000);
                            } else {
                                // Ainda no cooldown: re-alerta no máx a cada REALERTA_ABANDONO_MS pra você saber que segue down.
                                const ultimoAlerta = ultimoAlertaAbandono.get(inst.id) || 0;
                                if (Date.now() - ultimoAlerta >= REALERTA_ABANDONO_MS) {
                                    enviarAlerta(`🚫 *Chip ainda caído*: ${inst.name} há ${Math.round(paradoMs/60000)}min. Auto-recuperação em ~${Math.round((COOLDOWN_ABANDONO_MS-paradoMs)/60000)}min.`).catch(() => {});
                                    ultimoAlertaAbandono.set(inst.id, Date.now());
                                }
                                console.warn(`🔕 [VIGIA] ${inst.name} caído há ${Math.round(paradoMs/60000)}min — auto-recuperação em ~${Math.round((COOLDOWN_ABANDONO_MS-paradoMs)/60000)}min (ou Resetar Sessão manual).`);
                            }
                        }
                    }
                } catch (e) {
                    console.error('❌ [VIGIA] Erro no auto-reconnect:', e.message);
                }

                for (const id of sessions.keys()) {
                    if (instanciasDeletadas.has(id)) {
                        sessions.delete(id);
                        motoresEmExecucao.delete(id);
                        continue;
                    }
                    processarFilaDeAtaque(id);
                }
            }, 5 * 60 * 1000);

            // 📅 DESPERTADOR DE FOLLOW-UPS: verifica a cada 1 minuto
            setInterval(verificarFollowUpsVencidos, 60 * 1000);

            // 💓 HEARTBEAT: verifica WebSocket de cada chip a cada 4 minutos
            setInterval(async () => {
                for (const [instanceId, instancia] of sessions) {
                    if (!instancia.ready) continue;
                    // Verifica WebSocket sem tráfego WA
                    const chipNome = instancia.name || instanceId.slice(0, 8);
                    if (!instancia.sock?.ws?.isOpen) {
                        console.warn(`💔 [HEARTBEAT] ${chipNome} WebSocket fechado. Reconectando...`);
                        startInstance(instanceId, chipNome, instancia.userId).catch(e =>
                            console.error(`❌ [HEARTBEAT] reconexão falhou para ${chipNome}: ${e.message}`)
                        );
                        continue;
                    }
                    // Envia presença somente em horário comercial para manter sessão viva
                    if (!dentroDaJanelaDeDisparo(instanceId)) continue;
                    try {
                        await instancia.sock.sendPresenceUpdate('available', 'status@broadcast');
                    } catch (e) {
                        console.warn(`💔 [HEARTBEAT] ${chipNome} sem resposta ao ping. Forçando reconexão.`);
                        startInstance(instanceId, chipNome, instancia.userId).catch(err =>
                            console.error(`❌ [HEARTBEAT] reconexão falhou para ${chipNome}: ${err.message}`)
                        );
                    }
                }
            }, 4 * 60 * 1000);

            // 🔔 OUVINTE DO ALARME RAM: Escuta o grito do Scraper
            if (sdrEvents) {
                sdrEvents.on('NOVO_LEAD_DISPONIVEL', (chipIdDestino) => {
                    console.log(`🔔 [ALARME RAM] Novo lead recebido! Acordando o chip ${chipIdDestino}...`);
                    processarFilaDeAtaque(chipIdDestino);
                });

               sdrEvents.on('AGENDAMENTO_CONFIRMADO', async ({ lead, dataEvento, instanceId }) => {
    console.log(`🎊 [WEBHOOK] Agendamento confirmado para ${lead.name}. Preparando feedback...`);
    alertaCalendly({ leadName: lead.dono || lead.name, empresa: lead.name, niche: lead.niche, dataEvento, nomeEvento: lead.calendly_event_name }).catch(() => {});
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
                        const primeiroNome = saudacaoPrimeiroNome(lead.dono, 'você');

                        // Template de confirmação — usa o do Supabase se existir, senão fallback
                        const tplConfirmacao = instanceData?.opening_templates?.confirmacao_agendamento
                            || `Perfeito, ${primeiroNome}! Reunião confirmada pra ${dataFormatada} às ${horaFormatada}. Te vejo lá!`;

                        await enviarMensagemIA(instancia.sock, lead.whatsapp_id, { text: tplConfirmacao }, instanceId);
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
                console.error(`❌ [FRONTEND] Chip ${instanceId} não está pronto (ready=false ou ausente).`);
                return { success: false, error: 'Chip offline ou não conectado.' };
            }

            // Verificação extra: WebSocket precisa estar aberto no nível TCP
            // (ready=true no Map não garante que o socket não está fantasma)
            if (!instancia.sock.ws?.isOpen) {
                console.error(`❌ [FRONTEND] Chip ${instanceId} tem ready=true mas WebSocket fechado — socket fantasma detectado.`);
                // Marca como não-pronto para evitar tentativas futuras até reconexão
                instancia.ready = false;
                return { success: false, error: 'Conexão WhatsApp inativa. Aguarde a reconexão automática ou reconecte o chip.' };
            }

            console.log(`👤 [FRONTEND] Enviando mensagem manual para ${whatsappId} via chip ${instanceId}...`);

            // 2. Simula o "Digitando..." para o lead
            await instancia.sock.sendPresenceUpdate('composing', whatsappId).catch(() => {});
            await delay(1500);
            await instancia.sock.sendPresenceUpdate('paused', whatsappId).catch(() => {});

            // 3. Envia a mensagem usando a função interna para registrar na memória viva (evita eco do bot)
            const sentMsg = await enviarMensagemIA(instancia.sock, whatsappId, { text: texto }, instanceId);

            if (sentMsg) {
                // 4. Salva a mensagem no banco de dados para o histórico do front-end
                await db.saveMessage(whatsappId, 'assistant', texto, instanceId);

                // 5. PAUSA A IA (Intervenção Humana): pausa manual — robô não volta sem /ativar
                await supabase.from('leads').update({
                    is_paused: true,
                    manual_pause: true,
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
        instanciasDeletadas.add(instanceId);

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
            .select('default_product_type, opening_templates, default_agent_name, default_company_name, default_daily_limit')
            .eq('id', userId)
            .maybeSingle();

        const productType = profile?.default_product_type || 'solar';
        console.log(`🏷️ [INSTÂNCIA] Criando chip "${n}" para user ${userId} com product_type="${productType}"`);

        const { data, error: errInsert } = await supabase
            .from('instances')
            .insert([{
                name: n, owner_phone: t || null, user_id: userId, product_type: productType,
                opening_templates: profile?.opening_templates || null,
                agent_name: profile?.default_agent_name || null,
                company_name: profile?.default_company_name || null,
                daily_limit: profile?.default_daily_limit || null,
            }])
            .select()
            .single();

        if (errInsert) {
            console.error(`❌ [INSTÂNCIA] Falha ao criar chip "${n}" para user ${userId}:`, errInsert.message);
            return null;
        }

        if (data) {
            await saveOwnerToRedis(redisConnection, data.id, userId);
            try {
                await startInstance(data.id, data.name, userId);
                processarFilaDeAtaque(data.id);
            } catch (err) {
                console.error(`❌ [INSTÂNCIA] Falha ao iniciar chip "${n}" (proxy/sessão): ${err.message}. Chip criado no DB — reconecte manualmente.`);
                instanciasLigando.delete(data.id);
            }
        }
        return data;
    },

    reconectarInstancia: async (instanceId) => {
        if (instanciasEmResetManual.has(instanceId)) {
            console.log(`⚠️ [RECONEXÃO MANUAL] Reset de ${instanceId.slice(0,8)} já em andamento. Ignorando duplicata.`);
            return;
        }
        instanciasEmResetManual.add(instanceId);
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

        // 3. Limpa credenciais do Redis E Supabase — sessão completamente zerada garante QR novo e sessão WA válida
        console.warn(`[REDIS-WIPE-CAUSE] Chip ${instanceId}: wipe por reconexão manual via dashboard`);
        await clearRedisSession(redisConnection, instanceId);
        await supabase.from('whatsapp_sessions').delete().eq('id', instanceId);
        await supabase.from('whatsapp_keys').delete().eq('instance_id', instanceId);
        await db.updateInstanceStatus(instanceId, 'DISCONNECTED');

        // 4. Aguarda handlers de close processarem antes de iniciar novo socket
        await new Promise(r => setTimeout(r, 1500));

        // 5. Libera flag de encerramento para o novo socket funcionar normalmente
        instanciasEncerrandoManualmente.delete(instanceId);

        // 6. Inicia nova sessão — sem credenciais no Redis, Baileys vai gerar QR code
        staleContador.delete(instanceId); // reconexão manual começa com contador zerado
        primeiroEnvioSucesso.delete(instanceId);
        tentativasReconexao.delete(instanceId); // Reset Session é intervenção humana — zera contador de falhas
        chipsAbandanados.delete(instanceId); // libera chip para auto-reconexão após QR scan
        abandonadoEm.delete(instanceId);
        ultimoAlertaAbandono.delete(instanceId);
        instanciasDeletadas.delete(instanceId); // Remove do set de deletados caso o chip seja re-ativado
        instanciasEmResetManual.delete(instanceId); // libera o lock — próximo reset pode prosseguir
        startInstance(instanceId, name).catch(err =>
            console.error(`❌ [RECONEXÃO MANUAL] Falha ao iniciar chip "${name}" (proxy/sessão): ${err.message}. Tente reconectar novamente.`)
        );
    },

    // Invalida o cache de regras da instância — usado pelo PATCH /api/instance para que
    // toggles de inbound_only/use_email_outbound/use_sms_outbound sejam lidos no próximo ciclo.
    invalidateInstanceCache: (instanceId) => {
        cacheRegrasInstancia.delete(instanceId);
    },

    // 🩺 SNAPSHOT DE SAÚDE: estado runtime de cada chip pro painel ao vivo (/api/health).
    // Lê só as estruturas em RAM — o server.js cruza com nome/status do DB.
    snapshotSaude: () => {
        const agora = Date.now();
        const out = {};
        for (const [instanceId, sess] of sessions.entries()) {
            const abInicio = abandonadoEm.get(instanceId) || null;
            const ultInbound = ultimoInboundAt.get(instanceId) || null;
            out[instanceId] = {
                ready: sess?.ready === true,
                wsOpen: sess?.sock?.ws?.isOpen === true,
                recon: tentativasReconexao.get(instanceId) || 0,
                abandonado: chipsAbandanados.has(instanceId),
                paradoHaMin: abInicio ? Math.round((agora - abInicio) / 60000) : null,
                ultimoInboundAt: ultInbound,
                ultimoInboundHaMin: ultInbound ? Math.round((agora - ultInbound) / 60000) : null,
            };
        }
        return out;
    },

    // 📇 EMAIL FINDER via WhatsApp Business Profile: usa o chip CONECTADO pra consultar o perfil
    // business de cada lead sem email. Retorna email/website ESTRUTURADO que o dono preencheu no
    // perfil (fonte de alta confiança pra PME, adoção alta). Só grava email/website (nunca telefone).
    // É leitura, mas espaça as consultas (throttle) por segurança. email_source='wa_business'.
    enriquecerEmailsBusinessProfile: async (instanceId, limite = 50) => {
        const sessao = sessions.get(instanceId);
        if (!sessao?.ready || !sessao?.sock) return { erro: 'Chip não conectado', processados: 0, achados: 0 };

        const { data: leads, error } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id')
            .eq('instance_id', instanceId)
            .is('email', null)
            .limit(limite);
        if (error) return { erro: error.message, processados: 0, achados: 0 };

        const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        let achados = 0;
        for (const lead of leads || []) {
            try {
                const perfil = await sessao.sock.getBusinessProfile(lead.whatsapp_id);
                if (perfil) {
                    const email = String(perfil.email || '').trim().toLowerCase();
                    const website = Array.isArray(perfil.website) ? perfil.website[0] : (perfil.website || null);
                    const updates = {};
                    if (email && REGEX_EMAIL.test(email)) { updates.email = email; achados++; }
                    if (website) updates.website = website;
                    if (Object.keys(updates).length) {
                        await supabase.from('leads').update(updates).eq('id', lead.id);
                        console.log(`📇 [WA-BIZ] ${lead.name}: ${updates.email || '(só site)'} ${updates.website || ''}`);
                    }
                }
            } catch (e) { /* perfil ausente/erro — segue o baile */ }
            await new Promise(r => setTimeout(r, 1500)); // throttle: é leitura, mas não abusa
        }
        console.log(`📇 [WA-BIZ] Chip ${sessao.name || instanceId.slice(0,8)}: ${(leads||[]).length} processados, ${achados} emails.`);
        return { processados: (leads || []).length, achados };
    },

    pauseChip: async (instanceId, pausar) => {
        const { error } = await supabase
            .from('instances')
            .update({ firing_paused: pausar })
            .eq('id', instanceId);
        if (error) throw new Error(error.message);
        cacheRegrasInstancia.delete(instanceId); // invalida cache — próximo ciclo do motor lê o novo valor
        const nome = sessions.get(instanceId)?.name || instanceId.slice(0, 8);
        console.log(`${pausar ? '⏸️' : '▶️'} [PAUSA MANUAL] Chip ${nome} ${pausar ? 'PAUSADO' : 'RETOMADO'} pelo operador.`);
    },

    // Reativa um lead pausado manualmente e acorda o motor imediatamente para esse chip,
    // em vez de esperar o próximo ciclo natural de processarFilaDeAtaque (que pode levar horas).
    unpauseLead: async (leadId) => {
        const { data: lead, error } = await supabase
            .from('leads')
            .update({
                is_paused: false,
                manual_pause: false,
                last_human_interaction: null,
            })
            .eq('id', leadId)
            .select('id, instance_id, name')
            .single();

        if (error) throw new Error(error.message);

        if (lead?.instance_id) {
            sdrEventsGlobal?.emit('NOVO_LEAD_DISPONIVEL', lead.instance_id);
            console.log(`▶️ [UNPAUSE] Lead ${lead.name} reativado — motor do chip ${lead.instance_id.slice(0, 8)} acordado.`);
        }
        return lead;
    },

    // 🌐 INBOUND OFICIAL (Meta Cloud API): o webhook /webhook/whatsapp do server.js
    // repassa o corpo bruto do Meta + o instanceId (da URL). Normaliza, acha/cria o lead e
    // injeta na MESMA fila FilaIA que o Baileys usa — daí a esteira de agentes é idêntica.
    receberInboundOficial: async (instanceId, webhookBody) => {
        const norm = cloudApiTransport.normalizarInbound(webhookBody);
        if (!norm || !norm.texto) return { ok: false, motivo: 'sem_mensagem_texto' };

        const instanceData = await getRegrasEmCache(instanceId);
        if (!instanceData) return { ok: false, motivo: 'instancia_desconhecida' };

        const cleanJid = norm.remoteJid;
        let { data: lead } = await supabase.from('leads')
            .select('*').eq('whatsapp_id', cleanJid).eq('instance_id', instanceId).maybeSingle();

        if (!lead) {
            const { data: novo, error: errNovo } = await supabase.from('leads').insert({
                whatsapp_id: cleanJid,
                instance_id: instanceId,
                user_id: instanceData.user_id,
                name: norm.pushName || 'Contato Oficial',
                dono: extrairNomeHumano(norm.pushName) || null,
                origin: 'inbound_oficial',
                status: 'contact',
                first_touch_channel: 'inbound_oficial', // lead recém-criado — sempre primeiro toque
                first_touch_at: new Date().toISOString(),
            }).select('*').single();
            if (errNovo || !novo) return { ok: false, motivo: 'falha_criar_lead', erro: errNovo?.message };
            lead = novo;
            console.log(`🌐 [INBOUND OFICIAL] Lead novo criado para ${cleanJid} (chip ${instanceId.slice(0,8)}).`);
        }

        await db.saveMessage(cleanJid, 'user', norm.texto, instanceId);
        inboundAtivo.set(instanceId, (inboundAtivo.get(instanceId) || 0) + 1);
        await filaMensagensIA.add('gerar_resposta',
            { leadId: lead.id, whatsappId: cleanJid, instanceId, remoteJid: cleanJid },
            { priority: 1, attempts: 3 });
        return { ok: true, leadId: lead.id };
    },

    acordarChips: () => {
        let acordados = 0;
        for (const [id, sessao] of sessions) {
            if (!sessao.ready) continue;
            cacheRegrasInstancia.delete(id); // força releitura do daily_limit do DB
            if (!motoresEmExecucao.has(id)) {
                console.log(`⚡ [ACORDA] Bypassing cold-start para ${sessao.name || id}`);
                processarFilaDeAtaque(id);
                acordados++;
            }
        }
        console.log(`⚡ [ACORDA] ${acordados} chip(s) despertados imediatamente.`);
        return { acordados };
    },

    getDiagnosticoChip: async (instanceId) => {
        const regras = await getRegrasEmCache(instanceId);
        const sessao = sessions.get(instanceId);
        const semaforo = semaforoChips.get(instanceId);
        const motorRodando = motoresEmExecucao.has(instanceId);
        const contadorHoje = await db.getDailyContactCount(instanceId);
        const limite = regras?.daily_limit || 0;

        const { count: leadsDisponiveis } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('instance_id', instanceId)
            .eq('status', 'new');

        const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const hora = agora.getHours();
        const diaSemana = agora.getDay();
        const dentroDaJanela = diaSemana >= 1 && diaSemana <= 5 && hora >= 8 && hora < 18;

        return {
            instanceId,
            nome: regras?.name || instanceId,
            causas: {
                motor_travado: motorRodando,
                status_bd_desconectado: regras?.whatsapp_status !== 'CONNECTED',
                socket_nao_pronto: !sessao?.ready,
                fora_da_janela_horario: !dentroDaJanela,
                limite_diario_atingido: contadorHoje >= limite,
                sem_leads_disponiveis: leadsDisponiveis === 0,
            },
            dados: {
                whatsapp_status_bd: regras?.whatsapp_status,
                socket_ready: sessao?.ready ?? false,
                semaforo_ocupado: semaforo?.ocupado ?? false,
                ultimo_disparo: semaforo?.ultimoDisparo
                    ? new Date(semaforo.ultimoDisparo).toISOString()
                    : null,
                envios_hoje: contadorHoje,
                limite_diario: limite,
                leads_new_disponiveis: leadsDisponiveis ?? 0,
                hora_brt: hora,
                dia_semana: diaSemana,
                dentro_janela_08_18: dentroDaJanela,
            }
        };
    },

    // 📅 Dispara a confirmação de reuniões AGORA pro tenant (usado pelo endpoint de teste no staging).
    rodarConfirmacaoAgora: async (userId) => processarConfirmacoesDeUmTenant(userId),
};