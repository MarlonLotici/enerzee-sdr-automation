'use strict';
/**
 * test-followup.js — Smoke test do Motor de Follow-Up Inteligente.
 * Verifica: extração da tag [FOLLOW_UP], limpeza do texto e parse da data.
 * Execute: node scripts/test-followup.js
 */

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

// ─── Funções replicadas do 4_sdr.js para teste isolado ───────────────────────

const REGEX_FOLLOW_UP = /\[FOLLOW_UP:\s*([^\]]+)\]/i;
const REGEX_TAGS       = /\[\s*(ESTAGIO|ESTÁGIO|CLIMA|RAIO-X|PERFIL|ROBO|CONTADOR|ENGANO|GATEKEEPER|AGENDAMENTO_MANUAL|PAUSA\s*PARA\s*RESPOSTA|REVERSAO_TENTADA|FOLLOW_UP|AGUARDANDO_RETORNO)[^\]]*\]/gi;

/**
 * Replica a lógica da etapa 0 de filtrarEEnviarResposta.
 * - Se a tag existir: extrai a data e remove TODAS as tags do texto.
 * - Se não existir: retorna o texto sem alteração (as demais tags são
 *   removidas pelo pipeline completo do filtro, não por esta função).
 */
function extrairFollowUp(resposta) {
    const match = resposta.match(REGEX_FOLLOW_UP);
    if (!match) return { followUpAt: null, textoLimpo: resposta };

    const followUpAt = new Date(match[1].trim());
    // Remove todas as tags de controle da resposta que irá para o lead
    const textoLimpo = resposta
        .replace(new RegExp(REGEX_TAGS.source, 'gi'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return {
        followUpAt: isNaN(followUpAt.getTime()) ? null : followUpAt,
        textoLimpo,
    };
}

// Helper: extrai hora LOCAL do Date (a LLM gera hora no fuso do servidor)
function horaLocal(d) { return d instanceof Date ? d.getHours() : -1; }

// ─── CASO 1: Tag com ISO completo ────────────────────────────────────────────
console.log('\n[1] Tag [FOLLOW_UP] com data ISO completa');
{
    const input = 'Combinado! Segunda às 9h então. [FOLLOW_UP: 2026-06-22T09:00] [ESTAGIO:AGUARDANDO_RETORNO]';
    const { followUpAt, textoLimpo } = extrairFollowUp(input);

    assert('Data é extraída',                    followUpAt instanceof Date && !isNaN(followUpAt));
    assert('Data é 2026-06-22',                  followUpAt?.toISOString().startsWith('2026-06-22'));
    assert('Hora local é 09',                    horaLocal(followUpAt) === 9);
    assert('Tag FOLLOW_UP removida do texto',    !textoLimpo.includes('[FOLLOW_UP'));
    assert('Tag ESTAGIO removida do texto',      !textoLimpo.includes('[ESTAGIO'));
    assert('Texto de confirmação preservado',    textoLimpo.includes('Combinado'));
}

// ─── CASO 2: Tag com hora explícita ──────────────────────────────────────────
console.log('\n[2] Tag [FOLLOW_UP] com hora explícita');
{
    const input = 'Fechado! Terça às 14h então. [FOLLOW_UP: 2026-06-23T14:00] [ESTAGIO:AGUARDANDO_RETORNO]';
    const { followUpAt, textoLimpo } = extrairFollowUp(input);

    assert('Data é extraída',              followUpAt instanceof Date && !isNaN(followUpAt));
    assert('Hora local é 14',             horaLocal(followUpAt) === 14);
    assert('Texto limpo não tem tags',    !textoLimpo.includes('['));
}

// ─── CASO 3: Sem tag — resposta normal do funil ───────────────────────────────
console.log('\n[3] Resposta sem tag FOLLOW_UP (fluxo normal)');
{
    const input = 'Boa! Fica bom pra vc amanhã de manhã? [ESTAGIO:3] [CLIMA:CURIOSO]';
    const { followUpAt, textoLimpo } = extrairFollowUp(input);

    // extrairFollowUp retorna textoLimpo inalterado quando não há tag FOLLOW_UP —
    // a remoção das demais tags é responsabilidade do pipeline completo em filtrarEEnviarResposta.
    assert('followUpAt é null (sem tag)',    followUpAt === null);
    assert('textoLimpo igual à entrada',    textoLimpo === input);
    assert('Texto da pergunta presente',    textoLimpo.includes('amanhã de manhã'));
}

// ─── CASO 4: Tag com data inválida ───────────────────────────────────────────
console.log('\n[4] Tag com data malformada');
{
    const input = 'Combinado! [FOLLOW_UP: segunda-feira] [ESTAGIO:AGUARDANDO_RETORNO]';
    const { followUpAt, textoLimpo } = extrairFollowUp(input);

    assert('followUpAt é null para data inválida', followUpAt === null);
    assert('Tag ainda é removida do texto',        !textoLimpo.includes('[FOLLOW_UP'));
}

// ─── CASO 5: Tag colada no texto sem espaço antes ────────────────────────────
console.log('\n[5] Tag colada no texto sem espaço antes');
{
    const input = 'Anotado![FOLLOW_UP: 2026-06-25T08:30][ESTAGIO:AGUARDANDO_RETORNO]';
    const { followUpAt, textoLimpo } = extrairFollowUp(input);

    assert('Data é extraída mesmo sem espaço', followUpAt instanceof Date && !isNaN(followUpAt));
    assert('Hora local é 08',                  horaLocal(followUpAt) === 8);
    assert('Texto preservado sem tags',        textoLimpo.includes('Anotado'));
    assert('Tags removidas',                   !textoLimpo.includes('['));
}

// ─── CASO 6: Múltiplas tags — garante que só FOLLOW_UP é usado ───────────────
console.log('\n[6] Múltiplas ocorrências — apenas primeira é usada');
{
    const input = 'Ok! [FOLLOW_UP: 2026-07-01T10:00] texto [FOLLOW_UP: 2026-07-02T10:00] [ESTAGIO:5]';
    const { followUpAt } = extrairFollowUp(input);

    assert('Usa a primeira data encontrada', followUpAt?.toISOString().startsWith('2026-07-01'));
}

// ─── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(54)}`);
console.log(`Resultado: ${passed} aprovados, ${failed} falhos`);
if (failed > 0) {
    console.error('⚠️  Há falhas. Revise antes de fazer deploy.\n');
    process.exit(1);
} else {
    console.log('🎯 Todos os testes passaram. Follow-up engine pronto.\n');
    process.exit(0);
}
