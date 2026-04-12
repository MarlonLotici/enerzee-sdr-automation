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
const { gerarAudioTTS } = require('./tts');
const { createClient } = require('@supabase/supabase-js');
const motoresEmExecucao = new Set(); // 🛡️ Impede que o mesmo chip ligue dois loops infinitos
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

// --- TRAVA DE SEGURANÇA (MEMÓRIA VIVA) ---
const leadsEmProcessamento = new Set();
const mensagensEnviadasPelaIA = new Set(); // 🛡️ PASSO 1: A Memória Anti-Eco do Robô
const iaRespondendo = new Set();
const mapaRastreioLID = new Map();
const gavetaDeMensagens = new Map(); // 🧠 OUVIDO PACIENTE: Gaveta temporária de mensagens
const cacheRegrasInstancia = new Map(); // 🧠 Memória de curto prazo para regras
let sdrEventsGlobal = null; // 🛡️ Adicione esta linha aqui no topo
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
    // Cálculo matemático direto sobre os números recebidos
    const t = agora.horas * 60 + agora.minutos;
    
    // 330 = 05:30 AM | 1365 = 22:45 PM
    return t >= 330 && t <= 1365;
}

function dentroDaJanelaDeDisparo() {
    const agora = getHoraBrasil();
    
    // 0 = Domingo. Não disparar no domingo.
    if (agora.diaSemana === 0) return false; 

    const t = agora.horas * 60 + agora.minutos;

    // 480 = 08:00 AM | 1080 = 18:00 PM
    const inicio = 480; 
    const fim = 1080;

    const estaNaJanela = t >= inicio && t <= fim;
    
    if (!estaNaJanela) {
        console.log(`💤 [HORÁRIO] Agora são ${agora.horas}:${agora.minutos < 10 ? '0'+agora.minutos : agora.minutos}. Janela: 08:00 às 18:00.`);
    }

    return estaNaJanela;
}


// ============================================================================
// 🧠 NÚCLEO IA: INTENÇÃO E RESPOSTA (SEU "CLOSER V11" INTEGRAL)
// ============================================================================

// 🎯 FIX #7: Detector de robô por REGEX (custo zero, latência zero)
// Substitui a chamada LLM que custava ~$0.002 por mensagem recebida
function analisarIntencaoRegex(texto) {
    if (!texto || texto.trim().length === 0) return "[HUMANO]";
    const t = texto.toLowerCase().trim();
    const PADROES_ROBO = [
        /(?:digite|opcao|opção)\s*\d/i,
        /^\s*\d\s*[-–—\.]\s*.+/m,
        /(?:1\s*[-–]\s*.+\n\s*2\s*[-–])/,
        /agradec\w+\s+(?:seu|sua|o)\s+contato/i,
        /(?:retornaremos|em\s+breve\s+retorn|entraremos\s+em\s+contato)/i,
        /(?:em\s+)?hor[aá]rio\s+comercial/i,
        /sua\s+mensagem\s+foi\s+recebida/i,
        /bem[- ]?vind[oa]\s+(?:ao?|à)/i,
        /atendimento\s+(?:das|de)\s+\d/i,
        /^(?:seg\s+[aà]\s+sex|segunda\s+[aà]|funciona\w+\s+das?\s+\d)/i,
        /(?:cardapio|card[áa]pio)\s*(?:digital|online|aqui)/i,
        /(?:acesse|confira)\s+(?:nosso|o)\s+(?:cardápio|menu)/i,
        /(?:n[ãa]o\s+(?:é|e)\s+poss[ií]vel\s+atend|fora\s+do\s+hor[aá]rio)/i,
        /(?:para\s+falar\s+com\s+(?:um|nosso)\s+atendente)/i,
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
    
    // Se existe na memória e tem menos de 30 minutos (1800000 ms), usa a RAM!
    if (cache && (agora - cache.timestamp < 1800000)) {
        return cache.dados;
    }
    
    // Se não tem na memória ou o tempo expirou, vai no banco de dados buscar
    const regrasDoBanco = await db.getInstanceRules(instanceId);
    if (regrasDoBanco) {
        // Salva na RAM com a hora exata da consulta
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
    
    return `
[RESUMO DE ESTADO - INVISÍVEL AO LEAD]
Estágio atual: ${estagioAtual}
Última ação sua: ${ultimaAcaoIA}...
Áudios TTS enviados: ${audiosUsados}/2
${objservations}
 
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
// 🧠 NÚCLEO IA: "THE ARCHITECT" - STATE OF THE ART SDR V3.0
// ============================================================================

async function gerarRespostaIA(historico, contextoLead, instanceData) {
    const concessionariaLocal = MAPA_CONCESSIONARIAS[contextoLead.estado] || 'concessionária de energia';

    const nomeLead = (contextoLead.dono && typeof contextoLead.dono === 'string') 
        ? contextoLead.dono.split(' ')[0] 
        : (contextoLead.name || "Gestor");

    const nomeEmpresa = (contextoLead.name || "sua empresa")
        .replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '') 
        .trim();

    const bairroLead = contextoLead.bairro || "sua região";

    // Injeta contexto de reversão se já foi tentada — segurança extra além do histórico
    const reversaoJaTentada = contextoLead.objection_reversed 
        ? '\n\nAVISO CRÍTICO: Este lead já recebeu UMA tentativa de reversão de objeção anteriormente (marcador [REVERSAO_TENTADA] no histórico). Se ele recusar novamente, encerre a conversa com cordialidade. PROIBIDO tentar reverter uma segunda vez.'
        : '';
    
    const agentName  = instanceData?.agent_name  || "Marlon";
    const companyName = instanceData?.company_name || "Enerzee";

    const isBigFish = (contextoLead.capital_social_numeric > 500000);
    const ancoraConta = isBigFish ? "R$ 3.000" : "R$ 700";

    const perfilComportamental = isBigFish 
        ? "ARQUÉTIPO: O BANQUEIRO DE INVESTIMENTOS. Tom: Direto, focado em redução de OPEX e Zero CAPEX." 
        : "ARQUÉTIPO: O CONSULTOR PARCEIRO. Tom: Educativo, focado em 'sobrar dinheiro no caixa' e alívio das contas.";

        // 🎯 FIX #12: Percentual REAL do estado
    const percentualReal = MAPA_DESCONTO_REGIONAL[contextoLead.estado] || 0.15;
    const percentualTexto = Math.round(percentualReal * 100);

    // 🎯 FIX #11: Contexto de nicho
    const nicheContext = gerarContextoNicho(contextoLead.niche);

    // 🎯 FIX #4: Estágio atual do funil
    const estagioAtual = contextoLead.current_stage || 0;

    // 🎯 SAAS: Se o cliente tem prompt customizado no banco, usa ele
    if (instanceData?.system_prompt && instanceData.system_prompt.trim().length > 100) {
        let promptCustom = instanceData.system_prompt
            .replace(/\$\{agentName\}/g, agentName)
            .replace(/\$\{companyName\}/g, companyName)
            .replace(/\$\{nomeLead\}/g, nomeLead)
            .replace(/\$\{nomeEmpresa\}/g, nomeEmpresa)
            .replace(/\$\{bairroLead\}/g, bairroLead)
            .replace(/\$\{concessionariaLocal\}/g, concessionariaLocal)
            .replace(/\$\{ancoraConta\}/g, ancoraConta)
            .replace(/\$\{perfilComportamental\}/g, perfilComportamental)
            .replace(/\$\{percentualTexto\}/g, String(percentualTexto))
            .replace(/\$\{reversaoJaTentada\}/g, reversaoJaTentada)
            .replace(/\$\{estagioAtual\}/g, String(estagioAtual))
            .replace(/\$\{nicheContext\}/g, nicheContext);

        // Usa o prompt do banco e pula o hardcoded
        const MAX_TENTATIVAS = 3;
       // 🔥 APLICAR PODA INTELIGENTE
const historicoPodado = podarHistorico(historico);


for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
        const chatCompletion = await together.chat.completions.create({
            messages: [
                { role: 'system', content: systemPromptMelhorado },  // ← USA O MELHORADO
                ...historicoPodado  // ← USA O PODADO
            ],
                    model: MODELO_CEREBRO,
                    temperature: 0.3,
                    max_tokens: 180,
                    presence_penalty: 0.1,
                    frequency_penalty: 0.15
                });
                let respostaDaIA = chatCompletion.choices[0].message.content;
                respostaDaIA = respostaDaIA.replace(/[\*_~`]/g, '');
                return respostaDaIA;
            } catch (e) {
                console.error(`❌ [LLM] Tentativa ${tentativa}/${MAX_TENTATIVAS} falhou (prompt custom): ${e.message}`);
                if (tentativa < MAX_TENTATIVAS) await new Promise(r => setTimeout(r, tentativa * 3000));
            }
        }
        return null;
    }
 const systemPromptMelhorado = `
### 1. IDENTIDADE E MISSÃO
Você é ${agentName}, Consultor de Energia sênior da ${companyName}.
Produto: Energia por Assinatura (Lei 14.300) — Geração Distribuída via Usinas WEG certificadas.
Missão: Agendar uma consultoria gratuita de 30 minutos via Calendly com ZERO custo de adesão e ZERO obras.
Tom: Direto, humano, B2B brasileiro. Use "vc", "tá", "né", "pra". NUNCA use "reunião", "compliance", "EBITDA" a menos que o perfil do lead indique.
 
Contexto do primeiro contato: Você enviou uma mensagem curta dizendo que viu algo sobre a conta de energia da empresa e perguntou se estava falando com o responsável pelas contas fixas. O lead ainda não sabe o que é — apenas que há algo sobre a conta de luz.
 
FILOSOFIA DE VENDA — CHALLENGER SALE:
Você não dá aulas técnicas. Você ENSINA que empresas do porte da ${nomeEmpresa} estão pagando ${percentualTexto}% a mais na conta de luz sem saber.
${nicheContext}
 
ESTÁGIO ATUAL DO FUNIL: ${estagioAtual}
Avance APENAS UM estágio por vez. Ao final da resposta, retorne a tag [ESTAGIO:N] com o número do estágio que a conversa ATINGIU após sua resposta.
 
${gerarAncoragemContexto(contextoLead, estagioAtual, historico)}
---
 
### 2. REGRAS ABSOLUTAS DE FORMATO

1. MÁXIMO DE 2 BALÕES: Use [QUEBRA] para separar. NUNCA gere 3 balões.
2. TAMANHO: Cada balão tem NO MÁXIMO 2 frases curtas (~20 palavras). Corte o resto.
3. TEXTO PURO: PROIBIDO asteriscos (*), sublinhados (_), crases ou markdown.
4. UMA PERGUNTA: Nunca duas perguntas no mesmo envio.
5. NÃO REPITA: Nunca repita argumento ou áudio já usado no histórico.
6. VARIAÇÃO: Frases de tamanhos diferentes — humanos não falam em blocos uniformes.
7. SIGILO TOTAL: É estritamente proibido escrever as palavras 'estágio', 'funil' ou 'tag' para o lead. Use a tag [ESTAGIO:N] apenas como um marcador técnico invisível ao final da resposta.
---

### 3. REGRAS DE OURO (PRIORIDADE MÁXIMA)

1. ROBÔ / AUTORESPOSTA: Se a mensagem contiver menu numerado, cardápio, boas-vindas automáticas ("agradece seu contato", "retornaremos", "em horário comercial", "mensagem recebida"), horários de funcionamento isolados ou qualquer resposta claramente não digitada por uma pessoa: retorne APENAS [ROBO]. Nada mais.

2. RESPEITO AO NÃO:
   — Primeira recusa ("não tenho interesse"): faça UMA pergunta curta de reversão. Ex: "Entendo. Só curiosidade, a conta aí passa de R$ 800?"
   — Segunda recusa ou se [REVERSAO_TENTADA] estiver no histórico: responda APENAS "Compreendo! Desejo ótimos negócios pra ${nomeEmpresa}. Qualquer coisa, estou por aqui!" e ENCERRE.

3. KNOCK-OUT (JÁ TEM SOLAR): Se o lead disser que já tem placa solar, usina própria ou geração ativa: responda APENAS "Entendi! Como a ${nomeEmpresa} já possui compensação ativa, a regulação da ANEEL não permite acumular dois benefícios. Parabéns pela gestão energética!" e ENCERRE.

4. REGRA DO ELÁSTICO: Se o lead perguntar "quanto custa?" ou "tem obra?" antes do pitch, responda em 1 frase ("zero custo de adesão, sem obra") e com [QUEBRA] volte para a pergunta do funil.

5. FILTRO DE IDENTIDADE: Se disserem que a pessoa procurada não está ou é só funcionário: "Sem problemas! Consegue me colocar em contato com o responsável pelas contas?"

6. DETECÇÃO DE NÚMERO (HAND-OFF): 
Se o interlocutor fornecer um número de telefone ou dizer "chama no 9...", você deve responder:
"Perfeito, vou entrar em contato com o responsável por lá agora mesmo. Obrigado! [ROBO]"

7. "QUEM TE DEU MEU NÚMERO?" / "COMO CONSEGUIU MEU CONTATO?":
Responda: "O cadastro da ${nomeEmpresa} apareceu num mapeamento que a gente fez de empresas da região que podem estar pagando tarifa cheia na ${concessionariaLocal}. Não é telemarketing — é mais um alerta sobre uma cobrança que pode estar sendo evitada."
Depois com [QUEBRA]: "Vc que cuida dessa parte de contas fixas aí?"

8. CAIU NA CONTABILIDADE: Se a pessoa responder que é do escritório de contabilidade ou contador da empresa, responda APENAS: "Opa, perdão! Achei que fosse o celular direto da loja. Vou tentar no telefone deles. Obrigado!" e retorne ESTRITAMENTE a tag [CONTADOR].

9. NÚMERO ERRADO / EX-SÓCIO: Se a pessoa disser que não conhece a empresa, que vendeu o negócio, ou que não é a pessoa que você procura, responda APENAS: "Puxa, peço desculpas pelo incômodo! O cadastro devia estar desatualizado. Um abraço e boa semana!" e retorne ESTRITAMENTE a tag [ENGANO].
---

### 4. A LINHA DO TEMPO DA VENDA (SPIN SELLING)
Antes de gerar qualquer resposta, identifique o estágio atual e avance APENAS UM por vez.

[ESTÁGIO 0 — QUALIFICAÇÃO DO INTERLOCUTOR]
Gatilho: Primeira resposta do lead ao contato inicial.
Objetivo: confirmar se é o decisor ANTES de qualquer pitch.

CENÁRIO A — É o decisor ("sou eu", "pode falar", "sim") OU demonstrou curiosidade ("o que é?", "como assim?", "explica"):
→ Vá direto ao ESTÁGIO 1.
Curiosidade = decisor confirmado implicitamente. Vá direto ao ESTÁGIO 1.
Exemplo: "Que bom! A ${concessionariaLocal} não costuma avisar, mas vem cobrando uma tarifa que já podia ter caído. A conta de luz aí costuma passar de ${ancoraConta}?"

CENÁRIO B — É gatekeeper ("não sou eu", "aqui é a recepção", "não é comigo", "ele não está", "não tenho essa informação"):
→ "Entendi! Como é sobre redução de custo na conta de energia, o ideal é falar com quem cuida disso. [QUEBRA] Consegue me passar o WhatsApp do responsável?"
→ Se recusar: "Sem problema! Qualquer coisa, estou por aqui." e ENCERRE.

NUNCA inicie o ESTÁGIO 1 sem o interlocutor confirmado.

[ESTÁGIO 1 — MICRO-RAPPORT E A DOR]
Gatilho: Decisor confirmado e respondeu qualquer coisa ("pago cheio", "como assim?", "não sei").
Ação: Valide o tempo dele no Balão 1. No Balão 2, gere o FOMO (medo de ficar pra trás) revelando que a concessionária lucra no silêncio, e faça a pergunta de qualificação.
Balão 1: "Show. Sei que a rotina aí na ${nomeEmpresa} deve ser corrida, então vou direto ao ponto pra não tomar seu tempo."
[QUEBRA]
Balão 2: "A ${concessionariaLocal} não avisa porque pra eles é melhor que empresas como a de vcs continuem pagando a tarifa cheia sem saber. Só pra confirmar se vcs têm o perfil pra isenção, a conta aí costuma passar de ${ancoraConta}?"

[ESTÁGIO 2 — IMPLICAÇÃO / A DOR]
Gatilho: Lead informou o valor aproximado da conta.
Ação: PONTE EMOCIONAL EM 2 CAMADAS (uma de cada vez)

CAMADA 1 - Cálculo preciso + Pergunta retórica:
Calcule 20% do valor que o lead informou.
Exemplo: "Quem paga tarifa cheia nessa faixa tá deixando uns R$ 300 na mesa todo mês — são R$ 3.600 no ano indo pro bolso da ${concessionariaLocal}. [QUEBRA] Vcs já tinham parado pra calcular isso?"
(AGUARDE A RESPOSTA, NUNCA PASSE PARA A CAMADA 2 SEM O LEAD RESPONDER).

CAMADA 2 - SE o lead concordar com a dor ("nossa", "não", "muito", "é mesmo"):
ENTÃO agrave com escala temporal:
"Pois é. Se a gente jogar isso pros próximos 3 anos, o rombo no caixa vira um absurdo. A ${concessionariaLocal} não avisa porque quanto menos gente souber, melhor pra eles. [QUEBRA] Faz sentido a gente ver se a ${nomeEmpresa} se encaixa pra isenção?"

[ESTÁGIO 3 — SOLUÇÃO] 🔥 MELHORADO
Gatilho: Lead concordou com a dor E disse que faz sentido ver a isenção.
Ação: MICRO-CONVERSÃO antes do áudio.
 
PERGUNTA MICRO-CONVERSÃO:
"Perfeito! Pra simular certinho, consegue me passar o valor aproximado que vem na conta? Pode ser um valor médio dos últimos 3 meses."
 
[SE JÁ INFORMOU O VALOR NO ESTÁGIO 2, PULE PARA O ÁUDIO]
 
Após receber a confirmação, ENTÃO apresente o áudio:
- "Como funciona?" → [AUDIO_COMO_FUNCIONA] [QUEBRA] "Consegue me mandar uma foto da fatura de energia? Já deixo a simulação da ${nomeEmpresa} pronta."
- "É seguro?" / "É golpe?" → [AUDIO_SEGURANCA] [QUEBRA] "Tem a fatura aí fácil pra eu já preparar os números?"
- "Precisa de placa?" / "Tem obra?" → [AUDIO_OBRAS_PLACAS] [QUEBRA] "Com essa info da conta, consigo te mostrar a economia exata. Consegue mandar?"
 
IMPORTANTE: SEMPRE peça a fatura ANTES do Calendly. Split de fricção aumenta conversão.
 
[ESTÁGIO 4 — AGENDAMENTO]
Gatilho: Lead mandou a fatura OU concordou em mandar.

ETAPA 1 - Confirmação de ENVIO (não recebimento):
SE lead mandou foto/PDF da fatura:
→ "Perfeito! Recebi a fatura aqui. Vou rodar a simulação e em 15 minutos a gente consegue ver o valor exato da ${nomeEmpresa}. [QUEBRA] Semana que vem funciona melhor pra vc, ou já essa semana dá?"

SE lead disse "vou mandar" mas NÃO mandou ainda:
→ "Show! Fica fácil pra mim se conseguir mandar agora. Pode ser print da tela mesmo, não precisa do PDF. [QUEBRA] Enquanto isso, prefere agendar pra semana que vem ou essa semana?"

ETAPA 2 - Após lead escolher período (ex: "semana que vem"):
"Show! Deixei pré-anotado aqui pro início da semana que vem."
 
ETAPA 3 - Calendly com escassez:
[QUEBRA] "Pra garantir o horário na minha agenda e não perdermos o espaço, só escolhe o dia e hora exata aqui: https://calendly.com/marlonlotici6/30min
Obs: Tenho só 2 vagas abertas pra semana que vem."
 
CRÍTICO: NÃO mande o Calendly antes da fatura. NÃO peça fatura e Calendly na mesma mensagem.
 
[ESTÁGIO 5 — FECHAMENTO OFICIAL]
Gatilho: Lead agendou no Calendly (webhook confirmou).
Ação: Confirmação + reforço.
"Agendamento confirmado! Recebi aqui. Nos vemos [dia] às [hora]. Vou deixar a simulação da ${nomeEmpresa} pronta. Até lá! 🚀"
 
---
 
### 4. VARIAÇÕES DE ABERTURA OTIMIZADAS 🔥 NOVO
 
A V1 teve 15% de resposta vs 9% das outras. Aplicamos os princípios dela em todas:
 
PRINCÍPIOS DA V1:
✅ Curiosidade imediata ("vi algo", "tem uma info")
✅ Validação social implícita ("mapeamento", "cruzei cadastro")
✅ Tom de favor, não venda ("achei que valia te passar")
✅ Pergunta suave ("Vc cuida?" vs imperativo)
 
Esses princípios devem estar em TODAS as aberturas.
 
---
 
### 5. DETECTOR DE SINAIS DE ABANDONO 🔥 NOVO
 
Se detectar os seguintes padrões, ajuste a abordagem:
 
SINAL 1 - "Depois eu vejo" / "Vou pensar":
Não aceite passivamente. Responda:
"Tranquilo! Só pra registrar aqui: a cota da região tem mais 3 vagas. Se quiser garantir antes de avaliar com calma, são só 15 minutos. [QUEBRA] Posso deixar reservado pra quinta de manhã?"
 
SINAL 2 - Lead respondeu mas não mandou fatura após sua solicitação:
Se a última mensagem sua pediu fatura e o lead respondeu outra coisa, reforce:
"Opa, conseguiu achar a conta aí? Com ela consigo te mostrar o número exato."
 
SINAL 3 - Lead viu Calendly mas não agendou:
[Isso virá via webhook - não precisa de lógica aqui, mas documente]
 
---

### 6. OBJEÇÕES
1. "MANDA POR E-MAIL" / "MANDA MATERIAL": "Posso sim! [QUEBRA] Mas o relatório fica bem mais completo quando a gente abre o simulador junto — são 15 minutos. Fica melhor amanhã cedo ou tarde?"
2. "NÃO TENHO TEMPO": "Entendo! São literalmente 15 minutos quando der melhor pra vc. [QUEBRA] Semana que vem funciona?"
3. "DEIXA EU PENSAR" / "VOU VER COM O SÓCIO": "Claro! [QUEBRA] Só pra registrar: a cota da região da ${nomeEmpresa} tem mais 3 vagas. Se quiser garantir antes, são só 15 minutos. Amanhã cedo ou tarde?"
4. "QUANTO CUSTA?": "Zero custo de adesão — o desconto vem direto na fatura todo mês. [QUEBRA] Pra ver o valor exato da ${nomeEmpresa}, preciso de 15 minutos. Amanhã funciona?"
5. [REVERSAO_TENTADA] no histórico + nova recusa: encerre com cordialidade. Não tente de novo.

---

### 7. PROVA SOCIAL E DESCONTOS REGIONAIS
- Prova social (máx 1x por conversa): "Só aqui no ${bairroLead}, mapeamos comércios similares economizando entre R$ 200 e R$ 600 por mês — sem obra e sem fidelidade."
- Âncora de desconto: "até 20% de redução". Não detalhe as frações a menos que o lead pergunte.
- Por estado: MS/MT/GO/PA (12-15%), PR (15%), SC/RS (10-15%), PE/BA/CE/MG (25% primeiros 2 meses).

---

### 8. DADOS DO LEAD
Nome: ${nomeLead}
Empresa: ${nomeEmpresa}
Localização: ${bairroLead}
Perfil: ${perfilComportamental}
${reversaoJaTentada}
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
                temperature: 0.3,
                max_tokens: 180,
                presence_penalty: 0.1,
                frequency_penalty: 0.15
            });
            
            let respostaDaIA = chatCompletion.choices[0].message.content;
            respostaDaIA = respostaDaIA.replace(/[\*_~`]/g, '');
            return respostaDaIA;
            
        } catch (e) {
            console.error(`❌ [GROQ] Tentativa ${tentativa}/${MAX_TENTATIVAS} falhou para ${nomeLead}: ${e.message}`);
            
            if (tentativa < MAX_TENTATIVAS) {
                const espera = tentativa * 3000;
                console.log(`⏳ [GROQ] Aguardando ${espera/1000}s antes de tentar novamente...`);
                await new Promise(resolve => setTimeout(resolve, espera));
            }
        }
    }
    
    console.error(`🔴 [GROQ] Todas as ${MAX_TENTATIVAS} tentativas falharam para ${nomeLead}. Retornando null.`);
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
        console.log(`🎙️ [TTS] Gerando áudio Opus para ${lead.name}...`);
        
        await sock.sendPresenceUpdate('recording', remoteJid);
        
        const buffer = await gerarAudioTTS(texto);
        
        // O mimetype correto e o formato Opus impedem o Erro 400 da Meta
        await sock.sendMessage(remoteJid, {
            audio: buffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true  // Faz aparecer o microfone azul de "gravado na hora"
        });

        // Salva no histórico para a IA saber que já usou áudio
        await db.saveMessage(lead.whatsapp_id, 'assistant', `[AUDIO_TTS] ${texto}`, instanceId);
        console.log(`✅ [TTS] Áudio enviado com sucesso para ${lead.name}`);
        
        return true;
    } catch (err) {
        console.error(`❌ [TTS] Falha crítica no áudio:`, err.message);
        return false; // Retornar false aqui joga a execução de volta para o envio de texto
    }
}
// ============================================================================
// 🧠 NÚCLEO UNIFICADO DE RESPOSTA — elimina duplicação entre processarMensagem
// e processarMensagemManual. Toda lógica de áudio e envio vive aqui.
// ============================================================================
async function filtrarEEnviarResposta(sock, remoteJid, resposta, historico, lead, instanceId) {
    if (!resposta) return;

    // ── 1. INTERCEPTADOR [ROBO] ULTRA-BLINDADO (Pega qualquer variação, incluindo ROBÔ com acento) ──
    // Detecta o sinal mas NÃO silencia imediatamente — primeiro verifica se há despedida a enviar
    const sinalizouEncerramento = /\[?\s?ROB[OÔô]\s?\]?/i.test(resposta);

    const sinalizouContador = /\[?\s?CONTADOR\s?\]?/i.test(resposta);
    if (sinalizouContador) resposta = resposta.replace(/\[?\s?CONTADOR\s?\]?/gi, '').trim();

    const sinalizouEngano = /\[?\s?ENGANO\s?\]?/i.test(resposta);
    if (sinalizouEngano) resposta = resposta.replace(/\[?\s?ENGANO\s?\]?/gi, '').trim();

    if (sinalizouEncerramento) {
        // Remove a tag do texto — o lead nunca deve ver [ROBO] ou [ROBÔ]
        resposta = resposta.replace(/\[?\s?ROB[OÔô]\s?\]?/gi, '').trim();

        if (!resposta || resposta.trim().length === 0) {
            // Autoresposta pura (IA só retornou a tag): silencia completamente
            console.log(`🤖 [SILÊNCIO] Autoresposta detectada para ${lead.name}. Sem texto — IA silenciada.`);
            // FIX: Troca a tag para o Vigia ignorar e PAUSA o lead no banco
            await db.saveMessage(lead.whatsapp_id, 'user', `[AUTORESPOSTA] Robô detectado, IA silenciada.`, instanceId);
            await supabase.from('leads').update({ is_paused: true }).eq('id', lead.id);
            return;
        }

        // Há texto restante (ex: despedida hand-off): envia a mensagem e pausa depois
        console.log(`🤖 [HAND-OFF] IA sinalizou encerramento para ${lead.name}. Enviando despedida antes de pausar.`);
    }
    const memoriaHistorico = JSON.stringify(historico);

   
    // ── 4. SE A IA GEROU APENAS TAG (texto ficou vazio após remoção) ─────────
    if (resposta.trim().length === 0) return;

         // ── 4.5. PARSER DE ESTÁGIO E LIMPEZA TOTAL (PROTEÇÃO V13) ─────────────────
    // Captura variações: [ESTAGIO:0], [Estágio: 0], estágio 0, Estagio:0
    const regexEstagioGlobal = /\[?EST[AÁ]GIO:?\s?(\d)\]?/gi;
    
    // Executa o match para pegar o número antes de limpar o texto
    const matchEstagio = regexEstagioGlobal.exec(resposta);

    if (matchEstagio) {
        const novoEstagio = parseInt(matchEstagio[1]);
        const tempUpdate = novoEstagio >= 3 ? 'hot' : novoEstagio >= 1 ? 'warm' : 'cold';
        
        // Atualiza o Supabase
        await supabase.from('leads').update({ 
            current_stage: novoEstagio,
            lead_temperature: tempUpdate
        }).eq('id', lead.id);
        
        console.log(`📊 [FUNIL] ${lead.name} sincronizado para estágio ${novoEstagio}`);
    }

    // A MÁGICA: Remove TODA e QUALQUER menção a estágio do texto antes do envio
    resposta = resposta.replace(regexEstagioGlobal, '').trim();
    // Proteção extra contra IA "conversadeira" que escreve fora dos padrões
    resposta = resposta.replace(/est[aá]gio\s?\d/gi, '').trim();
    resposta = resposta.replace(/tag\s?[:]\s?\d/gi, '').trim();

 // ── 5. FATIADOR E SIMULADOR HUMANO DE DIGITAÇÃO ──────────────────────────
    const mensagensSplit = resposta
        .split('[QUEBRA]')
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .slice(0, 2);

    // ── DECISÃO TTS ──────────────────────────────────────────────────────────
    const ultimaMsgLead = historico.filter(m => m.role === 'user').slice(-1)[0];
    const leadMandouAudio = ultimaMsgLead?.content?.startsWith('(Áudio)');

    const respostaTexto = mensagensSplit.join(' ').toLowerCase();
    const estaNoEstagio3ou4 = (
        respostaTexto.includes('como funciona') ||
        respostaTexto.includes('sem obra') ||
        respostaTexto.includes('simulador') ||
        respostaTexto.includes('calendly') ||
        respostaTexto.includes('30 minutos') ||
        respostaTexto.includes('amanhã')
    );
    const disparoEspontaneo = estaNoEstagio3ou4 && Math.random() < 0.30;

    const audiosRecentes = historico
        .filter(m => m.role === 'assistant' && m.content?.startsWith('[AUDIO_TTS]'))
        .length;
    const podeUsarTTS = audiosRecentes < 2;
    const usarTTS = podeUsarTTS && (leadMandouAudio || disparoEspontaneo);

    if (usarTTS) {
        const textoParaAudio = mensagensSplit.join('. ');
        console.log(`🎙️ [TTS] Modo ${leadMandouAudio ? 'espelho' : 'espontâneo'} ativado para ${lead.name}`);
        const enviouAudio = await enviarAudioTTS(sock, remoteJid, textoParaAudio, lead, instanceId);
        if (enviouAudio) return;
        console.log(`⚠️ [TTS] Fallback para texto após falha no áudio`);
    }

    for (let i = 0; i < mensagensSplit.length; i++) {
        const trecho = mensagensSplit[i];
        const tempoDigitacao = (trecho.length * 80) + 4000;

        await sock.sendPresenceUpdate('composing', remoteJid);
        await delay(Math.max(5000, Math.min(tempoDigitacao, 14000)));

        await enviarMensagemIA(sock, remoteJid, { text: trecho });
        await db.saveMessage(lead.whatsapp_id, 'assistant', trecho, instanceId);

        if (i < mensagensSplit.length - 1) {
            await sock.sendPresenceUpdate('paused', remoteJid);
            await delay(Math.random() * 3000 + 3500);
        }
    }

    // ── 6. DETECTOR DE REVERSÃO DE OBJEÇÃO ──────────────────────────────────
    const respostaFinal = mensagensSplit.join(' ').toLowerCase();
    const sinaisDeReversao = [
        'só por curiosidade',
        'só curiosidade',
        'a conta aí passa',
        'a conta passa de',
        'antes de encerrar'
    ];
    const tentouReverter = sinaisDeReversao.some(s => respostaFinal.includes(s));

    if (tentouReverter && !lead.objection_reversed) {
        console.log(`🔄 [REVERSÃO] IA tentou reverter objeção de ${lead.name}. Marcando no banco...`);
        await supabase.from('leads').update({ objection_reversed: true }).eq('id', lead.id);
        await db.saveMessage(lead.whatsapp_id, 'assistant', '[REVERSAO_TENTADA]', instanceId);
    }

    // ── 7. PAUSA PÓS HAND-OFF ────────────────────────────────────────────────
    if (sinalizouEncerramento) {
        await supabase.from('leads').update({ is_paused: true }).eq('id', lead.id);
        console.log(`⏸️ [PAUSA HAND-OFF] Conversa com ${lead.name} pausada após despedida enviada.`);

    }

// ── 8. DETECTOR DE NÚMERO DO DECISOR ─────────────────────────────────────
    // Se a IA sinalizou hand-off E há um número no texto da conversa, salva e dispara
    if (sinalizouEncerramento) {
        // Busca número brasileiro na última mensagem do usuário (não na resposta da IA)
        const ultimaMsgUsuario = historico
            .filter(m => m.role === 'user')
            .slice(-1)[0]?.content || '';

        const regexTelefone = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/g;
        const numerosEncontrados = ultimaMsgUsuario.match(regexTelefone);

        if (numerosEncontrados && numerosEncontrados.length > 0) {
            const numeroRaw = numerosEncontrados[0];
            console.log(`📱 [DECISOR] Número detectado na conversa: ${numeroRaw}. Iniciando captura...`);

            // Salva o decisor no banco linkado à empresa do lead atual
            const novoDecisor = await salvarDecisor(numeroRaw, lead, instanceId);

            if (novoDecisor && sdrEventsGlobal) {
                // Delay humanizado antes de chamar o decisor (entre 1 e 3 minutos)
                const delayMs = Math.floor(Math.random() * 120000) + 60000;
                console.log(`⏳ [DECISOR] Aguardando ${Math.round(delayMs/1000)}s antes de chamar o decisor...`);

                setTimeout(() => {
                    console.log(`🔔 [DECISOR] Acordando motor para chamar decisor da ${lead.name}...`);
                    sdrEventsGlobal.emit('NOVO_LEAD_DISPONIVEL', instanceId);
                }, delayMs);
            }
        }
    }
            // ── 9. EJEÇÃO E TOMBAMENTO (CONTADOR OU ENGANO) ──────────────────────────
    if (sinalizouContador || sinalizouEngano) {
        const motivo = sinalizouContador ? "contador" : "ex-sócio/engano";
        console.log(`🔄 [TOMBAMENTO] Lead ${lead.name} caiu no ${motivo}. Invertendo gavetas...`);
        
        if (!lead.backup_tried && lead.backup_whatsapp_id) {
            // Inverte o número pro Maps e devolve pra fila como 'new'
            await supabase.from('leads').update({
                whatsapp_id: lead.backup_whatsapp_id,
                phone: lead.backup_phone,
                backup_tried: true,
                status: 'new', 
                is_paused: false // Garante que a IA não fique travada no novo número
            }).eq('id', lead.id);
            console.log(`✅ [TOMBAMENTO] Concluído! Lead voltará para a fila no número do Maps.`);
        } else {
            // Se já tentou o backup ou não tem, o lead morre de vez.
            await supabase.from('leads').update({ status: 'invalid' }).eq('id', lead.id);
            console.log(`💀 [DESCARTE] Sem número reserva para ${lead.name}.`);
        }
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
        // 🎯 OPP #3: Atualiza temperatura quando lead responde pela primeira vez
        if (lead.lead_temperature === 'cold' || !lead.lead_temperature) {
            await supabase.from('leads').update({ lead_temperature: 'warm' }).eq('id', lead.id);
        }
        const histRaw = await db.getHistory(lead.whatsapp_id, instanceId);
        const historico = histRaw.map(m => ({ role: m.role, content: m.content }));
        const instanceData = await getRegrasEmCache(instanceId);
        
        let resposta = await gerarRespostaIA(historico, lead, instanceData);
        await filtrarEEnviarResposta(sock, remoteJid, resposta, historico, lead, instanceId);

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
            let currentLeadId = null; 
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
                if (!dentroDaJanelaDeDisparo()) {
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

                // 👇 A GRANDE MUDANÇA: O BREAK QUE SALVA SEU BOLSO 👇
                if (!lead) {
                    console.log(`🌕 [MOTOR HÍBRIDO] Fila limpa para ${config.nome}. Repouso absoluto (0 Egress).`);
                    break; // 🛑 HÍBRIDO: Não tem chumbo, ele não espera 5 min, ele desliga!
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
                    console.log(`🌙 [METAS] ${config.nome} atingiu o limite de ${config.limite}. Dormindo.`);
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
                if (hist && hist.length > 0) {
                    console.log(`⏩ [PULO RÁPIDO] Lead ${lead.name} já tem histórico. Retornando ao status contact.`);
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
console.log(`🚀 [DISPARANDO] ${config.nome} enviando saudação para ${lead.name}...`);
await instancia.sock.sendPresenceUpdate('composing', cleanJid);
await delay(Math.random() * 4000 + 4000);
await instancia.sock.sendPresenceUpdate('paused', cleanJid);

let primeiroNomeDono = null;
if (lead.dono && lead.dono.trim().length > 2) {
    primeiroNomeDono = lead.dono.trim().split(' ')[0].toLowerCase();
    primeiroNomeDono = primeiroNomeDono.charAt(0).toUpperCase() + primeiroNomeDono.slice(1);
}

const ufLead = lead.estado || null;
const concessionariaLocal = MAPA_CONCESSIONARIAS[ufLead] || 'concessionária de energia';
const nomeEmpresa = lead.name
    ? lead.name.replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim()
    : 'sua empresa';

// ── BALÃO ÚNICO: curiosidade + qualificação casual numa só mensagem ──
let variacoesAbertura;
const saudacao = primeiroNomeDono ? `Oi ${primeiroNomeDono}` : 'Oi, tudo bem?';

if (lead.is_decisor && lead.origin_company_name) {
    variacoesAbertura = [
        `${saudacao}, o pessoal da ${lead.origin_company_name} me passou seu contato. Vi algo sobre a conta de energia de vcs que achei que valia compartilhar — vc que cuida dessa parte?`,
        `${saudacao}, falei com a equipe da ${lead.origin_company_name} e me indicaram vc. Tem uma informação sobre a ${concessionariaLocal} que a maioria das empresas não sabe — vc cuida das contas fixas aí?`,
    ];
} else {
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
                falhasConsecutivas = 0;

            } catch (errInner) {
                // SEU CATCH ORIGINAL DE FALHAS CONSECUTIVAS
                console.error(`❌ Erro no motor do chip ${instanceId}:`, errInner.message);
                if (currentLeadId) {
                    leadsEmProcessamento.delete(currentLeadId);
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
    }
}
// ============================================================================
// 🔄 LOOP TRIPLO DE RECUPERAÇÃO E FOLLOW-UP (OTIMIZADO)
// ============================================================================
// 🔒 TRAVA DE SEGURANÇA GLOBAL: Coloque esta linha fora da função, no topo do arquivo
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

        console.log("🕵️ [VIGIA DE CONVERSAS] Escaneando conversas perdidas e follow-ups...");

        // ====================================================================
        // 🌟 1. RECUPERAÇÃO DE FALHAS (O Bot ignorou o cliente)
        // ====================================================================
        const { data: leadsAtivos } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, is_paused')
            .eq('status', 'contact')
            .eq('is_paused', false)
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
                                await processarMensagemManual(instancia.sock, l);
                            }
                        }
                    }
                } catch (errLeadAtivo) {
                    console.error(`❌ Erro ao recuperar ${l.name}:`, errLeadAtivo.message);
                }
            }
        }

        // ====================================================================
        // 🚀 2. FOLLOW-UP ÚNICO (D1) + TOMBAMENTO POR SILÊNCIO
        // ====================================================================
        const agora = Date.now();
        const UM_DIA = 24 * 60 * 60 * 1000;

        const { data: leadsFollowUp } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, dono, followup_count, last_contact_at, backup_phone, backup_whatsapp_id, backup_tried')
            .eq('status', 'contact')
            .eq('calendly_booked', false)
            .lt('followup_count', 2) 
            .order('last_contact_at', { ascending: true })
            .limit(15);

        if (leadsFollowUp) {
            for (const lf of leadsFollowUp) {
                try {
                    const { data: temResposta } = await supabase.from('messages').select('id').eq('whatsapp_id', lf.whatsapp_id).eq('role', 'user').limit(1);
                    if (temResposta && temResposta.length > 0) continue; 

                    const diasPassados = (agora - new Date(lf.last_contact_at).getTime()) / UM_DIA;
                    if (diasPassados < 1) continue; 

                    const instancia = sessions.get(lf.instance_id);
                    if (!instancia || !instancia.ready) continue;

                    const followupAtual = lf.followup_count || 0;

                    if (followupAtual === 0) {
                        let primeiroNome = lf.dono && lf.dono.trim().length > 2 ? lf.dono.trim().split(' ')[0] : 'Opa';
                        primeiroNome = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);
                        const nomeEmpresa = (lf.name || 'empresa').replace(/\s(LTDA|ME|EIRELI|S\.A|LIMITED)\b/gi, '').trim();

                        const msgFollowUp = `${primeiroNome}, conseguiu dar uma olhada na mensagem acima? Como a gente tem poucas vagas com isenção pra região, queria confirmar se faz sentido pra ${nomeEmpresa} antes de liberar o espaço.`;

                        console.log(`🔔 [FOLLOW-UP D1] Disparando para ${lf.name}`);
                        await instancia.sock.sendPresenceUpdate('composing', lf.whatsapp_id);
                        await delay(5000);
                        await enviarMensagemIA(instancia.sock, lf.whatsapp_id, { text: msgFollowUp });
                        await db.saveMessage(lf.whatsapp_id, 'assistant', msgFollowUp, lf.instance_id);

                        await supabase.from('leads').update({ followup_count: 1, last_contact_at: new Date().toISOString() }).eq('id', lf.id);
                        await delay(8000);
                    } 
                    else if (followupAtual === 1) {
                        if (!lf.backup_tried && lf.backup_whatsapp_id) {
                            console.log(`🔄 [SILÊNCIO TOTAL] Lead ${lf.name} ignorou o D1. Tombando para backup...`);
                            await supabase.from('leads').update({
                                whatsapp_id: lf.backup_whatsapp_id, 
                                phone: lf.backup_phone, 
                                backup_tried: true, 
                                status: 'new',
                                followup_count: 0 
                            }).eq('id', lf.id);
                        } else {
                            console.log(`💀 [DESCARTE] Lead ${lf.name} sem resposta e sem reserva. Movendo para DEAD.`);
                            await supabase.from('leads').update({ status: 'dead', lead_temperature: 'dead' }).eq('id', lf.id);
                        }
                    }
                } catch (errFollow) { console.error(`❌ Erro Follow-up ${lf.name}:`, errFollow.message); }
            }
        }

        // ====================================================================
        // 👤 3. RETOMADA APÓS INTERVENÇÃO HUMANA (10 MINUTOS)
        // ====================================================================
        const { data: leadsPausados } = await supabase
            .from('leads')
            .select('id, name, whatsapp_id, instance_id, is_paused, manual_pause, last_human_interaction')
            .eq('is_paused', true);

        if (leadsPausados) {
            for (const lp of leadsPausados) {
                if (!lp.last_human_interaction || lp.manual_pause) continue; 

                const dezMinutosEmMs = 10 * 60 * 1000; 
                const ultimaInteracao = new Date(lp.last_human_interaction).getTime();
                const diff = Date.now() - ultimaInteracao;

                if (diff > dezMinutosEmMs) {
                    if (iaRespondendo.has(lp.whatsapp_id)) continue;
                    
                    console.log(`🔄 [RETOMADA] Tempo de humano esgotado para ${lp.name}. Voltando para IA.`);
                    await supabase.from('leads').update({ is_paused: false }).eq('id', lp.id);

                    const instancia = sessions.get(lp.instance_id);
                    if (instancia && instancia.ready) {
                        await processarMensagemManual(instancia.sock, lp);
                    }
                }
            }
        }

    } catch (errGeral) {
        console.error("❌ [ERRO CRÍTICO] Falha no motor de recuperação:", errGeral.message);
    } finally {
        // 🔓 LIBERA O BLOQUEIO E AGENDA O PRÓXIMO CICLO
        vigiaEmExecucao = false; 
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

// 👇 Adicione esta variável de controle aqui fora

let loopIniciado = false;

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

            // ⏰ VIGIA NOTURNO: Varredura de segurança a cada 30 minutos
            setInterval(() => {
                console.log("⏰ [VIGIA] Varredura de segurança ativada...");
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
                    
                    const instancia = sessions.get(instanceId);
                    if (instancia && instancia.ready) {
                        const dataObjeto = new Date(dataEvento);
                        const dataFormatada = dataObjeto.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                        const horaFormatada = dataObjeto.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                        const feedbackPrompt = `O lead ${lead.name} acabou de agendar a reunião para o dia ${dataFormatada} às ${horaFormatada}. Confirme que recebeu o agendamento com sucesso, demonstre empolgação e reforce o pedido da foto da fatura de energia caso ele ainda não tenha mandado (isso é fundamental para a reunião). Seja muito curto e direto.`;

                        const historico = [{ role: 'system', content: feedbackPrompt }];
                        const instanceData = await getRegrasEmCache(instanceId);
                        const resposta = await gerarRespostaIA(historico, lead, instanceData);

                        if (resposta) {
                            console.log(`🤖 [FEEDBACK] IA gerou confirmação para ${lead.name}. Enviando...`);
                            await filtrarEEnviarResposta(instancia.sock, lead.whatsapp_id, resposta, historico, lead, instanceId);
                        }
                    } else {
                        console.log(`⚠️ [WEBHOOK] Chip ${instanceId} não está pronto para enviar feedback.`);
                    }
                });
            }
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
    
        if (data) {
            await startInstance(data.id, data.name); 
            // 👇 MELHORIA: Dá o arranque imediato assim que um chip novo é criado no painel
            processarFilaDeAtaque(data.id);
        }
        return data; 
    }
};