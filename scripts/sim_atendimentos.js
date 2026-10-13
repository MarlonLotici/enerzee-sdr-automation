'use strict';
/**
 * scripts/sim_atendimentos.js — SIMULADOR DE ATENDIMENTOS EM ESCALA
 *
 * Roda N conversas automáticas contra a Sofia de verdade (web-chat), usando um LLM pra
 * FAZER O PAPEL DO CLIENTE (personas variadas, inclusive casos difíceis), e depois um LLM
 * JUIZ nota cada conversa numa rubrica. Gera um relatório com taxa de acerto por critério e
 * aponta as conversas problemáticas — pra você só olhar as que falharam, sem fazer 50 na mão.
 *
 * Uso:
 *   node scripts/sim_atendimentos.js                # 20 conversas na prod
 *   node scripts/sim_atendimentos.js 50             # 50 conversas
 *   SIM_BASE_URL=http://localhost:3001 node scripts/sim_atendimentos.js 10   # local/staging
 *   SIM_CONC=5 node scripts/sim_atendimentos.js 50  # 5 conversas em paralelo
 *
 * Precisa de TOGETHER_API_KEY no .env (mesmo do sistema). Não toca no banco direto: só
 * conversa pelo /api/web-chat com sessionId "simtest_*" (identificável/descartável).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chamarLLM, MODELOS } = require('../lib/llm');

const BASE_URL = process.env.SIM_BASE_URL || 'https://antix.up.railway.app';
const N = parseInt(process.argv[2], 10) || 20;
const CONC = parseInt(process.env.SIM_CONC, 10) || 4;
const MAX_TURNOS = 14;

// ── Personas: pool diverso. estilo e dificuldade variam de propósito. ───────────────
// aceita: 'logo' (aceita reunião fácil), 'apos_valor' (só depois de ver a conta),
//         'objecao' (levanta 1 objeção e aí decide), 'fria' (quase não topa).
const PERSONAS = [
    { nome: 'Luis',     seg: 'padaria',               estilo: 'terso, responde curto', perde: '5 por semana', ticket: 'R$60', aceita: 'apos_valor' },
    { nome: 'Josiane',  seg: 'confeitaria',           estilo: 'simpática, falante',     perde: '3 por semana', ticket: 'R$120', aceita: 'apos_valor' },
    { nome: 'Joira',    seg: 'manicure',              estilo: 'informal, escreve errado', perde: '3 a 5 por semana', ticket: 'R$100', aceita: 'logo' },
    { nome: 'Marcos',   seg: 'oficina mecânica',      estilo: 'desconfiado, cético',    perde: 'uns 4 por semana', ticket: 'R$400', aceita: 'objecao', objecao: 'acha que IA é robô que afasta cliente' },
    { nome: 'Dra. Paula', seg: 'clínica odontológica', estilo: 'formal, objetiva',      perde: '6 por semana', ticket: 'R$300', aceita: 'apos_valor' },
    { nome: 'Rafael',   seg: 'pet shop',              estilo: 'animado',                perde: '8 por semana', ticket: 'R$90', aceita: 'logo' },
    { nome: 'Carla',    seg: 'loja de roupas',        estilo: 'apressada, sem tempo',   perde: 'não sei direito, umas 10', ticket: 'R$150', aceita: 'objecao', objecao: 'diz que está sem tempo agora' },
    { nome: 'Dr. Henrique', seg: 'escritório de advocacia', estilo: 'formal',           perde: 'poucos clientes', ticket: 'R$2000', aceita: 'fria', foraEscopo: true },
    { nome: 'Sandra',   seg: 'escritório de contabilidade', estilo: 'direta',           perde: '2 por semana', ticket: 'R$500', aceita: 'fria', foraEscopo: true },
    { nome: 'Bruno',    seg: 'restaurante / delivery', estilo: 'ocupado, responde entre tarefas', perde: '15 por semana', ticket: 'R$70', aceita: 'apos_valor' },
    { nome: 'Tati',     seg: 'salão de beleza',       estilo: 'confusa, pergunta muito', perde: 'umas 5', ticket: 'R$130', aceita: 'objecao', objecao: 'não entende como a IA funciona e fica confusa ("?")' },
    { nome: 'Edu',      seg: 'personal trainer',      estilo: 'casual',                 perde: '4 por semana', ticket: 'R$250/mês', aceita: 'apos_valor' },
    { nome: 'Vera',     seg: 'imobiliária',           estilo: 'curiosa sobre preço',    perde: '3 por mês', ticket: 'R$5000 de comissão', aceita: 'objecao', objecao: 'quer saber o preço antes de tudo' },
    { nome: 'Igor',     seg: 'e-commerce de suplementos', estilo: 'técnico, faz pergunta', perde: '20 por semana', ticket: 'R$180', aceita: 'apos_valor' },
    { nome: 'Dona Léa', seg: 'barbearia',             estilo: 'senhora, mais lenta, informal', perde: 'algumas, não contei', ticket: 'R$45', aceita: 'logo' },
    { nome: 'Fael',     seg: 'estúdio de tatuagem',   estilo: 'descolado, gírias',      perde: '6 por semana', ticket: 'R$350', aceita: 'apos_valor' },
    { nome: 'Juliana',  seg: 'nutricionista',         estilo: 'organizada',             perde: '5 por semana', ticket: 'R$200', aceita: 'apos_valor' },
    { nome: 'Thiago',   seg: 'autoescola',            estilo: 'informal',               perde: '7 por semana', ticket: 'R$1500 o curso', aceita: 'objecao', objecao: 'desconfia que vai ser caro' },
];

function personaParaRun(i) {
    const p = PERSONAS[i % PERSONAS.length];
    return { ...p, _id: i + 1 };
}

// ── Prompt do CLIENTE (role-play). O LLM responde como a persona, curto, 1 msg por vez. ──
function promptCliente(p) {
    return `Você está FINGINDO ser um dono/profissional de negócio conversando no WhatsApp com uma IA de vendas (a "Sofia", da Antix, que vende um agente de IA de atendimento). Você é o CLIENTE, não a vendedora.

SEU PERSONAGEM:
- Nome: ${p.nome}
- Negócio: ${p.seg}
- Estilo de escrever: ${p.estilo}
- Você perde cerca de ${p.perde} clientes/oportunidades por demora no atendimento.
- Ticket médio do seu negócio: ${p.ticket}.
${p.objecao ? `- Comportamento: ${p.objecao}.` : ''}
${p.foraEscopo ? '- IMPORTANTE: seu negócio NÃO é de atendimento comercial comum; sua dor real é mais jurídica/contábil. Se a Sofia for honesta e disser que não é o forte dela, aja de acordo (você respeita a honestidade).' : ''}

COMO AGIR:
- Escreva como gente de verdade no WhatsApp: mensagens CURTAS (1 frase, às vezes com erro de digitação se combinar com seu estilo), uma de cada vez.
- Responda de forma natural às perguntas da Sofia, usando os números do seu personagem quando ela perguntar.
- ⚠️ SEMPRE AVANCE a conversa: responda o que a Sofia acabou de perguntar. NUNCA repita "oi" depois da 1ª mensagem, NUNCA repita a mesma frase, NUNCA fique travado — se ela perguntou seu nome, diga o nome; se perguntou do negócio, fale do negócio; etc.
- NÃO seja robótico nem perfeito. NÃO explique que é um teste. NÃO aja como vendedor.
- Aceite reunião assim: ${
        p.aceita === 'logo' ? 'topa a reunião rápido, sem enrolar.' :
        p.aceita === 'apos_valor' ? 'só topa a reunião DEPOIS que a Sofia mostrar o valor/a conta e fizer sentido pra você.' :
        p.aceita === 'objecao' ? 'primeiro levante sua objeção/dúvida; se a Sofia responder bem, aí você topa a reunião.' :
        'você é resistente; só topa se a Sofia for muito convincente, senão vai enrolando.'
    }
- Quando for aceitar um horário oferecido, escolha um dos horários que ela propôs.
- Se você já marcou um horário ou decidiu que não quer, responda apenas com a palavra EXATA: [FIM]

Responda APENAS com a próxima mensagem do cliente (sem aspas, sem rótulo, sem narração).`;
}

const _norm = (s) => (s || '').toLowerCase().replace(/[^a-zà-ÿ0-9]/gi, '').trim();
async function proximaMsgCliente(p, historico) {
    // historico: [{quem:'cliente'|'sofia', txt}]. Pro LLM do cliente, a Sofia é "user" e o cliente é "assistant".
    const messages = historico.map(h => ({ role: h.quem === 'sofia' ? 'user' : 'assistant', content: h.txt }));
    if (!messages.length) messages.push({ role: 'user', content: '(inicie a conversa com um "oi" curto)' });
    const ultimaMinha = [...historico].reverse().find(h => h.quem === 'cliente');
    const limpar = (o) => (o || '').replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 300);
    let out = limpar(await chamarLLM({ system: promptCliente(p), messages, model: MODELOS.cerebro, maxTokens: 80 }));
    // Guard anti-loop: se repetiu a própria última fala (ex.: "oi" de novo), re-prompt com empurrão.
    if (out && ultimaMinha && _norm(out) === _norm(ultimaMinha.txt)) {
        out = limpar(await chamarLLM({
            system: promptCliente(p),
            messages: [...messages, { role: 'user', content: '(não repita o que você já disse — responda minha última pergunta e avance)' }],
            model: MODELOS.cerebro, maxTokens: 80,
        }));
    }
    return out || 'oi';
}

async function sofiaResponde(sessionId, mensagem) {
    const r = await fetch(`${BASE_URL}/api/web-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': 'https://antix-ia.com' },
        body: JSON.stringify({ sessionId, message: mensagem }),
    });
    if (!r.ok) throw new Error(`web-chat HTTP ${r.status}`);
    const j = await r.json().catch(() => ({}));
    return (j.reply || j.message || '').toString();
}

async function rodarConversa(p) {
    const sessionId = `simtest_${Date.now()}_${p._id}_${Math.random().toString(36).slice(2, 6)}`;
    const historico = [];
    let fim = false;
    for (let turno = 0; turno < MAX_TURNOS && !fim; turno++) {
        let msgCliente;
        try { msgCliente = await proximaMsgCliente(p, historico); }
        catch (e) { historico.push({ quem: 'sistema', txt: `(erro cliente: ${e.message})` }); break; }
        if (/\[FIM\]/i.test(msgCliente)) { fim = true; break; }
        historico.push({ quem: 'cliente', txt: msgCliente });
        let resp;
        try { resp = await sofiaResponde(sessionId, msgCliente); }
        catch (e) { historico.push({ quem: 'sistema', txt: `(erro sofia: ${e.message})` }); break; }
        historico.push({ quem: 'sofia', txt: resp });
    }
    return { persona: p, sessionId, historico };
}

// ── JUIZ: nota a conversa numa rubrica, devolve JSON estrito. ────────────────────────
function promptJuiz() {
    return `Você é um auditor sênior de qualidade de vendas (SDR). Vou te dar uma conversa entre um CLIENTE e a "Sofia" (IA de vendas da Antix, que vende um agente de IA de atendimento no WhatsApp). Avalie APENAS o desempenho da SOFIA.

Critérios (cada um true = bom, false = falhou; use null se não se aplica àquela conversa):
- escuta_ativa: a Sofia reagiu/comentou o que o cliente disse ANTES de fazer a próxima pergunta (não foi um questionário seco)?
- nao_pulou_agenda: ela só ofereceu horário DEPOIS de quantificar a dor em dinheiro e apresentar a solução (NÃO pulou pro agendamento cedo demais)?
- fez_conta_em_reais: em algum momento ela fez a conta do prejuízo em R$ usando os números do cliente (ex.: "5 × R$60 = R$300/semana")?
- respondeu_perguntas: quando o cliente perguntou algo, ela respondeu antes de seguir (null se o cliente não perguntou nada)?
- sem_jargao: ela evitou jargão técnico (lead, pipeline, SDR, funil, conversão, qualificação)?
- tom_humano: tom leve e humano, sem repetição robótica nem reabrir com "oi" toda hora?
- honesta_escopo: se a dor do cliente era fora do escopo (jurídico/contábil/etc), ela foi honesta em vez de prometer o que não faz (null se não se aplica)?
- tratou_confusao: se o cliente demonstrou confusão ("?", "???", "como assim"), ela percebeu e re-explicou (null se não houve confusão)?

Também dê:
- nota (0 a 10): qualidade geral do atendimento da Sofia.
- resumo: 1 frase curta sobre o que foi bem/mal.

Responda SOMENTE com um JSON válido, sem texto fora dele, neste formato:
{"escuta_ativa":bool|null,"nao_pulou_agenda":bool|null,"fez_conta_em_reais":bool|null,"respondeu_perguntas":bool|null,"sem_jargao":bool|null,"tom_humano":bool|null,"honesta_escopo":bool|null,"tratou_confusao":bool|null,"nota":number,"resumo":"..."}`;
}

function conversaEmTexto(historico) {
    return historico.map(h => `${h.quem === 'sofia' ? 'SOFIA' : h.quem === 'cliente' ? 'CLIENTE' : 'SISTEMA'}: ${h.txt}`).join('\n');
}

async function julgar(conv) {
    const texto = conversaEmTexto(conv.historico);
    const raw = await chamarLLM({
        system: promptJuiz(),
        messages: [{ role: 'user', content: `Conversa (persona: ${conv.persona.nome}, ${conv.persona.seg}${conv.persona.foraEscopo ? ', FORA DE ESCOPO' : ''}):\n\n${texto}` }],
        model: MODELOS.cerebro,
        maxTokens: 400,
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { _erro: 'juiz não devolveu JSON', _raw: raw };
    try { return JSON.parse(m[0]); } catch (e) { return { _erro: 'JSON inválido do juiz', _raw: raw }; }
}

// ── Pool de concorrência ─────────────────────────────────────────────────────────────
async function comLimite(items, limite, fn) {
    const resultados = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            resultados[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker));
    return resultados;
}

(async function main() {
    if (!process.env.TOGETHER_API_KEY) { console.error('❌ Falta TOGETHER_API_KEY no .env'); process.exit(1); }
    console.log(`🤖 Simulando ${N} atendimentos contra ${BASE_URL} (concorrência ${CONC})...\n`);
    const t0 = Date.now();
    const personas = Array.from({ length: N }, (_, i) => personaParaRun(i));

    let feitas = 0;
    const resultados = await comLimite(personas, CONC, async (p) => {
        const conv = await rodarConversa(p);
        let aval;
        try { aval = await julgar(conv); } catch (e) { aval = { _erro: e.message }; }
        conv.aval = aval;
        feitas++;
        process.stdout.write(`  [${feitas}/${N}] ${p.nome} (${p.seg}) — nota ${aval?.nota ?? '?'}${aval?._erro ? ' ⚠️' : ''}\n`);
        return conv;
    });

    // ── Agregados ──
    const CRITERIOS = ['escuta_ativa', 'nao_pulou_agenda', 'fez_conta_em_reais', 'respondeu_perguntas', 'sem_jargao', 'tom_humano', 'honesta_escopo', 'tratou_confusao'];
    const agg = {};
    for (const c of CRITERIOS) agg[c] = { ok: 0, falhou: 0, na: 0 };
    let somaNota = 0, comNota = 0;
    for (const r of resultados) {
        const a = r.aval || {};
        if (typeof a.nota === 'number') { somaNota += a.nota; comNota++; }
        for (const c of CRITERIOS) {
            if (a[c] === true) agg[c].ok++;
            else if (a[c] === false) agg[c].falhou++;
            else agg[c].na++;
        }
    }
    const mediaNota = comNota ? (somaNota / comNota) : 0;

    // ── Relatório em texto ──
    const linhas = [];
    linhas.push(`# Simulação de ${N} atendimentos — ${new Date().toLocaleString('pt-BR')}`);
    linhas.push(`Alvo: ${BASE_URL}`);
    linhas.push(`Nota média: ${mediaNota.toFixed(1)}/10  (${comNota} avaliadas)\n`);
    linhas.push(`## Critérios (% de acerto, ignorando N/A)`);
    for (const c of CRITERIOS) {
        const { ok, falhou } = agg[c];
        const base = ok + falhou;
        const pct = base ? Math.round((ok / base) * 100) : null;
        linhas.push(`- ${c.padEnd(20)} ${pct === null ? 'N/A' : pct + '%'}  (${ok} ok / ${falhou} falhou / ${agg[c].na} n/a)`);
    }
    // piores conversas
    const ranked = [...resultados].sort((a, b) => (a.aval?.nota ?? 99) - (b.aval?.nota ?? 99));
    linhas.push(`\n## Conversas com pior nota (olhe estas)`);
    for (const r of ranked.slice(0, Math.min(8, resultados.length))) {
        const a = r.aval || {};
        const falhas = CRITERIOS.filter(c => a[c] === false);
        linhas.push(`- [${a.nota ?? '?'}] ${r.persona.nome} (${r.persona.seg})${a._erro ? ' ⚠️' + a._erro : ''}: ${a.resumo || ''}${falhas.length ? `  → falhou: ${falhas.join(', ')}` : ''}`);
    }

    const relatorio = linhas.join('\n');
    console.log('\n' + relatorio + '\n');

    // ── Salva transcrições completas + relatório ──
    const outDir = path.join(process.cwd(), 'scripts', 'sim_out');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const full = resultados.map(r => {
        const a = r.aval || {};
        return `===== ${r.persona.nome} (${r.persona.seg}) — nota ${a.nota ?? '?'} =====\n` +
            `aval: ${JSON.stringify(a)}\n\n${conversaEmTexto(r.historico)}\n`;
    }).join('\n\n');
    const fRel = path.join(outDir, `relatorio_${stamp}.md`);
    const fFull = path.join(outDir, `transcricoes_${stamp}.txt`);
    fs.writeFileSync(fRel, relatorio + '\n');
    fs.writeFileSync(fFull, full);
    console.log(`📄 Relatório:    ${fRel}`);
    console.log(`📄 Transcrições: ${fFull}`);
    console.log(`⏱️  ${Math.round((Date.now() - t0) / 1000)}s`);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
