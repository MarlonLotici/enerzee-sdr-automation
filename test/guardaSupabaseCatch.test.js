'use strict';
// ============================================================================
//  TRAVA DE REGRESSÃO — impede reintroduzir o bug que causou o 500 "instabilidade":
//  chamar .catch() DIRETO num query builder do supabase-js v2. O builder é thenable
//  (tem .then) mas NÃO tem .catch/.finally → estoura "catch is not a function".
//  Forma correta: `await` dentro de try, ou `.then(ok, err)`.
//
//  Este teste varre o código-fonte do backend e falha se o padrão perigoso voltar.
// ============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const IGNORAR = new Set(['node_modules', 'frontend', 'test', '.git', '.wwebjs_auth', '.wwebjs_cache', 'scripts']);

// Terminadores de builder do supabase que retornam o builder (thenable), NÃO uma Promise.
// `.catch(` logo após qualquer um deles (na mesma linha) é o bug. `.then(x).catch(y)` é
// seguro (o .then converte em Promise nativa) e NÃO casa aqui — 'then' não está na lista.
const PADRAO_PERIGOSO = /\.(maybeSingle|single|select|insert|update|delete|upsert|eq|neq|in|is|gte|lte|gt|lt|order|limit|range|or|match|rpc|head)\([^)]*\)\s*\.(catch|finally)\(/;

function listarJs(dir) {
    const out = [];
    for (const nome of fs.readdirSync(dir)) {
        if (IGNORAR.has(nome)) continue;
        const full = path.join(dir, nome);
        const st = fs.statSync(full);
        if (st.isDirectory()) out.push(...listarJs(full));
        else if (nome.endsWith('.js')) out.push(full);
    }
    return out;
}

test('nenhum .catch()/.finally() direto em builder do supabase (regressão do 500)', () => {
    const ofensas = [];
    for (const arquivo of listarJs(RAIZ)) {
        const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
        linhas.forEach((linha, i) => {
            if (PADRAO_PERIGOSO.test(linha)) {
                ofensas.push(`${path.relative(RAIZ, arquivo)}:${i + 1}  ${linha.trim().slice(0, 100)}`);
            }
        });
    }
    assert.equal(
        ofensas.length, 0,
        `\n.catch/.finally direto em builder supabase (use await em try, ou .then(ok,err)):\n${ofensas.join('\n')}\n`,
    );
});
