/**
 * CALL SCHEDULER — agendamento automático de ligações via BullMQ `delay`.
 *
 * Primeira utilização real do `delay` do BullMQ no projeto (as filas de
 * queue.js existiam mas nunca usaram jobs futuros). Segue o mesmo padrão do
 * worker FilaMensagensIA em server.js: Queue + Worker sobre a redisConnection
 * compartilhada.
 *
 * Regras de disparo (negócio, ajustáveis — ver REGRAS abaixo):
 *  R1. Lead engajado (estágio 1-3) parado há 48h+ com follow-up já feito → liga.
 *  R2. Lead que recebeu link do Calendly (estágio 4+) e não marcou em 24h → liga.
 * Nunca: do_not_call, is_paused, 2+ tentativas já feitas, chip sem
 * use_voice_outbound, fora do horário comercial (empurra pra próxima janela).
 *
 * concurrency: 1 — uma ligação automática por vez, de propósito: outbound de
 * voz sem operador olhando não deve paralelizar (custo + risco reputacional).
 */

const { Queue, Worker } = require('bullmq');
const { createClient } = require('@supabase/supabase-js');
const { redisConnection } = require('../queue');
const voiceEngine = require('./voiceEngine');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const REGRAS = {
    HORAS_PARADO_ESTAGIO: 48,     // R1: horas sem resposta em estágio 1-3
    HORAS_SEM_MARCAR: 24,         // R2: horas desde o link do Calendly sem booking
    MAX_TENTATIVAS_AUTO: 2,
    INTERVALO_VARREDURA_MIN: 30,  // frequência do scan de leads elegíveis
};

const filaLigacoes = new Queue('FilaLigacoesIA', { connection: redisConnection });

let _iniciado = false;

function initCallScheduler() {
    if (_iniciado) return;
    _iniciado = true;

    new Worker('FilaLigacoesIA', async (job) => {
        const { leadId, instanceId } = job.data;
        console.log(`📞 [FILA-VOZ] Processando ligação automática para lead ${String(leadId).slice(0, 8)}`);
        const resultado = await voiceEngine.iniciarLigacao(instanceId, leadId, { trigger: 'auto' });

        // Caiu fora da janela (delay calculado envelheceu)? Reagenda em vez de descartar.
        if (!resultado.success && resultado.foraDoHorario) {
            await agendarLigacao(leadId, instanceId, 'reagendada-fora-horario');
            return;
        }
        if (!resultado.success) {
            console.warn(`⚠️ [FILA-VOZ] Ligação descartada: ${resultado.error}`);
        }
    }, { connection: redisConnection, concurrency: 1 });

    // Varredura periódica de leads elegíveis
    setInterval(() => {
        varrerLeadsElegiveis().catch(err => console.error('❌ [FILA-VOZ] Erro na varredura:', err.message));
    }, REGRAS.INTERVALO_VARREDURA_MIN * 60 * 1000);

    console.log('📞 [FILA-VOZ] Scheduler de ligações automáticas ativo (varredura a cada 30min).');
}

/** ms até a próxima janela comercial da instância (0 se já estamos dentro dela). */
function _delayAteJanelaComercial(rules) {
    const inicio = rules?.voice_calling_hour_start ?? 9;
    const fim = rules?.voice_calling_hour_end ?? 19;
    const agoraBRT = new Date(Date.now() - 3 * 3600 * 1000);
    const h = agoraBRT.getUTCHours();
    const diaSemana = agoraBRT.getUTCDay();

    const alvo = new Date(agoraBRT);
    if (diaSemana >= 1 && diaSemana <= 5 && h >= inicio && h < fim) return 0;

    // Avança até o próximo dia útil às `inicio` horas
    do {
        if (alvo.getUTCHours() >= inicio) alvo.setUTCDate(alvo.getUTCDate() + 1);
        alvo.setUTCHours(inicio, 0, 0, 0);
    } while (alvo.getUTCDay() === 0 || alvo.getUTCDay() === 6);

    return Math.max(0, alvo.getTime() - agoraBRT.getTime());
}

async function agendarLigacao(leadId, instanceId, motivo = '') {
    const { data: rules } = await supabase.from('instances').select('*').eq('id', instanceId).maybeSingle();
    if (!rules?.use_voice_outbound) return false;

    const delay = _delayAteJanelaComercial(rules);
    // jobId determinístico por lead → o BullMQ deduplica agendamentos repetidos sozinho
    await filaLigacoes.add('ligar', { leadId, instanceId, motivo }, {
        delay,
        jobId: `call-${leadId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
    });

    await supabase.from('leads').update({
        next_call_scheduled_at: new Date(Date.now() + delay).toISOString(),
    }).eq('id', leadId);

    console.log(`🗓️ [FILA-VOZ] Ligação agendada (${motivo || 'regra'}) para lead ${String(leadId).slice(0, 8)} em ${Math.round(delay / 60000)}min`);
    return true;
}

/**
 * Scan das regras R1/R2 sobre chips com use_voice_outbound ligado.
 * Deliberadamente conservador: pega no máximo 10 leads por varredura.
 */
async function varrerLeadsElegiveis() {
    const { data: instancias, error } = await supabase
        .from('instances')
        .select('*')
        .eq('use_voice_outbound', true);
    if (error || !instancias?.length) return;

    for (const inst of instancias) {
        const limiteParado = new Date(Date.now() - REGRAS.HORAS_PARADO_ESTAGIO * 3600 * 1000).toISOString();
        const limiteSemMarcar = new Date(Date.now() - REGRAS.HORAS_SEM_MARCAR * 3600 * 1000).toISOString();

        // R1: engajou (estágio 1-3), follow-up feito, parado há 48h+
        const { data: r1 } = await supabase
            .from('leads')
            .select('id')
            .eq('instance_id', inst.id)
            .eq('is_paused', false)
            .eq('do_not_call', false)
            .gte('current_stage', 1).lte('current_stage', 3)
            .gte('followup_count', 1)
            .lt('call_attempts_count', REGRAS.MAX_TENTATIVAS_AUTO)
            .lt('last_contact_at', limiteParado)
            .is('next_call_scheduled_at', null)
            .limit(5);

        // R2: recebeu o link (estágio 4+), não marcou em 24h
        const { data: r2 } = await supabase
            .from('leads')
            .select('id')
            .eq('instance_id', inst.id)
            .eq('do_not_call', false)
            .eq('calendly_booked', false)
            .gte('current_stage', 4)
            .lt('call_attempts_count', REGRAS.MAX_TENTATIVAS_AUTO)
            .lt('last_contact_at', limiteSemMarcar)
            .is('next_call_scheduled_at', null)
            .limit(5);

        const elegiveis = [...(r1 || []), ...(r2 || [])].slice(0, 10);
        for (const lead of elegiveis) {
            await agendarLigacao(lead.id, inst.id, 'varredura-automatica');
        }
    }
}

module.exports = { initCallScheduler, agendarLigacao, varrerLeadsElegiveis };
