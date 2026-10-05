#!/usr/bin/env node
/**
 * setup_cloud_api.js — configuração ONE-TIME de um número na WhatsApp Cloud API (Meta oficial).
 *
 * Faz, em ordem:
 *   3) Assina o app na WABA           (POST /{WABA_ID}/subscribed_apps)
 *   4) Checa o status do número       (GET  /{PHONE_NUMBER_ID}?fields=...)
 *      e, se --register for passado, registra com PIN (POST /{PHONE_NUMBER_ID}/register)
 *
 * SEGURANÇA: o token vem SÓ de process.env.WA_TOKEN e NUNCA é impresso.
 *
 * Uso (PowerShell):
 *   $env:WA_TOKEN="<seu_token>"; node scripts/setup_cloud_api.js
 *   $env:WA_TOKEN="<seu_token>"; node scripts/setup_cloud_api.js --register --pin 123456
 *
 * Uso (bash):
 *   WA_TOKEN="<seu_token>" node scripts/setup_cloud_api.js
 *   WA_TOKEN="<seu_token>" node scripts/setup_cloud_api.js --register --pin 123456
 *
 * Overrides opcionais por env: PHONE_NUMBER_ID, WABA_ID, GRAPH_VER.
 */

const WA_TOKEN = process.env.WA_TOKEN || process.env.CLOUD_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1366136896578904'; // +55 48 9820-3038 (Sofia/Antix)
const WABA_ID = process.env.WABA_ID || '1114782524418024';
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VER || 'v25.0'}`;

const args = process.argv.slice(2);
const doRegister = args.includes('--register');
const pin = (() => { const i = args.indexOf('--pin'); return i >= 0 ? args[i + 1] : null; })();

if (!WA_TOKEN) {
    console.error('❌ WA_TOKEN ausente. Rode com: $env:WA_TOKEN="<token>"; node scripts/setup_cloud_api.js');
    process.exit(1);
}
if (doRegister && !/^\d{6}$/.test(pin || '')) {
    console.error('❌ --register exige --pin <6 dígitos>. Ex.: node scripts/setup_cloud_api.js --register --pin 123456');
    process.exit(1);
}

const H = { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' };

async function call(label, url, opts) {
    const resp = await fetch(url, opts);
    let body;
    try { body = await resp.json(); } catch { body = await resp.text(); }
    const ok = resp.ok && !(body && body.error);
    console.log(`\n${ok ? '✅' : '❌'} ${label} → HTTP ${resp.status}`);
    // Imprime o corpo da resposta (nunca contém o token enviado no header).
    console.log(JSON.stringify(body, null, 2));
    return { ok, body };
}

(async () => {
    console.log(`🔧 Setup Cloud API — WABA ${WABA_ID} | número ${PHONE_NUMBER_ID} | ${GRAPH}`);

    // 3) Assinar o app na WABA (idempotente — pode rodar de novo sem efeito colateral)
    await call(
        '3. Assinar app na WABA (subscribed_apps)',
        `${GRAPH}/${WABA_ID}/subscribed_apps`,
        { method: 'POST', headers: H }
    );

    // 4a) Checar status do número
    const st = await call(
        '4. Status do número',
        `${GRAPH}/${PHONE_NUMBER_ID}?fields=status,name_status,verified_name,code_verification_status,quality_rating,platform_type,throughput`,
        { method: 'GET', headers: H }
    );

    const conectado = st.ok && String(st.body?.status || '').toUpperCase() === 'CONNECTED';
    if (conectado) {
        console.log('\n🎉 Número já está CONNECTED — pronto pra enviar/receber.');
    } else {
        console.log(`\nℹ️  Número ainda não CONNECTED (status: ${st.body?.status || 'desconhecido'}, name_status: ${st.body?.name_status || 'n/a'}).`);
        console.log('   → Se o nome de exibição já foi APROVADO e ainda não conectou, rode com --register --pin <6 dígitos>.');
    }

    // 4b) Registrar com PIN (só se pedido)
    if (doRegister) {
        await call(
            '4b. Registrar número (register)',
            `${GRAPH}/${PHONE_NUMBER_ID}/register`,
            { method: 'POST', headers: H, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) }
        );
        console.log('\nℹ️  Após registrar, rode o script de novo (sem --register) pra confirmar status CONNECTED.');
    }

    console.log('\n— fim do setup —');
})().catch(e => { console.error('💥 Erro inesperado:', e.message); process.exit(1); });
