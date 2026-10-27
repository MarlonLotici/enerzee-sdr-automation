'use strict';
// ============================================================================
// 🌐 Roteamento do webhook da Meta por NÚMERO (phone_number_id).
//
// A Callback URL da Meta é POR APP, e traz ?instanceId= fixo. Com 2+ números no mesmo app
// (ex.: Sofia/Antix e Enerzee), todos os webhooks chegariam com o instanceId do PRIMEIRO →
// mensagem da Enerzee caindo no chip, no lead e no prompt da Antix. Cada webhook da Meta já
// diz de qual número veio (value.metadata.phone_number_id): usamos ISSO pra achar o chip.
// O ?instanceId= vira só fallback (webhook sem metadata).
// ============================================================================

// value.metadata.phone_number_id do primeiro change do webhook (mensagem OU status).
function extrairPhoneNumberId(webhookBody) {
    for (const entry of webhookBody?.entry || []) {
        for (const ch of entry?.changes || []) {
            const id = ch?.value?.metadata?.phone_number_id;
            if (id) return String(id).replace(/\D/g, '') || null;
        }
    }
    return null;
}

// cloud_base_url = https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID> → "<PHONE_NUMBER_ID>".
function phoneNumberIdDaBaseUrl(baseUrl) {
    const m = String(baseUrl || '').trim().match(/\/(\d+)\/?$/);
    return m ? m[1] : null;
}

// Decide o instanceId. `buscar(phoneNumberId)` → Promise<instanceId|null> (injetado: cache/DB).
// Retorna { instanceId, origem: 'phone_number_id' | 'query', divergente }.
async function resolverInstancia({ webhookBody, instanceIdDaUrl, buscar }) {
    const phoneId = extrairPhoneNumberId(webhookBody);
    if (phoneId && buscar) {
        const achado = await buscar(phoneId);
        if (achado) {
            return { instanceId: achado, origem: 'phone_number_id', phoneId,
                divergente: !!instanceIdDaUrl && instanceIdDaUrl !== achado };
        }
    }
    return { instanceId: instanceIdDaUrl || null, origem: 'query', phoneId, divergente: false };
}

module.exports = { extrairPhoneNumberId, phoneNumberIdDaBaseUrl, resolverInstancia };
