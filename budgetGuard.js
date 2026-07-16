/**
 * BUDGET GUARD — teto de gasto/volume AGREGADO por conta (não só por chip).
 *
 * Motivação: `daily_limit` na tabela instances é estritamente POR CHIP. Não existia
 * nenhum teto que somasse envios/chamadas entre todos os chips de uma conta — um bug
 * em loop poderia estourar a fatura de Resend/Groq sem ninguém perceber. Este módulo
 * fecha essa lacuna com contadores diários por (conta, tipo) no Redis.
 *
 * Redis (via queue.js) em vez de tabela Supabase: INCR/EXPIRE é atômico entre chips
 * concorrentes, sobrevive a restart do processo Node, e não exige migration.
 *
 * Uso: checar `podeGastar` ANTES do gasto e `registrarGasto` DEPOIS do sucesso.
 * Limite 0/ausente = sem teto (preserva o comportamento atual até o operador optar por um).
 */

const { redisConnection } = require('./queue');
const { enviarAlerta } = require('./notifier');

// Data no fuso BRT (UTC-3) — o "dia" do orçamento vira à meia-noite de Brasília.
function _diaBRT() {
    const brt = new Date(Date.now() - 3 * 3600 * 1000);
    return brt.toISOString().slice(0, 10);
}

function _chave(userId, tipo) {
    return `budget:${tipo}:${userId}:${_diaBRT()}`;
}

// Segundos até o fim do dia BRT — TTL do contador, pra ele zerar sozinho a cada dia.
function _segundosAteFimDiaBRT() {
    const agoraBRT = new Date(Date.now() - 3 * 3600 * 1000);
    const fim = new Date(agoraBRT);
    fim.setUTCHours(23, 59, 59, 999);
    return Math.max(60, Math.ceil((fim - agoraBRT) / 1000));
}

// Evita repetir o alerta de "perto do teto" várias vezes no mesmo dia/conta/tipo.
const _jaAlertado = new Set();

/**
 * Retorna true se a conta ainda pode gastar deste tipo hoje.
 * @param {string} userId
 * @param {string} tipo   ex.: 'email', 'groq'
 * @param {number} limite teto diário; 0 ou ausente = sem teto (sempre true)
 */
async function podeGastar(userId, tipo, limite) {
    if (!userId || !limite || limite <= 0) return true;
    try {
        const usado = parseInt(await redisConnection.get(_chave(userId, tipo))) || 0;
        return usado < limite;
    } catch (err) {
        // Redis fora do ar não pode travar o motor — falha aberta (permite), só loga.
        console.error(`[BUDGET] Erro ao ler contador (${tipo}):`, err.message);
        return true;
    }
}

/**
 * Incrementa o contador após um gasto real bem-sucedido. Dispara alerta a ~85% do teto.
 * @returns {Promise<number>} total usado hoje após o incremento
 */
async function registrarGasto(userId, tipo, limite = 0, n = 1) {
    if (!userId) return 0;
    try {
        const chave = _chave(userId, tipo);
        const usado = await redisConnection.incrby(chave, n);
        if (usado === n) await redisConnection.expire(chave, _segundosAteFimDiaBRT());

        if (limite > 0 && usado >= limite * 0.85 && !_jaAlertado.has(chave)) {
            _jaAlertado.add(chave);
            enviarAlerta(
                `⚠️ Orçamento ${tipo.toUpperCase()} perto do teto`,
                `Conta ${String(userId).slice(0, 8)} usou ${usado}/${limite} ${tipo} hoje (BRT).`,
                15105570
            ).catch(() => {});
        }
        return usado;
    } catch (err) {
        console.error(`[BUDGET] Erro ao registrar gasto (${tipo}):`, err.message);
        return 0;
    }
}

async function consultar(userId, tipo) {
    try {
        return parseInt(await redisConnection.get(_chave(userId, tipo))) || 0;
    } catch {
        return 0;
    }
}

module.exports = { podeGastar, registrarGasto, consultar };
