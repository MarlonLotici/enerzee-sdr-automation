'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { montarEvento, construirUserData, temMatch, _hash } = require('../lib/metaCapi');

test('_hash: SHA-256 minúsculo+trim (formato Meta) ou undefined', () => {
    const esperado = crypto.createHash('sha256').update('joao@x.com').digest('hex');
    assert.equal(_hash('  JOAO@X.com '), esperado);   // normaliza case + trim
    assert.equal(_hash(''), undefined);
    assert.equal(_hash(null), undefined);
});

test('construirUserData: hasheia e-mail/telefone, repassa fbp/fbc/ip/ua crus', () => {
    const ud = construirUserData({ email: 'A@B.com', telefone: '(48) 99999-8888', fbp: 'fb.1.x', fbc: 'fb.1.y', ip: '1.2.3.4', ua: 'Mozilla' });
    assert.equal(ud.em[0], crypto.createHash('sha256').update('a@b.com').digest('hex'));
    assert.equal(ud.ph[0], crypto.createHash('sha256').update('48999998888').digest('hex')); // só dígitos
    assert.equal(ud.fbp, 'fb.1.x');          // fbp/fbc NÃO são hasheados
    assert.equal(ud.fbc, 'fb.1.y');
    assert.equal(ud.client_ip_address, '1.2.3.4');
    assert.equal(ud.client_user_agent, 'Mozilla');
});

test('construirUserData: sem dados → objeto vazio', () => {
    assert.deepEqual(construirUserData({}), {});
    assert.deepEqual(construirUserData(), {});
});

test('temMatch: true com qualquer chave, false sem nenhuma', () => {
    assert.equal(temMatch({ fbc: 'fb.1.y' }), true);
    assert.equal(temMatch({ em: ['abc'] }), true);
    assert.equal(temMatch({ client_ip_address: '1.2.3.4' }), true);
    assert.equal(temMatch({}), false);
    assert.equal(temMatch(null), false);
});

test('montarEvento: formato CAPI com value/currency e dedup event_id', () => {
    const ev = montarEvento({
        eventName: 'Schedule', eventId: 'sched:123', eventTime: 1700000000,
        userData: { fbc: 'fb.1.y' }, customData: { value: 500, currency: 'BRL' },
        actionSource: 'website', eventSourceUrl: 'https://antix-ia.com',
    });
    assert.equal(ev.event_name, 'Schedule');
    assert.equal(ev.event_time, 1700000000);
    assert.equal(ev.event_id, 'sched:123');          // dedup com o pixel do browser
    assert.equal(ev.action_source, 'website');
    assert.equal(ev.event_source_url, 'https://antix-ia.com');
    assert.deepEqual(ev.user_data, { fbc: 'fb.1.y' });
    assert.deepEqual(ev.custom_data, { value: 500, currency: 'BRL' });
});

test('montarEvento: sem customData não inclui a chave (Lead simples)', () => {
    const ev = montarEvento({ eventName: 'Lead', userData: { fbc: 'x' } });
    assert.equal(ev.event_name, 'Lead');
    assert.equal('custom_data' in ev, false);
    assert.ok(ev.event_time > 0);                     // default = agora
});
