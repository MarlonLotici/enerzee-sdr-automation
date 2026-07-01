// Script de uso único — limpa sessões Redis dos chips para forçar reautenticação
// Rode via: node clear_sessions.js
// Remova após usar.
require('dotenv').config();
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
});

const CHIPS = [
    'a370ca34-38a9-40e6-85b7-ae3126ce8dcc', // chip 48
    'ccb327aa-7fa2-4d8a-b07b-48a7a2345c00', // chip per
];

async function main() {
    for (const chip of CHIPS) {
        const keys = await redis.keys(`wpp_auth:${chip}*`);
        if (keys.length === 0) {
            console.log(`⚠️  ${chip.slice(0, 8)}: nenhuma chave encontrada`);
            continue;
        }
        await redis.del(...keys);
        console.log(`✅  ${chip.slice(0, 8)}: ${keys.length} chaves removidas`);
    }
    await redis.quit();
    console.log('Pronto. Reinicie os chips para gerar novo QR code.');
}

main().catch(err => { console.error(err); process.exit(1); });
