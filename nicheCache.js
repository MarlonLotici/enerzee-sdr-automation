/**
 * nicheCache.js — Cache de Inteligência de Nicho (Redis L1 + Supabase L2)
 *
 * Fluxo de leitura (getNicheData):
 *   Redis hit  → retorna imediatamente
 *   Redis miss → chama nicheAgent → salva Supabase → popula Redis → retorna
 *
 * Boot (inicializarCache):
 *   Carrega todos os nichos do Supabase e aquece o Redis antes do SDR ligar.
 */

require('dotenv').config();
const Redis       = require('ioredis');
const db          = require('./database');
const nicheAgent  = require('./agents/nicheAgent');

// Cliente Redis dedicado ao cache — separado do cliente BullMQ
// (BullMQ exige maxRetriesPerRequest: null, o que trava operações de get/set normais)
const redisCache = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 3,
    enableReadyCheck:     false,
    lazyConnect:          true,
});

redisCache.on('error', (err) => {
    console.error('[NICHE-CACHE] Redis erro:', err.message);
});

const PREFIXO_CHAVE = 'nicho:';
const TTL_SEGUNDOS  = 7 * 24 * 60 * 60; // 7 dias — nichos mudam raramente

// Normaliza o nome do nicho para slug consistente (mesmo padrão do database.js)
function slugify(nome) {
    return String(nome)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
}

/**
 * Aquece o cache Redis com todos os nichos já salvos no Supabase.
 * Deve ser chamado uma única vez no boot (initMultiTenancy no 4_sdr.js).
 */
async function inicializarCache() {
    try {
        await redisCache.connect();
        const nichos = await db.obterTodosNichos();

        if (!nichos.length) {
            console.log('[NICHE-CACHE] Nenhum nicho no banco ainda. Cache iniciado vazio.');
            return;
        }

        const pipeline = redisCache.pipeline();
        for (const n of nichos) {
            const chave   = PREFIXO_CHAVE + slugify(n.niche_name);
            const payload = JSON.stringify({
                equipamentos:  n.equipamentos,
                dor_principal: n.dor_principal,
                angulo_venda:  n.angulo_venda,
            });
            pipeline.set(chave, payload, 'EX', TTL_SEGUNDOS);
        }
        await pipeline.exec();

        console.log(`✅ [NICHE-CACHE] ${nichos.length} nichos carregados no Redis.`);
    } catch (err) {
        console.error('[NICHE-CACHE] Falha ao inicializar cache:', err.message);
    }
}

/**
 * Retorna a inteligência de venda para um nicho.
 * Garante que o dado sempre existe — aprendendo on-the-fly se necessário.
 *
 * @param {string} nicheName  Nome do nicho vindo do lead (ex: "Farmácia", "oficina mecânica")
 * @returns {{ equipamentos, dor_principal, angulo_venda }}
 */
async function getNicheData(nicheName) {
    if (!nicheName?.trim()) return null;

    const slug  = slugify(nicheName);
    const chave = PREFIXO_CHAVE + slug;

    // ── L1: Redis ──────────────────────────────────────────────────────────
    try {
        const cached = await redisCache.get(chave);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (errRedis) {
        console.warn('[NICHE-CACHE] Redis indisponível, caindo para L2:', errRedis.message);
    }

    // ── L2: Supabase (pode ter dado que o Redis perdeu por expiração/restart) ──
    try {
        const todos = await db.obterTodosNichos();
        const encontrado = todos.find(n => slugify(n.niche_name) === slug);
        if (encontrado) {
            const payload = {
                equipamentos:  encontrado.equipamentos,
                dor_principal: encontrado.dor_principal,
                angulo_venda:  encontrado.angulo_venda,
            };
            // Repopula Redis silenciosamente
            redisCache.set(chave, JSON.stringify(payload), 'EX', TTL_SEGUNDOS).catch(() => {});
            return payload;
        }
    } catch (errDb) {
        console.warn('[NICHE-CACHE] Supabase L2 falhou:', errDb.message);
    }

    // ── L3: nicheAgent — aprende o nicho pela primeira vez ─────────────────
    console.log(`🧠 [NICHE-CACHE] Nicho desconhecido: "${nicheName}". Gerando inteligência...`);
    try {
        const inteligencia = await nicheAgent.gerarInteligenciaNicho(nicheName);

        // Persiste no Supabase (fonte de verdade)
        await db.salvarInteligenciaNicho({ niche_name: slug, ...inteligencia });

        // Popula Redis para próximas consultas
        redisCache.set(chave, JSON.stringify(inteligencia), 'EX', TTL_SEGUNDOS).catch(() => {});

        console.log(`✅ [NICHE-CACHE] Nicho "${slug}" aprendido e persistido.`);
        return inteligencia;
    } catch (errAgent) {
        console.error(`❌ [NICHE-CACHE] Falha ao aprender nicho "${nicheName}":`, errAgent.message);
        return null;
    }
}

module.exports = { inicializarCache, getNicheData };
