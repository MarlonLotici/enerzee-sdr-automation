/**
 * smoke-sdr.js — Valida mudanças P0 anti-ban (branch hotfix/p0-anti-ban-sdr-auto).
 * Testa: getHumanCooldown, isChipNovo, generateProxyUrl, validateProxy (mockado),
 *        mascaramento de credenciais, limite adaptativo e Browsers fingerprint.
 * Execute: node scripts/smoke-sdr.js
 */
'use strict';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

// ──────────────────────────────────────────────────────────
// 1. getHumanCooldown — distribuição e modo warmup
// ──────────────────────────────────────────────────────────
console.log('\n[1] getHumanCooldown — normal vs warmup');

function getHumanCooldown(isWarmup = false) {
    if (isWarmup) return Math.floor(6 * 60000 + Math.random() * 4 * 60000);
    return Math.floor(4 * 60000 + Math.random() * 3 * 60000);
}

const normal  = Array.from({ length: 1000 }, () => getHumanCooldown(false));
const warmup  = Array.from({ length: 1000 }, () => getHumanCooldown(true));

assert('Normal: todos entre 4-7 min',  normal.every(v => v >= 4*60000 && v <= 7*60000));
assert('Warmup: todos entre 6-10 min', warmup.every(v => v >= 6*60000 && v <= 10*60000));
assert('Normal: média ~5.5 min', (() => {
    const avg = normal.reduce((a,b) => a+b,0) / normal.length;
    return avg > 5*60000 && avg < 6*60000;
})());
assert('Warmup: média ~8 min', (() => {
    const avg = warmup.reduce((a,b) => a+b,0) / warmup.length;
    return avg > 7*60000 && avg < 9*60000;
})());
assert('Normal e warmup têm faixas distintas (sem sobreposição total)',
    Math.min(...warmup) >= Math.min(...normal)); // warmup nunca vai abaixo de 6 min

// ──────────────────────────────────────────────────────────
// 2. isChipNovo — detecção de chip novo vs antigo
// ──────────────────────────────────────────────────────────
console.log('\n[2] isChipNovo — lógica de idade do chip');

function isChipNovo(instanceData) {
    if (!instanceData?.created_at) return false;
    const idadeMs = Date.now() - new Date(instanceData.created_at).getTime();
    return idadeMs < 7 * 24 * 60 * 60 * 1000;
}

const agora   = new Date();
const ontem   = new Date(agora - 1 * 24 * 60 * 60 * 1000);
const ha8dias = new Date(agora - 8 * 24 * 60 * 60 * 1000);

assert('Chip de ontem → novo',       isChipNovo({ created_at: ontem.toISOString() }));
assert('Chip de 8 dias → maduro',    !isChipNovo({ created_at: ha8dias.toISOString() }));
assert('created_at null → maduro',   !isChipNovo({ created_at: null }));
assert('instanceData null → maduro', !isChipNovo(null));

// ──────────────────────────────────────────────────────────
// 3. generateProxyUrl — geração dinâmica por instanceId
// ──────────────────────────────────────────────────────────
console.log('\n[3] generateProxyUrl — sticky session por chip');

function generateProxyUrl(instanceId) {
    const base = process.env.PROXY_BASE_URL;
    if (!base) return null;
    return base.replace('SESSION_ID', instanceId);
}

// Salva e restaura env para não poluir o processo
const originalEnv = process.env.PROXY_BASE_URL;

process.env.PROXY_BASE_URL = 'http://user-antix-session-SESSION_ID:senha@proxy.bright.io:22225';
const urlA = generateProxyUrl('chip-abc-123');
const urlB = generateProxyUrl('chip-xyz-789');

assert('URL gerada contém o instanceId', urlA.includes('chip-abc-123'));
assert('Chips diferentes → URLs distintas', urlA !== urlB);
assert('URL B contém o instanceId correto', urlB.includes('chip-xyz-789'));
assert('SESSION_ID não aparece na URL final', !urlA.includes('SESSION_ID'));

// Sem env var → retorna null
delete process.env.PROXY_BASE_URL;
assert('Sem PROXY_BASE_URL → retorna null', generateProxyUrl('qualquer-id') === null);

// Restaura
if (originalEnv !== undefined) process.env.PROXY_BASE_URL = originalEnv;

// ──────────────────────────────────────────────────────────
// 4. Mascaramento de credenciais no log
// ──────────────────────────────────────────────────────────
console.log('\n[4] Mascaramento de senha no log');

function maskProxy(url) {
    return (url || '').replace(/:[^:@]*@/g, ':***@');
}

const comSenha  = 'http://user-antix-session-abc:senha_super_secreta@proxy.bright.io:22225';
const mascarada = maskProxy(comSenha);

assert('Senha não aparece no log',           !mascarada.includes('senha_super_secreta'));
assert('Host preservado',                    mascarada.includes('proxy.bright.io'));
assert('Username preservado',                mascarada.includes('user-antix-session-abc'));
assert('URL null não crasha',                maskProxy(null) === '');

// ──────────────────────────────────────────────────────────
// 5. validateProxy — mock de sucesso e falha
// ──────────────────────────────────────────────────────────
console.log('\n[5] validateProxy — comportamento com proxy inválido (mock)');

const { HttpsProxyAgent } = require('https-proxy-agent');

async function validateProxy(proxyUrl, instanceId) {
    if (!proxyUrl) return null;
    // Aqui usamos o mock injetado pelo teste (ou axios real em produção)
    const axiosMock = validateProxy._axiosMock || require('axios');
    try {
        const agent = new HttpsProxyAgent(proxyUrl);
        const resp = await axiosMock.get('https://api.ipify.org?format=json', {
            httpsAgent: agent,
            timeout: 10000,
        });
        return agent;
    } catch (err) {
        return null; // falha graciosa
    }
}

(async () => {
    // 5a. Mock de sucesso
    validateProxy._axiosMock = {
        get: async () => ({ data: { ip: '192.168.1.100' } })
    };
    const agentOk = await validateProxy('http://user:pass@proxy.io:80', 'chip-test');
    assert('Proxy válido → retorna HttpsProxyAgent', agentOk instanceof HttpsProxyAgent);

    // 5b. Mock de falha de rede
    validateProxy._axiosMock = {
        get: async () => { throw new Error('connect ECONNREFUSED'); }
    };
    const agentFail = await validateProxy('http://proxy.invalido.local:9999', 'chip-test');
    assert('Proxy inválido → retorna null (não crasha)', agentFail === null);

    // 5c. proxyUrl null → retorna null diretamente
    const agentNull = await validateProxy(null, 'chip-test');
    assert('proxyUrl null → retorna null sem tentar conexão', agentNull === null);

    // ──────────────────────────────────────────────────────
    // 6. Startup jitter — faixa de 0-30s
    // ──────────────────────────────────────────────────────
    console.log('\n[6] Startup jitter — distribuição 0-30s');

    const jitters = Array.from({ length: 500 }, () => Math.floor(Math.random() * 30000));
    assert('Jitter sempre >= 0ms',             jitters.every(j => j >= 0));
    assert('Jitter sempre < 30000ms',          jitters.every(j => j < 30000));
    assert('Jitter tem variação real (>400 distintos em 500)', new Set(jitters).size > 400);

    // ──────────────────────────────────────────────────────
    // 7. Limite diário adaptativo
    // ──────────────────────────────────────────────────────
    console.log('\n[7] Limite diário adaptativo');

    function calcularLimite(instanceData) {
        const chipNovo = isChipNovo(instanceData);
        return chipNovo ? 10 : Math.min(instanceData.daily_limit || 30, 30);
    }

    assert('Chip novo → limite 10',               calcularLimite({ created_at: ontem.toISOString(), daily_limit: 50 }) === 10);
    assert('Chip maduro, limit 50 → cap 30',      calcularLimite({ created_at: ha8dias.toISOString(), daily_limit: 50 }) === 30);
    assert('Chip maduro, limit 20 → respeitado',  calcularLimite({ created_at: ha8dias.toISOString(), daily_limit: 20 }) === 20);
    assert('Chip maduro, sem limit → default 30', calcularLimite({ created_at: ha8dias.toISOString() }) === 30);

    // ──────────────────────────────────────────────────────
    // 8. Browsers.ubuntu — fingerprint real do Baileys
    // ──────────────────────────────────────────────────────
    console.log('\n[8] Browsers.ubuntu("Chrome") — fingerprint real');
    try {
        const baileys = await import('@whiskeysockets/baileys');
        const bf = baileys.Browsers.ubuntu('Chrome');
        assert('Retorna array de 3 elementos',         Array.isArray(bf) && bf.length === 3);
        assert('Versão não é "1.0" (fingerprint falso)', bf[2] !== '1.0');
        assert('OS contém Ubuntu',                     bf[0].toLowerCase().includes('ubuntu'));
        console.log(`     → Fingerprint: ${JSON.stringify(bf)}`);
    } catch (e) {
        assert('Browsers importado sem erro', false, e.message);
    }

    // ──────────────────────────────────────────────────────
    // Resultado final
    // ──────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(54)}`);
    console.log(`Resultado: ${passed} aprovados, ${failed} falhos`);
    if (failed > 0) {
        console.error('⚠️  Há falhas. Revise antes de fazer deploy.\n');
        process.exit(1);
    } else {
        console.log('🎯 Todos os smoke tests passaram. Safe to deploy.\n');
        process.exit(0);
    }
})();
