'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

// O helper do painel é ESM (frontend/package.json "type":"module"); import dinâmico a partir do teste CJS.
let f;
test.before(async () => { f = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'formatoChat.js')).href); });

const AGORA = new Date(2026, 10, 5, 15, 0, 0); // 05/11/2026 15:00 (local)

test('rótulo do dia: Hoje / Ontem / dia da semana / data', () => {
    assert.equal(f.rotuloDia(new Date(2026, 10, 5, 9, 0).toISOString(), AGORA), 'Hoje');
    assert.equal(f.rotuloDia(new Date(2026, 10, 4, 23, 59).toISOString(), AGORA), 'Ontem');
    assert.match(f.rotuloDia(new Date(2026, 10, 2, 10, 0).toISOString(), AGORA), /feira|segunda|domingo|sábado/i);
    assert.equal(f.rotuloDia(new Date(2026, 9, 20, 10, 0).toISOString(), AGORA), '20/10/2026');
    assert.equal(f.rotuloDia('lixo', AGORA), '');
});

test('hora na lista: hoje = HH:mm, ontem = Ontem, antigo = dd/mm/aa', () => {
    assert.equal(f.horaLista(new Date(2026, 10, 5, 14, 32).toISOString(), AGORA), '14:32');
    assert.equal(f.horaLista(new Date(2026, 10, 4, 14, 32).toISOString(), AGORA), 'Ontem');
    assert.equal(f.horaLista(new Date(2026, 9, 1, 14, 32).toISOString(), AGORA), '01/10/26');
    assert.equal(f.horaLista(null, AGORA), '');
});

test('agrupa mensagens por dia local', () => {
    const msgs = [
        { created_at: new Date(2026, 10, 4, 10, 0).toISOString(), id: 1 },
        { created_at: new Date(2026, 10, 4, 22, 0).toISOString(), id: 2 },
        { created_at: new Date(2026, 10, 5, 9, 0).toISOString(), id: 3 },
    ];
    const g = f.agruparPorDia(msgs, AGORA);
    assert.equal(g.length, 2);
    assert.deepEqual(g.map(x => x.rotulo), ['Ontem', 'Hoje']);
    assert.deepEqual(g[0].itens.map(m => m.id), [1, 2]);
});

test('autor: lead / ia / humano', () => {
    assert.equal(f.autorDaMensagem({ role: 'user' }), 'lead');
    assert.equal(f.autorDaMensagem({ role: 'assistant' }), 'ia');
    assert.equal(f.autorDaMensagem({ role: 'human_operator' }), 'humano');
});

test('telefone do lead: devolve o 9 que a Meta tira (caso Andreia Freitas) e o link do WhatsApp', () => {
    const t = f.telefoneDoLead({ whatsapp_id: '554891952094@s.whatsapp.net' });
    assert.equal(t.digitos, '5548991952094');
    assert.equal(t.exibicao, '+55 48 99195-2094');
    assert.equal(t.wa, 'https://wa.me/5548991952094');
    // já com 9: não duplica
    assert.equal(f.telefoneDoLead({ whatsapp_id: '5546999201690@s.whatsapp.net' }).digitos, '5546999201690');
    // phone do cadastro tem prioridade; sem DDI recebe 55
    assert.equal(f.telefoneDoLead({ phone: '(46) 99920-1690', whatsapp_id: 'x' }).digitos, '5546999201690');
    // fixo (começa com 2-5) não ganha 9
    assert.equal(f.telefoneDoLead({ whatsapp_id: '554832221234@s.whatsapp.net' }).digitos, '554832221234');
    assert.equal(f.telefoneDoLead({}), null);
});

test('links no texto viram partes clicáveis (sem engolir a pontuação final)', () => {
    const p = f.partirLinks('Segue o link: https://meet.google.com/abc-defg-hij. Te vejo lá!');
    assert.deepEqual(p.map(x => x.tipo), ['texto', 'link', 'texto']);
    assert.equal(p[1].valor, 'https://meet.google.com/abc-defg-hij');
    assert.equal(f.partirLinks('sem link').length, 1);
});
