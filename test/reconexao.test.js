'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularBackoffReconexao } = require('../lib/reconexao');

test('calcularBackoffReconexao: cresce com o número de tentativas (não é fixo)', () => {
    // Base quadrática: 5000*t^2. Como há jitter (0-5000), comparamos faixas que não se sobrepõem.
    // t=1 → 5000-10000 ; t=3 → 45000-50000. A 3ª tentativa é claramente maior que a 1ª.
    const t1 = calcularBackoffReconexao(1);
    const t3 = calcularBackoffReconexao(3);
    assert.ok(t3 > t1, `t3 (${t3}) deveria ser > t1 (${t1})`);
});

test('calcularBackoffReconexao: respeita piso (>= base) e teto de 60s', () => {
    for (const t of [1, 2, 3, 4, 5, 10, 50]) {
        const b = calcularBackoffReconexao(t);
        assert.ok(b >= Math.min(5000 * t * t, 60000), `t=${t}: abaixo do piso`);
        assert.ok(b <= 60000, `t=${t}: acima do teto de 60s (${b})`);
    }
});

test('calcularBackoffReconexao: satura em 60000 para tentativas altas', () => {
    assert.equal(calcularBackoffReconexao(100), 60000);
});
