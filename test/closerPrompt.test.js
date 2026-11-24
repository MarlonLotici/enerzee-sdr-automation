'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Troca o LLM por um capturador: o que importa é o PROMPT que o Closer monta, não a resposta.
const llmPath = require.resolve('../lib/llm.js');
let capturado = '';
require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: {
    chamarLLM: async ({ system }) => { capturado = system; return 'ok [ESTAGIO:1]'; },
    MODELOS: { conversa: 'x', rapido: 'x', cerebro: 'x', visao: 'x' },
} };
const { gerarRespostaCloser } = require(path.join('..', 'agents', 'closerAgent.js'));

const hist = [{ role: 'user', content: 'Quero pagar menos na conta de luz' }];
const lead = { name: 'Teste', user_id: 'u-qualquer', current_stage: 1, whatsapp_id: '5511999990000@s.whatsapp.net' };
const montar = async (intencao, extra) => { await gerarRespostaCloser(hist, lead, 'PROMPT DO TENANT', intencao, extra); return capturado; };

test('chip autônomo + DUVIDA: sem ciclo SPIN, sem "decisor", sem tom de closer agressivo, sem "30 a 40%", sem REVEAL ANTIX', async () => {
    const p = await montar('DUVIDA', { chipAutonomo: true });
    assert.doesNotMatch(p, /EXPLORAR A DIFICULDADE|clientes perdidos/);
    assert.doesNotMatch(p, /decisor/i);
    assert.doesNotMatch(p, /Você NÃO precisa desta venda|preciso te dar baixa|SALTAR DIRETO|Saltar direto/);
    assert.doesNotMatch(p, /de 30 a 40%/);
    assert.doesNotMatch(p, /REVEAL ANTIX|VOCÊ É UM CLOSER/);
    assert.match(p, /Siga a progressão de etapas definida no SEU prompt/);
    assert.match(p, /AGENDAMENTO: siga as etapas do seu prompt/);
    assert.match(p, /ESTILO DE CONVERSA/);
    assert.match(p, /UMA ÚNICA PERGUNTA por mensagem/); // as travas de segurança continuam
    assert.match(p, /^PROMPT DO TENANT/); // prompt do tenant continua no começo (cache do prompt)
});

test('chip autônomo + LIXO ("aham"): avança a etapa, sem "mude o ângulo"', async () => {
    const p = await montar('LIXO', { chipAutonomo: true });
    assert.doesNotMatch(p, /Mude o ângulo/);
    assert.match(p, /MENSAGEM CURTA/);
    assert.match(p, /AVANCE para a próxima etapa do seu prompt/);
});

test('sem a flag (Sofia/demais): funil da Antix continua exatamente como antes', async () => {
    const d = await montar('DUVIDA', {});
    assert.match(d, /EXPLORAR A DIFICULDADE/);
    assert.match(d, /decisor/i);
    assert.match(d, /Você NÃO precisa desta venda/);
    assert.match(d, /DNA DO VENDEDOR/);
    assert.doesNotMatch(d, /de 30 a 40%/); // o exemplo neutro vale pra todos
    const l = await montar('LIXO', {});
    assert.match(l, /Mude o ângulo/);
});
