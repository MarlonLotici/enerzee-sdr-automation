'use strict';
/**
 * integrations/googleCalendar.js — OAuth + leitura/escrita do Google Calendar, POR TENANT.
 *
 * Isolamento: toda função recebe/usa o user_id do tenant e lê o refresh_token dele em
 * `calendar_connections`. Um tenant nunca acessa a agenda de outro. O backend usa a
 * SERVICE ROLE key (ignora RLS) só pra ler o token no servidor — o cliente nunca vê o token.
 *
 * Env necessárias: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI.
 */

const crypto = require('crypto');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const { tituloComEmoji } = require('../lib/gcalParse');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Escopo de eventos = leitura + escrita (precisamos reescrever o emoji do título).
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

function _envOk() {
    return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI);
}

function _novoOAuthClient() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_OAUTH_CLIENT_ID,
        process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        process.env.GOOGLE_OAUTH_REDIRECT_URI
    );
}

// ── State assinado (anti-CSRF): carrega o user_id de volta no callback com HMAC. ──
const _stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.ADMIN_SECRET || 'dev-state-secret';
function assinarState(userId) {
    const payload = Buffer.from(JSON.stringify({ u: userId, t: Date.now() })).toString('base64url');
    const sig = crypto.createHmac('sha256', _stateSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}
function verificarState(state) {
    if (!state || !state.includes('.')) return null;
    const [payload, sig] = state.split('.');
    const esperado = crypto.createHmac('sha256', _stateSecret).update(payload).digest('base64url');
    if (sig !== esperado) return null;
    try {
        const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (Date.now() - t > 15 * 60 * 1000) return null; // state expira em 15min
        return u;
    } catch { return null; }
}

// ── Fluxo OAuth ──────────────────────────────────────────────────────────────
function gerarUrlConsentimento(userId) {
    const oauth2 = _novoOAuthClient();
    return oauth2.generateAuthUrl({
        access_type: 'offline',     // pra receber refresh_token
        prompt: 'consent',          // força refresh_token mesmo em reconexão
        scope: SCOPES,
        state: assinarState(userId),
    });
}

// Troca o code por tokens e salva o refresh_token do tenant. Retorna { userId, email }.
async function trocarCodeESalvar(code, state) {
    const userId = verificarState(state);
    if (!userId) throw new Error('state inválido/expirado');
    const oauth2 = _novoOAuthClient();
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
        // Sem refresh_token (usuário já tinha consentido antes sem revogar) — pede reconsentimento.
        throw new Error('Google não retornou refresh_token. Revogue o acesso e conecte de novo.');
    }
    oauth2.setCredentials(tokens);
    let email = null;
    try {
        const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
        const me = await oauth2api.userinfo.get();
        email = me.data.email || null;
    } catch { /* email é best-effort */ }

    await supabase.from('calendar_connections').upsert({
        user_id: userId,
        provider: 'google',
        refresh_token: tokens.refresh_token,
        google_email: email,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return { userId, email };
}

// Client autenticado do tenant (a partir do refresh_token salvo). Null se não conectado.
async function _authDoTenant(userId) {
    const { data } = await supabase
        .from('calendar_connections')
        .select('refresh_token')
        .eq('user_id', userId)
        .maybeSingle();
    if (!data?.refresh_token) return null;
    const oauth2 = _novoOAuthClient();
    oauth2.setCredentials({ refresh_token: data.refresh_token });
    return oauth2;
}

async function listarCalendarios(userId) {
    const auth = await _authDoTenant(userId);
    if (!auth) return [];
    const cal = google.calendar({ version: 'v3', auth });
    const res = await cal.calendarList.list({ maxResults: 250 });
    return (res.data.items || []).map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary }));
}

// Limites do dia de HOJE em BRT (-03:00 fixo — Brasil não usa mais horário de verão).
function _janelaHojeBRT() {
    const agora = new Date();
    // Data no fuso BRT
    const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    const y = brt.getUTCFullYear(), m = brt.getUTCMonth(), d = brt.getUTCDate();
    const inicio = new Date(Date.UTC(y, m, d, 3, 0, 0));   // 00:00 BRT = 03:00 UTC
    const fim = new Date(Date.UTC(y, m, d + 1, 3, 0, 0));  // 24h depois
    return { timeMin: inicio.toISOString(), timeMax: fim.toISOString() };
}

async function listarEventosDeHoje(userId, calendarId) {
    const auth = await _authDoTenant(userId);
    if (!auth) return [];
    const cal = google.calendar({ version: 'v3', auth });
    const { timeMin, timeMax } = _janelaHojeBRT();
    const res = await cal.events.list({
        calendarId: calendarId || 'primary',
        timeMin, timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
    });
    return res.data.items || [];
}

// Reescreve o emoji de status no título do evento (✅/❌/❓). Idempotente.
async function atualizarEmojiTitulo(userId, calendarId, eventId, emoji) {
    const auth = await _authDoTenant(userId);
    if (!auth) return false;
    const cal = google.calendar({ version: 'v3', auth });
    const ev = await cal.events.get({ calendarId, eventId });
    const novo = tituloComEmoji(ev.data.summary || '', emoji);
    if (novo === ev.data.summary) return true; // já está com o emoji certo
    await cal.events.patch({ calendarId, eventId, requestBody: { summary: novo } });
    return true;
}

module.exports = {
    envOk: _envOk,
    gerarUrlConsentimento,
    trocarCodeESalvar,
    listarCalendarios,
    listarEventosDeHoje,
    atualizarEmojiTitulo,
    assinarState,
    verificarState,
    SCOPES,
};
