'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { montarPromptSinalAgendamento, interpretarSinalAgendamento } = require('../lib/sinalAgendamento');

const historicoAndreia = [
    { role: 'user', content: 'Olá! Posso ter mais informações sobre isso?' },
    { role: 'assistant', content: 'Oi, tudo bem? Sou a Sofia da Antix, ajudamos empresas a automatizar tarefas comerciais com agentes de IA. O que você gostaria de saber exatamente?' },
    { role: 'user', content: 'Oi! Obrigado pelo contato. Para agendar, escolha o serviço e o horário por aqui, a qualquer hora:' },
];

test('prompt leva as últimas 3 do lead, a última fala da IA e o tempo de resposta', () => {
    const { system, messages } = montarPromptSinalAgendamento({ historico: historicoAndreia, segundosDesdeNossaFala: 7 });
    assert.match(system, /JSON/);
    const u = messages[0].content;
    assert.match(u, /Sou a Sofia da Antix/);
    assert.match(u, /Para agendar, escolha o serviço/);
    assert.match(u, /Posso ter mais informações/);
    assert.match(u, /7 segundos/);
    assert.match(u, /resposta_automatica/);
});

test('só as 3 últimas do lead entram', () => {
    const h = [1, 2, 3, 4, 5].map(i => ({ role: 'user', content: `msg ${i}` }));
    const u = montarPromptSinalAgendamento({ historico: h }).messages[0].content;
    assert.ok(!u.includes('msg 1') && !u.includes('msg 2'));
    assert.ok(u.includes('msg 3') && u.includes('msg 5'));
    assert.match(u, /desconhecido/);
});

test('interpreta JSON (inclusive com texto em volta) e rótulo solto', () => {
    assert.deepEqual(interpretarSinalAgendamento('{"classe":"resposta_automatica","motivo":"saudação automática do negócio"}'),
        { classe: 'resposta_automatica', motivo: 'saudação automática do negócio' });
    assert.equal(interpretarSinalAgendamento('Claro: {"classe": "Pedido_Agendamento", "motivo": "x"} ok').classe, 'pedido_agendamento');
    assert.equal(interpretarSinalAgendamento('outro').classe, 'outro');
});

test('resposta ilegível ou vazia → null (quem chama não propõe horário)', () => {
    assert.equal(interpretarSinalAgendamento(''), null);
    assert.equal(interpretarSinalAgendamento('{"classe":"talvez"}'), null);
    assert.equal(interpretarSinalAgendamento(null), null);
});
