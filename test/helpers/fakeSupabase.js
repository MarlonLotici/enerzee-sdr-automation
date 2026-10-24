'use strict';
// Supabase FALSO em memória — implementa o subconjunto do query builder do PostgREST que o
// motor de campanhas usa (select/insert/update/upsert, filtros, order/limit/range, count head).
// Só pra testes: comportamento suficiente, não completo.

let _seq = 0;
const novoId = () => `id-${++_seq}`;

function criarFakeSupabase(tabelas = {}) {
    const db = {};
    for (const [nome, linhas] of Object.entries(tabelas)) db[nome] = linhas.map(l => ({ ...l }));
    const tabela = (n) => (db[n] = db[n] || []);
    const uniques = { campanha_contatos: ['campanha_id', 'lead_id'], leads: ['whatsapp_id', 'user_id'] };

    function builder(nome) {
        const st = { op: 'select', filtros: [], ordem: null, lim: null, de: null, ate: null, payload: null,
            opcoes: {}, head: false, count: false, single: false, maybe: false, retornar: false };
        const b = {
            select(_cols, opts = {}) { if (st.op === 'select') st.op = 'select'; else st.retornar = true;
                st.head = !!opts.head; st.count = opts.count === 'exact'; return b; },
            insert(p) { st.op = 'insert'; st.payload = Array.isArray(p) ? p : [p]; return b; },
            upsert(p, o = {}) { st.op = 'upsert'; st.payload = Array.isArray(p) ? p : [p]; st.opcoes = o; return b; },
            update(p) { st.op = 'update'; st.payload = p; return b; },
            delete() { st.op = 'delete'; return b; },
            eq(c, v) { st.filtros.push(l => String(l[c]) === String(v)); return b; },
            neq(c, v) { st.filtros.push(l => String(l[c]) !== String(v)); return b; },
            gte(c, v) { st.filtros.push(l => l[c] != null && String(l[c]) >= String(v)); return b; },
            lte(c, v) { st.filtros.push(l => l[c] != null && String(l[c]) <= String(v)); return b; },
            in(c, vs) { st.filtros.push(l => vs.map(String).includes(String(l[c]))); return b; },
            not(c, op, v) {
                if (op === 'is' && v === null) st.filtros.push(l => l[c] !== null && l[c] !== undefined);
                else if (op === 'in') { const vs = String(v).replace(/[()]/g, '').split(','); st.filtros.push(l => !vs.includes(String(l[c]))); }
                return b;
            },
            order(c, o = {}) { st.ordem = { c, asc: o.ascending !== false }; return b; },
            limit(n) { st.lim = n; return b; },
            range(a, z) { st.de = a; st.ate = z; return b; },
            maybeSingle() { st.maybe = true; return b; },
            single() { st.single = true; return b; },
            then(res, rej) { return Promise.resolve().then(executar).then(res, rej); },
        };

        function executar() {
            const t = tabela(nome);
            const casa = (l) => st.filtros.every(f => f(l));
            if (st.op === 'insert' || st.op === 'upsert') {
                const chave = st.opcoes.onConflict ? st.opcoes.onConflict.split(',') : uniques[nome];
                const inseridos = [];
                for (const p of st.payload) {
                    const dup = chave && t.find(l => chave.every(k => String(l[k]) === String(p[k])));
                    if (dup) { if (st.op === 'upsert' && !st.opcoes.ignoreDuplicates) Object.assign(dup, p); continue; }
                    const linha = { id: novoId(), criado_em: new Date().toISOString(), created_at: new Date().toISOString(), ...p };
                    t.push(linha); inseridos.push(linha);
                }
                return fim(inseridos);
            }
            if (st.op === 'update') {
                const alvo = t.filter(casa);
                alvo.forEach(l => Object.assign(l, st.payload));
                return fim(alvo);
            }
            if (st.op === 'delete') {
                const fica = t.filter(l => !casa(l)); const sai = t.length - fica.length;
                db[nome] = fica; return { data: null, error: null, count: sai };
            }
            let linhas = t.filter(casa);
            if (st.ordem) linhas = [...linhas].sort((a, z) => {
                const x = a[st.ordem.c] ?? '', y = z[st.ordem.c] ?? '';
                return (x < y ? -1 : x > y ? 1 : 0) * (st.ordem.asc ? 1 : -1);
            });
            const total = linhas.length;
            if (st.de !== null) linhas = linhas.slice(st.de, st.ate + 1);
            if (st.lim !== null) linhas = linhas.slice(0, st.lim);
            if (st.head) return { data: null, error: null, count: total };
            return fim(linhas, total);
        }
        function fim(linhas, total = linhas.length) {
            const copia = linhas.map(l => ({ ...l }));
            if (st.single) return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: { message: 'not single' } };
            if (st.maybe) return { data: copia[0] || null, error: null };
            return { data: copia, error: null, count: st.count ? total : null };
        }
        return b;
    }
    return { from: (n) => builder(n), _db: db };
}

module.exports = { criarFakeSupabase };
