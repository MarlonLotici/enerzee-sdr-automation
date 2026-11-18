'use strict';
/**
 * Discord POR CLIENTE (tenant). Antes todo aviso (lead novo, reunião) ia pro Discord da Antix, de todos os clientes.
 * Ordem de resolução do webhook de um tenant:
 *   1) env DISCORD_WEBHOOKS_POR_TENANT = JSON {"<user_id>": "<webhook>"}  (configurável no Railway, sem SQL)
 *   2) coluna profiles.discord_webhook_url (opcional; db/discord_por_tenant.sql)
 *   3) DISCORD_WEBHOOK_URL (o da Antix) — fallback pra nada se perder; o título leva o nome do cliente.
 */
const axios = require('axios');

const ANTIX_USER_ID = process.env.FUNIL_USER_ID || process.env.WEB_CHAT_USER_ID || 'f437f090-5fa0-4a94-b4aa-8c22998c9cf6';
const _cache = new Map(); // userId → { ts, url, proprio }
const TTL_MS = 10 * 60 * 1000;

function _mapaEnv(env = process.env) {
    try { return JSON.parse(env.DISCORD_WEBHOOKS_POR_TENANT || '{}') || {}; } catch { return {}; }
}

/** Puro: escolhe o webhook a partir das fontes já lidas. */
function escolherWebhook({ userId, mapaEnv = {}, colunaPerfil = null, global = null }) {
    const id = String(userId || '');
    if (id && mapaEnv[id]) return { url: mapaEnv[id], proprio: true };
    if (colunaPerfil) return { url: colunaPerfil, proprio: true };
    // A Antix usa o webhook global como o PRÓPRIO canal dela.
    return { url: global || null, proprio: id === ANTIX_USER_ID };
}

/**
 * @param {object} supabase cliente supabase (pode ser null em teste)
 * @param {string} userId tenant
 * @returns {Promise<{url:string|null, proprio:boolean}>}
 */
async function webhookDoTenant(supabase, userId) {
    const id = String(userId || '');
    const c = _cache.get(id);
    if (c && Date.now() - c.ts < TTL_MS) return c;
    let colunaPerfil = null;
    if (supabase && id) {
        try {
            const { data, error } = await supabase.from('profiles').select('discord_webhook_url').eq('id', id).maybeSingle();
            if (!error) colunaPerfil = data?.discord_webhook_url || null; // coluna inexistente → error → ignora
        } catch (_) {}
    }
    const r = { ...escolherWebhook({ userId: id, mapaEnv: _mapaEnv(), colunaPerfil, global: process.env.DISCORD_WEBHOOK_URL }), ts: Date.now() };
    _cache.set(id, r);
    return r;
}

async function postarDiscord(url, payload) {
    if (!url) return false;
    try { await axios.post(url, payload, { timeout: 15000 }); return true; }
    catch (e) { console.error('[DISCORD-TENANT] Falha ao enviar:', e.response?.status || '', e.message); return false; }
}

/**
 * Envia um embed pro Discord do tenant. Se o tenant não tem canal próprio e caiu no da Antix, o título leva o nome
 * do cliente, pra não confundir com lead da própria Antix.
 */
async function avisarTenant(supabase, userId, { titulo, descricao, cor = 0x8B5CF6, campos = [], url = null, nomeCliente = '' }) {
    const wh = await webhookDoTenant(supabase, userId);
    if (!wh.url) return false;
    const prefixo = !wh.proprio && nomeCliente ? `[${nomeCliente}] ` : '';
    const embed = {
        title: `${prefixo}${titulo || 'Aviso'}`.slice(0, 250),
        description: String(descricao || '').slice(0, 4000),
        color: cor,
        timestamp: new Date().toISOString(),
    };
    if (url) embed.url = url;
    if (campos.length) embed.fields = campos.slice(0, 20).map(f => ({ name: String(f.name).slice(0, 250), value: String(f.value || '—').slice(0, 1000), inline: !!f.inline }));
    return postarDiscord(wh.url, { embeds: [embed] });
}

module.exports = { ANTIX_USER_ID, escolherWebhook, webhookDoTenant, postarDiscord, avisarTenant };
