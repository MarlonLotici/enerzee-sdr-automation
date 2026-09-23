'use strict';
// ============================================================================
//  TRAVA DE ISOLAMENTO MULTI-TENANT — garante que TODA rota autenticada que recebe
//  um recurso por parâmetro (:instanceId / :leadId) verifique se ele é do PRÓPRIO
//  tenant (ehDonoDaInstancia / ehDonoDoLead / getInstanceRules+user_id). Sem isso,
//  um cliente conseguiria pausar/ler/editar o chip ou lead de OUTRO cliente (IDOR).
//
//  Se alguém criar uma rota nova e esquecer a checagem de dono, este teste FALHA.
// ============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
const CHECAGENS_DE_DONO = /ehDonoDaInstancia|ehDonoDoLead|instOwner|getInstanceRules/;

test('toda rota autenticada com :instanceId/:leadId checa o dono (anti-IDOR)', () => {
    const linhas = fs.readFileSync(SERVER, 'utf8').split('\n');
    const inicios = [];
    linhas.forEach((l, i) => { if (/^app\.(get|post|put|patch|delete)\(/.test(l)) inicios.push(i); });
    inicios.push(linhas.length); // sentinela

    const problemas = [];
    for (let k = 0; k < inicios.length - 1; k++) {
        const ini = inicios[k];
        const bloco = linhas.slice(ini, inicios[k + 1]).join('\n');
        const mPath = linhas[ini].match(/^app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/);
        if (!mPath) continue;
        const rota = mPath[2];
        const temRecursoPorParam = /:instanceId|:leadId/.test(rota);
        const autenticada = /autenticarMiddleware/.test(linhas[ini]);
        if (temRecursoPorParam && autenticada && !CHECAGENS_DE_DONO.test(bloco)) {
            problemas.push(`${rota} (linha ${ini + 1}) — não checa dono do recurso`);
        }
    }
    assert.equal(
        problemas.length, 0,
        `\nRotas com risco de IDOR (adicione ehDonoDaInstancia/ehDonoDoLead):\n${problemas.join('\n')}\n`,
    );
});

test('sanidade: o scanner realmente encontra rotas com :instanceId (não passou vazio)', () => {
    const src = fs.readFileSync(SERVER, 'utf8');
    assert.ok(/:instanceId/.test(src), 'esperava ao menos uma rota com :instanceId no server.js');
});
