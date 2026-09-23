'use strict';
// ============================================================================
//  EVAL DE QUALIDADE DA IA — o "contrato" de como a IA PODE e NÃO PODE responder.
//  Roda offline (sem LLM, sem rede): valida as TRAVAS determinísticas que já nos
//  queimaram em produção. Rode `npm run eval` ANTES de mexer em prompt/fluxo.
//
//  Cada cenário abaixo é uma regra que, se quebrar, é regressão real de qualidade.
// ============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripWeb, enxugarWeb } = require('../lib/webGuardrails');
const { deveProporAgendamento } = require('../lib/agendaDecisao');

// Simula o pipeline de saída do chat do site (como roda em produção).
const respostaWeb = (bruto) => enxugarWeb(stripWeb(bruto));

// ── REGRA 1: no chat do site, no máximo UMA pergunta por mensagem ───────────────
test('CONTRATO: a IA nunca manda paredão de perguntas no web', () => {
    const casos = [
        'Entendi. Quantos leads por dia? E quanto perde? Faz sentido um agente?',
        'Legal! Você usa Instagram? E WhatsApp? Anúncios?',
        'Show. Qual seu segmento? Quantos clientes atende hoje?',
    ];
    for (const c of casos) {
        const out = respostaWeb(c);
        const perguntas = (out.match(/\?/g) || []).length;
        assert.ok(perguntas <= 1, `REGRESSÃO: "${out}" tem ${perguntas} perguntas (máx 1)`);
    }
});

// ── REGRA 2: a IA NUNCA envia link falso/inventado no web ──────────────────────
test('CONTRATO: nunca vaza link falso (antix.com.br/agendar) nem Calendly', () => {
    const casos = [
        'Marca em https://antix.com.br/agendar quando quiser. Qual período?',
        'Segue meu link https://calendly.com/fulano/30min pode?',
    ];
    for (const c of casos) {
        const out = respostaWeb(c);
        assert.ok(!/antix\.com\.br\/agendar/.test(out), `REGRESSÃO: vazou link falso em "${out}"`);
        assert.ok(!/calendly\.com/.test(out), `REGRESSÃO: vazou Calendly em "${out}"`);
    }
});

// ── REGRA 3: tags internas nunca chegam ao cliente ─────────────────────────────
test('CONTRATO: tags internas ([ESTAGIO]/[CLIMA]/[QUEBRA]...) nunca aparecem pro lead', () => {
    const out = respostaWeb('Perfeito! [ESTAGIO:3] [CLIMA:quente] vamos seguir? [QUEBRA] beleza');
    assert.ok(!/\[(ESTAGIO|CLIMA|QUEBRA|RAIO-X|PERFIL)/i.test(out), `REGRESSÃO: tag interna vazou em "${out}"`);
});

// ── REGRA 4: resposta sem pergunta não pode virar muro de texto ────────────────
test('CONTRATO: sem pergunta, no máximo 2 frases (não vira muro)', () => {
    const out = respostaWeb('Frase um. Frase dois. Frase três. Frase quatro. Frase cinco.');
    const frases = out.split(/(?<=[.!…])\s+/).filter(Boolean);
    assert.ok(frases.length <= 2, `REGRESSÃO: ${frases.length} frases (máx 2): "${out}"`);
});

// ── REGRA 5: a IA NÃO oferece agendamento num simples "oi" ─────────────────────
test('CONTRATO: "oi"/"bom dia" nunca dispara oferta de horário (mesmo com estágio herdado)', () => {
    for (const saud of ['oi', 'Oi!', 'bom dia', 'boa tarde', 'olá']) {
        for (const stage of [0, 3, 4, 5]) {
            const deve = deveProporAgendamento({ texto: saud, intencao: 'DUVIDA', currentStage: stage, temSlots: false });
            assert.equal(deve, false, `REGRESSÃO: "${saud}" (estágio ${stage}) tentou agendar`);
        }
    }
});

// ── REGRA 6: quando o lead REALMENTE pede, a IA segue pro agendamento ───────────
test('CONTRATO: pedido explícito de horário SEMPRE avança pro agendamento', () => {
    for (const t of ['pode ser amanhã às 10h', 'quero marcar uma reunião', 'que dia você tem?', 'vamos marcar']) {
        assert.ok(
            deveProporAgendamento({ texto: t, intencao: 'DUVIDA', currentStage: 1, temSlots: false }),
            `REGRESSÃO: "${t}" deveria avançar pro agendamento`,
        );
    }
});

// ── REGRA 7: nunca devolve string vazia/undefined pro cliente ──────────────────
test('CONTRATO: entradas degeneradas não geram resposta quebrada', () => {
    for (const x of [null, undefined, '', '   ', '[ESTAGIO:1]']) {
        const out = respostaWeb(x);
        assert.equal(typeof out, 'string', `saída deveria ser string p/ ${JSON.stringify(x)}`);
    }
});
