'use strict';
// Valida a triagem nos MOMENTOS REAIS onde a IA falhou (conversas de prod).
require('dotenv').config();
const { triar, decidirAcao } = require('../lib/triagem');

const H = (...pares) => pares.map(([role, content]) => ({ role, content }));

const CASOS = [
    {
        nome: 'Matheus: "economizar quanto?" (dor=custo, pergunta aberta)',
        historico: H(['assistant', 'Me conta, com o que você trabalha?'], ['user', 'rede de academias'],
            ['assistant', 'Perde cliente por demora?'], ['user', 'não perco não, queria botar IA no lugar de uma pessoa pra economizar'],
            ['assistant', 'Qual economia ideal você quer?']),
        ultimaMsg: 'hoje gasto uns 6 mil fixo nessa operação, vocês conseguem me economizar quanto?',
        espera_acao: 'tira_duvida', espera_dor: 'time_comercial_caro',
    },
    {
        nome: 'Matheus: "Achei muito caro" (objeção)',
        historico: H(['assistant', 'Dá pra reduzir 50-70%, de 6 mil pra 1,8-3 mil. Faz sentido?']),
        ultimaMsg: 'Achei muito caro',
        espera_acao: 'tratar_objecao',
    },
    {
        nome: 'Josiane: "como funciona a ia no wpp?" (dúvida após solução)',
        historico: H(['user', 'umas 3, cada pedido 120'], ['assistant', 'São 3×120=360/sem, ~1500/mês. Faz sentido conversar 15 min?']),
        ultimaMsg: 'como funciona a ia no wpp?',
        espera_acao: 'tira_duvida',
    },
    {
        nome: 'Josiane: "ok" (sinal de avanço após ver valor)',
        historico: H(['assistant', 'São ~1500/mês escapando. A IA responde na hora e recupera isso.'], ['user', 'como funciona?'],
            ['assistant', 'Conecta no WhatsApp, responde 24h, agenda. Quer marcar 15 min pra eu mostrar?']),
        ultimaMsg: 'ok',
        espera_acao: 'propor_reuniao',
    },
    {
        nome: 'Luis: "60 reais" (ticket — responde qualificação, NÃO agendar)',
        historico: H(['user', 'sou padeiro'], ['assistant', 'Como atende hoje?'], ['user', 'entregas e loja'],
            ['assistant', 'Perde pedido por demora? quantos por semana?'], ['user', 'uns 5'], ['assistant', 'Qual o ticket médio?']),
        ultimaMsg: '60 reais',
        espera_acao: 'qualificar',
    },
    {
        nome: 'Luis: "???" (confusão diante de horários)',
        historico: H(['user', '60'], ['assistant', 'Tenho amanhã às 9h30 ou 17h30, qual prefere?']),
        ultimaMsg: '???',
        espera_acao: 'tira_duvida',
    },
    {
        nome: 'Adalberto: "poucas horas" (resposta sem nexo ao ticket)',
        historico: H(['user', 'academia'], ['assistant', 'Quantas matrículas perde?'], ['user', 'umas 20'], ['assistant', 'Qual o ticket de uma matrícula?']),
        ultimaMsg: 'poucas horas',
        espera_acao: 'qualificar',
    },
    {
        nome: 'Direto: "quero marcar amanhã às 10h" (pedido explícito)',
        historico: H(['assistant', 'Posso te mostrar na prática.']),
        ultimaMsg: 'quero marcar amanhã às 10h',
        espera_acao: 'agendar',
    },
];

(async function () {
    if (!process.env.TOGETHER_API_KEY) { console.error('❌ Falta TOGETHER_API_KEY'); process.exit(1); }
    let ok = 0;
    for (const c of CASOS) {
        const tri = await triar({ historico: c.historico, ultimaMsg: c.ultimaMsg });
        const acao = decidirAcao(tri, {});
        const passou = acao === c.espera_acao && (!c.espera_dor || tri.dor_tipo === c.espera_dor);
        if (passou) ok++;
        console.log(`${passou ? '✅' : '❌'} ${c.nome}`);
        console.log(`   → ação=${acao} (esperado ${c.espera_acao})  momento=${tri.momento}  intenção=${tri.intencao_agora}  dor=${tri.dor_tipo}  pergunta=${tri.pergunta_aberta}`);
        if (!passou) console.log(`   raciocínio: ${tri.raciocinio}`);
    }
    console.log(`\n${ok}/${CASOS.length} acertos`);
    process.exit(ok === CASOS.length ? 0 : 1);
})();
