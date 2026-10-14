'use strict';
/**
 * lib/metaCapi.js — Meta Conversions API (CAPI), server-side.
 *
 * Manda pro Meta o DESFECHO real do lead (Lead = engajou, Schedule = agendou reunião, com valor)
 * direto do backend — não do navegador. Por quê server-side (o "jeito profissional"):
 *   - não é bloqueado por iPhone/adblock (o pixel do browser perde ~30% dos dados);
 *   - manda o desfecho mesmo horas depois (o backend SABE quem agendou via gcal_event_id);
 *   - permite VALOR por lead → o Meta otimiza o anúncio pra achar mais gente que AGENDA, não que clica.
 *
 * Atribuição: o melhor "match key" é o fbclid do clique no anúncio (vira o cookie/_fbc). O widget
 * captura e manda; aqui a gente repassa pro Meta junto do evento. E-mail (quando houver) vai
 * hasheado (SHA-256), como a Meta exige.
 *
 * INERTE sem credenciais: se META_PIXEL_ID / META_CAPI_TOKEN não estiverem no ambiente, não faz
 * nada (retorna {inerte:true}). Então é seguro deployar antes de o operador colar as credenciais.
 */

const crypto = require('crypto');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

// SHA-256 minúsculo+trim — formato que a Meta exige pra dados pessoais (e-mail/telefone).
function _hash(v) {
    if (v === undefined || v === null || v === '') return undefined;
    return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

// Monta o user_data (chaves de match) a partir dos dados crus. Função PURA (testável).
function construirUserData({ email, telefone, fbp, fbc, ip, ua } = {}) {
    const ud = {};
    const em = _hash(email);                 if (em) ud.em = [em];
    const ph = _hash((telefone || '').replace(/\D/g, '')); if (ph) ud.ph = [ph];
    if (fbp) ud.fbp = fbp;                   // cookie _fbp (pixel do browser)
    if (fbc) ud.fbc = fbc;                   // _fbc (vem do fbclid do clique no anúncio) — o mais forte
    if (ip)  ud.client_ip_address = ip;
    if (ua)  ud.client_user_agent = ua;
    return ud;
}

// Tem pelo menos uma chave de match? (a Meta rejeita evento sem nenhuma)
function temMatch(ud) {
    return !!(ud && (ud.em || ud.ph || ud.fbp || ud.fbc || ud.client_ip_address));
}

// Monta o objeto do evento no formato da CAPI. Função PURA (testável).
function montarEvento({ eventName, eventId, eventTime, userData, customData, actionSource = 'website', eventSourceUrl } = {}) {
    const ev = {
        event_name: eventName,
        event_time: eventTime || Math.floor(Date.now() / 1000),
        action_source: actionSource,
        user_data: userData || {},
    };
    if (eventId) ev.event_id = eventId;              // dedup com o pixel do browser, se ambos dispararem
    if (eventSourceUrl) ev.event_source_url = eventSourceUrl;
    if (customData && Object.keys(customData).length) ev.custom_data = customData;
    return ev;
}

/**
 * Envia um evento pra CAPI. Nunca lança (fail-open). Não bloqueie a resposta ao cliente com isto —
 * chame sem await (fire-and-forget) com .catch.
 * @returns {Promise<{ok?:boolean, inerte?:boolean, semMatch?:boolean, erro?:any}>}
 */
async function enviarEvento({ eventName, eventId, email, telefone, fbp, fbc, ip, ua,
    value, currency = 'BRL', eventSourceUrl, actionSource = 'website', extra = {} } = {}) {
    const pixelId = process.env.META_PIXEL_ID;
    const token = process.env.META_CAPI_TOKEN;
    if (!pixelId || !token) return { inerte: true };

    const userData = construirUserData({ email, telefone, fbp, fbc, ip, ua });
    if (!temMatch(userData)) return { semMatch: true };   // sem chave de match → a Meta rejeitaria

    const customData = { ...extra };
    if (typeof value === 'number' && isFinite(value)) { customData.value = value; customData.currency = currency; }

    const body = { data: [montarEvento({ eventName, eventId, userData, customData, actionSource, eventSourceUrl })] };
    if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;  // p/ validar no Events Manager

    try {
        const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { console.warn(`[META-CAPI] ${eventName} falhou (${r.status}):`, JSON.stringify(j).slice(0, 240)); return { ok: false, erro: j }; }
        console.log(`📈 [META-CAPI] ${eventName} enviado${typeof value === 'number' ? ` (R$${value})` : ''} — recebidos: ${j.events_received ?? '?'}`);
        return { ok: true, resp: j };
    } catch (e) {
        console.warn('[META-CAPI] erro de rede:', e.message);
        return { ok: false, erro: e.message };
    }
}

module.exports = { enviarEvento, montarEvento, construirUserData, temMatch, _hash };
