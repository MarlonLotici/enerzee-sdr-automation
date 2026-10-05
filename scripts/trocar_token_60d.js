#!/usr/bin/env node
/**
 * trocar_token_60d.js — troca um token CURTO (~1h, do Graph Explorer) por um
 * token de LONGA duração (~60 dias) da Meta.
 *
 * ⚠️ REMENDO. O ideal é um token permanente de System User (não expira) —
 *    veja o passo a passo que o Claude te passou. Use isto só pra validar hoje.
 *
 * SEGURANÇA: os dois segredos vêm SÓ de env vars e NÃO são impressos.
 *   Só o token novo (que você vai colar no Railway) aparece no SEU terminal.
 *
 * Uso (PowerShell) — segredos só no seu terminal, nunca em arquivo/chat:
 *   $env:FB_APP_SECRET="<chave secreta do app>"
 *   $env:FB_SHORT_TOKEN="<token atual do Explorer>"
 *   node scripts/trocar_token_60d.js
 */

const CLIENT_ID = process.env.FB_CLIENT_ID || '959623569903366'; // App Antix Colony
const SECRET = process.env.FB_APP_SECRET;
const SHORT = process.env.FB_SHORT_TOKEN;
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VER || 'v25.0'}`;

if (!SECRET || !SHORT) {
    console.error('❌ Faltam env vars. Rode:');
    console.error('   $env:FB_APP_SECRET="<chave secreta do app>"');
    console.error('   $env:FB_SHORT_TOKEN="<token atual do Explorer>"');
    console.error('   node scripts/trocar_token_60d.js');
    process.exit(1);
}

(async () => {
    const url = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
        + `&client_id=${encodeURIComponent(CLIENT_ID)}`
        + `&client_secret=${encodeURIComponent(SECRET)}`
        + `&fb_exchange_token=${encodeURIComponent(SHORT)}`;

    const resp = await fetch(url);
    const body = await resp.json();

    if (!resp.ok || body.error) {
        console.error(`❌ Falhou (HTTP ${resp.status}):`, JSON.stringify(body.error || body, null, 2));
        process.exit(1);
    }

    const dias = body.expires_in ? Math.round(body.expires_in / 86400) : null;
    console.log('\n✅ Token de longa duração gerado.');
    if (dias) console.log(`   Validade: ~${dias} dias (anote um lembrete pra renovar antes disso).`);
    console.log('\n👇 Cole ISTO no Railway como WA_TOKEN (depois faça redeploy):\n');
    console.log(body.access_token);
    console.log('\n⚠️  NÃO compartilhe esse valor nem tire print dele.');
})().catch(e => { console.error('💥 Erro:', e.message); process.exit(1); });
