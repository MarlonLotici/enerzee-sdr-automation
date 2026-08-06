'use strict';
const axios = require('axios');

// 🔹 Canal Comercial: handoffs e Calendly (ação de lucro imediata)
// 🔸 Canal Suporte: infra/chips (filtrado por debounce + expediente)
const WEBHOOK_COMERCIAL = process.env.DISCORD_WEBHOOK_URL;
const WEBHOOK_SUPORTE   = process.env.DISCORD_WEBHOOK_SUPORTE_URL || process.env.DISCORD_WEBHOOK_URL;

// Timers de debounce por chip: instanceId → TimerHandle
const _debounceTimers = new Map();

async function _post(webhookUrl, payload) {
    if (!webhookUrl) return;
    try {
        await axios.post(webhookUrl, payload);
    } catch (err) {
        console.error('[DISCORD] Erro ao enviar webhook:', err.message);
    }
}

// ─── 🔹 CANAL COMERCIAL ───────────────────────────────────────────────────────

// Handoff humano: lead pausado, consultor precisa assumir
async function alertaHandoff({ leadId, leadName, empresa, niche, motivo, resumoIA, instanceId }) {
    await _post(WEBHOOK_COMERCIAL, {
        embeds: [{
            title:  '🤝 HANDOFF — Consultor Necessário',
            color:  0xF59E0B,
            fields: [
                { name: '👤 Lead',         value: leadName  || '—', inline: true  },
                { name: '🏢 Empresa',       value: empresa   || '—', inline: true  },
                { name: '📦 Nicho',         value: niche     || '—', inline: true  },
                { name: '⚡ Motivo',        value: motivo    || '—', inline: false },
                { name: '📊 Resumo da IA', value: resumoIA  || 'Resumo indisponível.', inline: false },
            ],
            footer:    { text: `Lead: ${leadId || '—'} | Chip: ${instanceId || '—'}` },
            timestamp: new Date().toISOString(),
        }],
    });
}

// Reunião confirmada via Calendly
async function alertaCalendly({ leadName, empresa, niche, dataEvento, nomeEvento }) {
    await _post(WEBHOOK_COMERCIAL, {
        embeds: [{
            title:  '🎯 REUNIÃO CONFIRMADA — Calendly',
            color:  0x10B981,
            fields: [
                { name: '👤 Lead',    value: leadName   || '—', inline: true  },
                { name: '🏢 Empresa', value: empresa    || '—', inline: true  },
                { name: '📦 Nicho',   value: niche      || '—', inline: true  },
                { name: '📅 Evento',  value: nomeEvento || '—', inline: false },
                { name: '🕐 Horário', value: dataEvento
                    ? new Date(dataEvento).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                    : '—', inline: false },
            ],
            timestamp: new Date().toISOString(),
        }],
    });
}

// ─── 🔸 CANAL SUPORTE ─────────────────────────────────────────────────────────

// Chip offline: debounce de 3 min + silêncio fora do expediente (noite/fim de semana)
function alertaChipOffline(instanceId, instanceName) {
    if (_debounceTimers.has(instanceId)) {
        clearTimeout(_debounceTimers.get(instanceId));
        _debounceTimers.delete(instanceId);
    }
    console.log(`⏳ [DISCORD DEBOUNCE] Chip desconectado. Aguardando 3 minutos para validar estabilidade...`);
    const timer = setTimeout(async () => {
        _debounceTimers.delete(instanceId);
        const now       = new Date();
        const hora      = now.getHours();
        const diaSemana = now.getDay(); // 0 = Dom, 6 = Sáb
        if (diaSemana === 0 || diaSemana === 6 || hora >= 22 || hora < 7) {
            console.log(`💤 [DISCORD] Fora do expediente — alerta de desconexão mutado para ${instanceName}.`);
            return;
        }
        await _post(WEBHOOK_SUPORTE, {
            embeds: [{
                title:       '⚠️ CHIP OFFLINE',
                color:       0xEF4444,
                description: `O chip **${instanceName}** está desconectado há mais de 3 minutos. Ação necessária.`,
                footer:      { text: `ID: ${instanceId}` },
                timestamp:   new Date().toISOString(),
            }],
        });
    }, 180000); // 3 min
    _debounceTimers.set(instanceId, timer);
}

// Cancela o debounce se o chip reconectar dentro dos 3 min (silêncio absoluto)
function cancelarDebounceChip(instanceId) {
    if (_debounceTimers.has(instanceId)) {
        clearTimeout(_debounceTimers.get(instanceId));
        _debounceTimers.delete(instanceId);
        console.log(`✅ [DISCORD DEBOUNCE] Chip reconectado antes de 3 min. Alerta cancelado.`);
    }
}

// Degradação de IA: um agente (router/profiler/closer) caiu em fallback por erro de API (Groq/
// Together — timeout, 429, 5xx). Debounce por agente pra não floodar num pico. Assim você SABE
// em tempo real que a IA está degradando, em vez de descobrir por reclamação do cliente.
const _ultimaDegradacaoIA = new Map(); // agente → timestamp do último alerta
const _INTERVALO_DEGRADACAO_MS = 5 * 60 * 1000;
async function alertaDegradacaoIA(agente, erro) {
    const agora = Date.now();
    if (agora - (_ultimaDegradacaoIA.get(agente) || 0) < _INTERVALO_DEGRADACAO_MS) return;
    _ultimaDegradacaoIA.set(agente, agora);
    const status = erro?.status || erro?.response?.status || '—';
    await _post(WEBHOOK_SUPORTE, {
        embeds: [{
            title:       '⚠️ IA DEGRADADA — resposta genérica enviada',
            color:       0xF59E0B,
            description: `O agente **${agente}** falhou na API e caiu em fallback. Cliente pode ter recebido resposta genérica.`,
            fields:      [{ name: 'Erro', value: String(erro?.message || erro).slice(0, 300), inline: false },
                          { name: 'HTTP', value: String(status), inline: true }],
            timestamp:   new Date().toISOString(),
        }],
    });
}

// Compat legada — mantém todos os callers existentes funcionando (roteia para suporte)
async function enviarAlerta(titulo, mensagem, cor = 3447003) {
    await _post(WEBHOOK_SUPORTE, {
        embeds: [{
            title:       titulo,
            description: mensagem,
            color:       cor,
            timestamp:   new Date().toISOString(),
        }],
    });
}

module.exports = { enviarAlerta, alertaHandoff, alertaCalendly, alertaChipOffline, cancelarDebounceChip, alertaDegradacaoIA };
