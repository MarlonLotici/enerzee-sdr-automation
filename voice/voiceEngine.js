/**
 * VOICE ENGINE — orquestrador das ligações de voz da IA.
 *
 * Concentra tudo que acontece FORA do áudio em si: guardrails (do_not_call,
 * orçamento de minutos, horário comercial, teto diário), o disparo REST no
 * Twilio, o TwiML de conexão, o registro em `calls`, e o pós-ligação
 * (atualizar lead, enviar link do Calendly por WhatsApp/SMS, alertar Discord).
 *
 * Consultas em instances/leads usam select('*') de propósito: as colunas novas
 * de voz (add_voice_calling.sql) podem ainda não existir no banco — com '*' a
 * query não quebra e os guards tratam undefined como "recurso desligado".
 */

require('dotenv').config();
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { podeGastar, registrarGasto } = require('../budgetGuard');
const { enviarAlerta } = require('../notifier');
const { enviarSMS } = require('../smsService');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BUDGET_MINUTOS_DIA = parseInt(process.env.DAILY_VOICE_MINUTES_BUDGET) || 60;
const CUSTO_CENTS_POR_MIN = parseInt(process.env.VOICE_COST_CENTS_PER_MIN) || 25; // estimativa Twilio+Deepgram+ElevenLabs

// callId → contexto vivo da ligação (lead, regras, callbacks). TTL de limpeza
// cobre chamadas que nunca conectaram (falha antes do Media Stream abrir).
const _contextos = new Map();
const TTL_CONTEXTO_MS = 30 * 60 * 1000;

let _io = null;
let _getSdr = () => null;

function initVoiceEngine({ io, getSdr }) {
    _io = io;
    if (getSdr) _getSdr = getSdr;
}

function _twilioClient() {
    return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function _horaBRT() {
    return new Date(Date.now() - 3 * 3600 * 1000).getUTCHours();
}

function _diaUtilBRT() {
    const dia = new Date(Date.now() - 3 * 3600 * 1000).getUTCDay();
    return dia >= 1 && dia <= 5;
}

function _dentroHorarioComercial(rules) {
    const inicio = rules?.voice_calling_hour_start ?? 9;
    const fim = rules?.voice_calling_hour_end ?? 19;
    const h = _horaBRT();
    return _diaUtilBRT() && h >= inicio && h < fim;
}

function _telefoneE164(lead) {
    const digitos = String(lead.phone || lead.whatsapp_id || '').replace(/\D/g, '');
    if (digitos.length < 10) return null;
    return digitos.startsWith('55') ? `+${digitos}` : `+55${digitos}`;
}

function _emitir(userId, evento, dados) {
    _io?.to(`user:${userId}`).emit(evento, dados);
}

// ============================================================================
// DISPARO
// ============================================================================

/**
 * @param {string} instanceId
 * @param {string} leadId
 * @param {object} opcoes { trigger: 'manual'|'auto', force: bool (ignora horário no manual), userId }
 */
async function iniciarLigacao(instanceId, leadId, opcoes = {}) {
    const trigger = opcoes.trigger || 'manual';

    if (!process.env.PUBLIC_BASE_URL) {
        return { success: false, error: 'PUBLIC_BASE_URL não configurada — o Twilio precisa alcançar este servidor (use ngrok em dev).' };
    }
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
        return { success: false, error: 'Credenciais Twilio ausentes no .env.' };
    }
    if (!process.env.DEEPGRAM_API_KEY || !process.env.ELEVENLABS_API_KEY) {
        return { success: false, error: 'DEEPGRAM_API_KEY e/ou ELEVENLABS_API_KEY ausentes — necessárias para a conversa de voz.' };
    }

    const { data: rules } = await supabase.from('instances').select('*').eq('id', instanceId).maybeSingle();
    if (!rules) return { success: false, error: 'Instância não encontrada.' };

    const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
    if (!lead) return { success: false, error: 'Lead não encontrado.' };

    // ── Guardrails ──────────────────────────────────────────────────────────
    if (lead.do_not_call) {
        return { success: false, error: 'Lead pediu para não receber ligações (do_not_call).' };
    }

    const telefone = _telefoneE164(lead);
    if (!telefone) return { success: false, error: 'Lead sem telefone válido.' };

    if (trigger === 'auto') {
        if (!rules.use_voice_outbound) return { success: false, error: 'Chip com use_voice_outbound desligado.' };
        if (lead.is_paused) return { success: false, error: 'Lead pausado — automação não liga.' };
        if ((lead.call_attempts_count || 0) >= 2) return { success: false, error: 'Teto de 2 tentativas automáticas atingido.' };
    }

    if (!_dentroHorarioComercial(rules) && !(trigger === 'manual' && opcoes.force)) {
        const inicio = rules?.voice_calling_hour_start ?? 9;
        const fim = rules?.voice_calling_hour_end ?? 19;
        return { success: false, error: `Fora do horário comercial de ligações (${inicio}h-${fim}h BRT, seg-sex).`, foraDoHorario: true };
    }

    const userId = rules.user_id;
    if (!(await podeGastar(userId, 'voice_minutes', BUDGET_MINUTOS_DIA))) {
        return { success: false, error: `Orçamento diário de voz esgotado (${BUDGET_MINUTOS_DIA}min).` };
    }

    // Teto diário de ligações por instância (conta na tabela calls, dia BRT)
    const inicioDiaBRT = new Date();
    inicioDiaBRT.setUTCHours(3, 0, 0, 0); // 00:00 BRT = 03:00 UTC
    const { count: ligacoesHoje, error: erroContagem } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .eq('instance_id', instanceId)
        .gte('created_at', inicioDiaBRT.toISOString());

    if (erroContagem) {
        return { success: false, error: 'Tabela calls indisponível — execute a migração add_voice_calling.sql no Supabase.' };
    }
    const tetoDia = rules.max_calls_per_day ?? 20;
    if ((ligacoesHoje || 0) >= tetoDia) {
        return { success: false, error: `Teto diário de ${tetoDia} ligações do chip atingido.` };
    }

    // ── Registro + disparo ──────────────────────────────────────────────────
    const { data: callRow, error: erroInsert } = await supabase
        .from('calls')
        .insert({ lead_id: leadId, instance_id: instanceId, user_id: userId, trigger, status: 'queued' })
        .select()
        .single();
    if (erroInsert) {
        return { success: false, error: `Falha ao registrar ligação: ${erroInsert.message}` };
    }

    const callId = callRow.id;
    _contextos.set(callId, {
        callId, lead, rules, userId, trigger,
        io: _io,
        finalizada: false,
        streamConectou: false,
        aoFinalizar: (resumo) => finalizarLigacao(resumo),
    });
    setTimeout(() => _contextos.delete(callId), TTL_CONTEXTO_MS);

    _emitir(userId, 'call_status', { callId, leadId, leadName: lead.name, status: 'queued' });

    try {
        const base = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
        const chamada = await _twilioClient().calls.create({
            to: telefone,
            from: process.env.TWILIO_FROM_NUMBER,
            url: `${base}/voice/twiml/${callId}`,
            statusCallback: `${base}/voice/status/${callId}`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            timeout: 25, // segundos tocando antes de desistir (evita cair em caixa postal tardia)
        });

        await supabase.from('calls').update({ twilio_call_sid: chamada.sid, status: 'initiated', started_at: new Date().toISOString() }).eq('id', callId);
        await supabase.from('leads').update({
            last_call_at: new Date().toISOString(),
            last_call_status: 'initiated',
            call_attempts_count: (lead.call_attempts_count || 0) + 1,
        }).eq('id', leadId);

        console.log(`📞 [VOICE] Ligação ${callId.slice(0, 8)} disparada para ${telefone} (${trigger})`);
        _emitir(userId, 'call_status', { callId, leadId, leadName: lead.name, status: 'initiated' });

        return { success: true, callId, twilioSid: chamada.sid };
    } catch (err) {
        console.error(`❌ [VOICE] Twilio recusou a ligação:`, err.message);
        await supabase.from('calls').update({ status: 'failed', outcome: 'failed', ended_at: new Date().toISOString() }).eq('id', callId);
        _contextos.delete(callId);
        _emitir(userId, 'call_ended', { callId, leadId, outcome: 'failed', error: err.message });
        return { success: false, error: `Twilio: ${err.message}` };
    }
}

// ============================================================================
// TWIML + STATUS CALLBACK (rotas em server.js delegam pra cá)
// ============================================================================

function gerarTwiML(callId) {
    if (!_contextos.has(callId)) return null;
    const wssBase = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '').replace(/^https?:\/\//, 'wss://');
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wssBase}/media-stream/${callId}" />
    </Connect>
</Response>`;
}

function obterContexto(callId) {
    const ctx = _contextos.get(callId);
    if (!ctx || ctx.finalizada) return null;
    // Só o Media Stream chama isto — registrar que a chamada chegou a conectar
    ctx.streamConectou = true;
    return ctx;
}

async function aoStatusCallback(callId, body) {
    const ctx = _contextos.get(callId);
    const status = body?.CallStatus; // initiated/ringing/in-progress/completed/busy/no-answer/failed/canceled
    if (!status) return;

    if (['ringing', 'in-progress'].includes(status)) {
        await supabase.from('calls').update({ status }).eq('id', callId);
        if (ctx) _emitir(ctx.userId, 'call_status', { callId, leadId: ctx.lead?.id, leadName: ctx.lead?.name, status });
        return;
    }

    // Estados terminais SEM o Media Stream ter conectado (ninguém atendeu, ocupado, falha)
    if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
        if (ctx && !ctx.finalizada && !ctx.streamConectou) {
            const outcome = status === 'completed' ? 'no_answer'
                : status === 'busy' ? 'no_answer'
                : status === 'no-answer' ? 'no_answer'
                : 'failed';
            await finalizarLigacao({ callId, outcome, duracaoSeg: parseInt(body?.CallDuration) || 0, transcript: [], ultimoEstagio: null, marcouInteresse: false, pediuNaoLigar: false });
        }
    }
}

/** Marca que o Media Stream chegou a abrir (chamado pelo server.js/mediaStream). */
function marcarStreamConectado(callId) {
    const ctx = _contextos.get(callId);
    if (ctx) ctx.streamConectou = true;
}

// ============================================================================
// PÓS-LIGAÇÃO
// ============================================================================

async function finalizarLigacao({ callId, outcome, duracaoSeg, transcript, ultimoEstagio, marcouInteresse, pediuNaoLigar }) {
    const ctx = _contextos.get(callId);
    if (ctx?.finalizada) return;
    if (ctx) ctx.finalizada = true;

    const minutos = Math.max(1, Math.ceil((duracaoSeg || 0) / 60));
    const custoCents = duracaoSeg > 0 ? minutos * CUSTO_CENTS_POR_MIN : 0;

    await supabase.from('calls').update({
        status: 'completed',
        outcome,
        ended_at: new Date().toISOString(),
        duration_seconds: duracaoSeg || 0,
        transcript: transcript?.length ? transcript : null,
        cost_cents: custoCents,
    }).eq('id', callId);

    const lead = ctx?.lead;
    if (lead) {
        const updates = { last_call_status: 'completed', last_call_outcome: outcome };
        if (pediuNaoLigar) updates.do_not_call = true;
        if (typeof ultimoEstagio === 'number' && ultimoEstagio > (lead.current_stage || 0)) {
            updates.current_stage = ultimoEstagio;
        }
        await supabase.from('leads').update(updates).eq('id', lead.id);

        if (duracaoSeg > 0) {
            await registrarGasto(ctx.userId, 'voice_minutes', BUDGET_MINUTOS_DIA, minutos);
        }

        _emitir(ctx.userId, 'call_ended', {
            callId, leadId: lead.id, leadName: lead.name,
            outcome, durationSeconds: duracaoSeg || 0,
        });

        // Interesse confirmado ao telefone → manda o link do Calendly por escrito.
        // O webhook /webhook/calendly existente cuida do resto quando o lead marcar.
        if (marcouInteresse && ctx.rules?.calendly_link) {
            await _enviarLinkPosLigacao(ctx, lead);
        }

        enviarAlerta(
            `📞 Ligação IA encerrada — ${lead.name}`,
            `Resultado: ${outcome} | Duração: ${duracaoSeg || 0}s | Gatilho: ${ctx?.trigger || '—'}${marcouInteresse ? ' | 🔥 Interesse: link do Calendly enviado' : ''}`,
            marcouInteresse ? 3066993 : 10070709
        ).catch(() => {});
    }

    console.log(`📞 [VOICE] Ligação ${String(callId).slice(0, 8)} finalizada: ${outcome} (${duracaoSeg || 0}s)`);
}

async function _enviarLinkPosLigacao(ctx, lead) {
    const msg = `Oi ${lead.dono || ''}! Conforme combinamos agora no telefone, aqui está o link pra você escolher o melhor horário: ${ctx.rules.calendly_link}`.replace(/\s{2,}/g, ' ');
    try {
        const sdr = _getSdr();
        if (sdr?.enviarMensagemSDR && lead.whatsapp_id && lead.instance_id) {
            const r = await sdr.enviarMensagemSDR(lead.instance_id, lead.whatsapp_id, msg);
            if (r?.success) {
                console.log(`✅ [VOICE] Link do Calendly enviado por WhatsApp para ${lead.name}`);
                return;
            }
        }
    } catch (err) {
        console.warn(`⚠️ [VOICE] WhatsApp indisponível pro pós-ligação (${err.message}), tentando SMS...`);
    }
    // Fallback: SMS (link encurtado pelo próprio Calendly já cabe em 160 chars)
    try {
        await enviarSMS(String(lead.phone || '').replace(/\D/g, ''), msg);
    } catch (err) {
        console.error(`❌ [VOICE] Falha também no SMS pós-ligação:`, err.message);
    }
}

module.exports = {
    initVoiceEngine,
    iniciarLigacao,
    gerarTwiML,
    obterContexto,
    aoStatusCallback,
    marcarStreamConectado,
    finalizarLigacao,
};
