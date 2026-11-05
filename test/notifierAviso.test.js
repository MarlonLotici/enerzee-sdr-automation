'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('alertaAvisoComercial posta um embed no canal comercial do Discord', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/webhook/comercial';
    const axios = require('axios');
    const original = axios.post;
    const chamadas = [];
    axios.post = async (url, payload) => { chamadas.push({ url, payload }); return {}; };
    try {
        delete require.cache[require.resolve('../notifier')];
        const { alertaAvisoComercial } = require('../notifier');
        await alertaAvisoComercial('Lead novo: Andreia', '📱 +554891952094\n📣 Origem: anúncio');
        assert.equal(chamadas.length, 1);
        assert.equal(chamadas[0].url, 'https://discord.test/webhook/comercial');
        assert.equal(chamadas[0].payload.embeds[0].title, 'Lead novo: Andreia');
        assert.match(chamadas[0].payload.embeds[0].description, /anúncio/);
    } finally {
        axios.post = original;
        delete require.cache[require.resolve('../notifier')];
    }
});

test('sem webhook configurado não faz nada e não lança', async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.DISCORD_WEBHOOK_SUPORTE_URL;
    delete require.cache[require.resolve('../notifier')];
    const { alertaAvisoComercial } = require('../notifier');
    await alertaAvisoComercial('x', 'y');
});
