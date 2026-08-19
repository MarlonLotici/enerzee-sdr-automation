'use strict';
/**
 * ONBOARDING — cria a CONTA de um cliente novo (passo 1 do runbook docs/ONBOARDING.md).
 *
 * Embrulha o POST /api/admin/criar-conta (protegido por x-admin-secret) numa linha de
 * comando, pra não montar curl na mão a cada cliente. Só cria a conta (Auth + profile);
 * persona, chip e tetos são os passos seguintes do runbook.
 *
 * Uso (args OU env):
 *   node scripts/criar_cliente.js --email cliente@x.com --senha SEGREDO123 \
 *        --empresa "Solar do Vale" --produto solar
 *
 * Env necessárias:
 *   ADMIN_SECRET                  (o mesmo do Railway)
 *   APP_URL ou PUBLIC_BASE_URL    (host do backend, ex.: https://app.suaempresa.com)
 * Ou sobrescreva o host com --host https://...
 */

function arg(nome, curto) {
    const i = process.argv.findIndex(a => a === `--${nome}` || (curto && a === `-${curto}`));
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    const host = (arg('host') || process.env.APP_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const secret = arg('secret') || process.env.ADMIN_SECRET;
    const email = arg('email');
    const password = arg('senha') || arg('password');
    const nome_empresa = arg('empresa') || arg('company');
    const produto = arg('produto') || arg('product') || 'solar';

    const faltando = [];
    if (!host) faltando.push('host (APP_URL/PUBLIC_BASE_URL ou --host)');
    if (!secret) faltando.push('ADMIN_SECRET (ou --secret)');
    if (!email) faltando.push('--email');
    if (!password) faltando.push('--senha');
    if (faltando.length) {
        console.error('❌ Faltam: ' + faltando.join(', '));
        console.error('Ex.: node scripts/criar_cliente.js --email c@x.com --senha SEGREDO123 --empresa "Solar do Vale" --produto solar');
        process.exit(1);
    }
    if (password.length < 8) {
        console.error('❌ A senha precisa ter no mínimo 8 caracteres.');
        process.exit(1);
    }

    const resp = await fetch(`${host}/api/admin/criar-conta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        body: JSON.stringify({ email, password, nome_empresa, produto }),
    });
    let data = {};
    try { data = await resp.json(); } catch { /* corpo vazio */ }

    if (!resp.ok) {
        console.error(`❌ [${resp.status}] ${data.error || resp.statusText}`);
        if (data.detail) console.error('   detalhe:', data.detail);
        process.exit(1);
    }
    console.log(`✅ Conta criada: ${email} (user_id=${data.user_id})`);
    console.log('   Próximos passos: persona/prompt → conectar chip → tetos → validar (ver docs/ONBOARDING.md).');
}

main().catch((e) => {
    console.error('❌ Erro:', e.message);
    process.exit(1);
});
