'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairPhoneNumberId, phoneNumberIdDaBaseUrl, resolverInstancia } = require('../lib/metaWebhook');

const hook = (phoneId) => ({ entry: [{ changes: [{ value: { metadata: { display_phone_number: '554898203038', phone_number_id: phoneId }, messages: [{ id: 'w' }] } }] }] });

test('extrairPhoneNumberId: lê o número do webhook (mensagem ou status)', () => {
    assert.equal(extrairPhoneNumberId(hook('1366136896578904')), '1366136896578904');
    assert.equal(extrairPhoneNumberId({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 99 }, statuses: [] } }] }] }), '99');
    assert.equal(extrairPhoneNumberId({}), null);
    assert.equal(extrairPhoneNumberId(null), null);
});

test('phoneNumberIdDaBaseUrl: extrai o id do fim da cloud_base_url', () => {
    assert.equal(phoneNumberIdDaBaseUrl('https://graph.facebook.com/v20.0/1366136896578904'), '1366136896578904');
    assert.equal(phoneNumberIdDaBaseUrl('https://graph.facebook.com/v20.0/1366136896578904/'), '1366136896578904');
    assert.equal(phoneNumberIdDaBaseUrl('https://graph.facebook.com/v20.0'), null);
    assert.equal(phoneNumberIdDaBaseUrl(null), null);
});

test('resolverInstancia: 2 números no MESMO app → cada um vai pro SEU chip, ignorando o ?instanceId= da URL', async () => {
    const chips = { '1366136896578904': 'chip-sofia', '5550001112223334': 'chip-enerzee' };
    const buscar = async (id) => chips[id] || null;
    // a Callback URL é a da Sofia (?instanceId=chip-sofia) pros dois números
    const sofia = await resolverInstancia({ webhookBody: hook('1366136896578904'), instanceIdDaUrl: 'chip-sofia', buscar });
    const enerzee = await resolverInstancia({ webhookBody: hook('5550001112223334'), instanceIdDaUrl: 'chip-sofia', buscar });
    assert.deepEqual([sofia.instanceId, sofia.divergente], ['chip-sofia', false]);
    assert.deepEqual([enerzee.instanceId, enerzee.origem, enerzee.divergente], ['chip-enerzee', 'phone_number_id', true]);
});

test('resolverInstancia: número desconhecido ou sem metadata → cai no ?instanceId= da URL', async () => {
    const buscar = async () => null;
    assert.equal((await resolverInstancia({ webhookBody: hook('777'), instanceIdDaUrl: 'chip-url', buscar })).instanceId, 'chip-url');
    assert.equal((await resolverInstancia({ webhookBody: {}, instanceIdDaUrl: 'chip-url', buscar })).origem, 'query');
    assert.equal((await resolverInstancia({ webhookBody: {}, instanceIdDaUrl: undefined, buscar })).instanceId, null);
});
