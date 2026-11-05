'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { montarEventoWhatsApp, enviarEventoWhatsApp } = require('../lib/metaCapi');

test('evento de WhatsApp leva ctwa_clid + WABA e action_source business_messaging', () => {
    const ev = montarEventoWhatsApp({ eventName: 'LeadSubmitted', ctwaClid: 'ARAkLk', wabaId: 1114782524418024, eventId: 'lead:1', eventTime: 1700000000 });
    assert.equal(ev.action_source, 'business_messaging');
    assert.equal(ev.messaging_channel, 'whatsapp');
    assert.deepEqual(ev.user_data, { whatsapp_business_account_id: '1114782524418024', ctwa_clid: 'ARAkLk' });
    assert.equal(ev.event_id, 'lead:1');
    assert.equal(ev.custom_data, undefined);
    assert.deepEqual(montarEventoWhatsApp({ eventName: 'QualifiedLead', ctwaClid: 'x', wabaId: '1', value: 450 }).custom_data, { value: 450, currency: 'BRL' });
});

test('inerte sem credenciais e sem ctwa_clid (nunca chama a rede)', async () => {
    const antes = { ...process.env };
    delete process.env.META_DATASET_ID; delete process.env.META_PIXEL_ID; delete process.env.META_CAPI_TOKEN;
    assert.deepEqual(await enviarEventoWhatsApp({ eventName: 'LeadSubmitted', ctwaClid: 'x', wabaId: '1' }), { inerte: true });
    process.env.META_PIXEL_ID = 'p'; process.env.META_CAPI_TOKEN = 't';
    assert.deepEqual(await enviarEventoWhatsApp({ eventName: 'LeadSubmitted', wabaId: '1' }), { semMatch: true });
    Object.assign(process.env, antes);
    if (!antes.META_PIXEL_ID) delete process.env.META_PIXEL_ID;
    if (!antes.META_CAPI_TOKEN) delete process.env.META_CAPI_TOKEN;
});
