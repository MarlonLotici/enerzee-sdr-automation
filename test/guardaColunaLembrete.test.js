'use strict';
// ============================================================================
//  TRAVA DE REGRESSÃO — impede reintroduzir o uso da coluna inexistente
//  `reminder_sent` em `4_sdr.js`. A coluna real em `public.leads` é
//  `reminder_24h_sent` (boolean, default false). Enviar `reminder_sent` num
//  `.update()` ou `.select()` faz o PostgREST rejeitar a operação inteira.
// ============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO_SDR = path.join(__dirname, '..', '4_sdr.js');
const PADRAO_PROIBIDO = /\breminder_sent\b/;

test('4_sdr.js não referencia a coluna inexistente reminder_sent (usar reminder_24h_sent)', () => {
    const conteudo = fs.readFileSync(ARQUIVO_SDR, 'utf8');
    const linhas = conteudo.split('\n');
    const ofensas = [];

    linhas.forEach((linha, i) => {
        if (PADRAO_PROIBIDO.test(linha)) {
            ofensas.push(`4_sdr.js:${i + 1}  ${linha.trim().slice(0, 100)}`);
        }
    });

    assert.equal(
        ofensas.length, 0,
        `\nColuna inexistente "reminder_sent" encontrada em 4_sdr.js (a coluna real em public.leads é "reminder_24h_sent", boolean):\n${ofensas.join('\n')}\n`,
    );
});
