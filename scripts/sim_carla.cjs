// Simulação da Carla (Enerzee): cliente simulado por LLM x Closer (+ Supervisor filtrado) no MESMO modo da produção (chip autônomo).
// Não grava nada no banco e não envia WhatsApp. Uso (chave do Railway, sem imprimir):
//   railway run -s enerzee-sdr-automation node scripts/sim_carla.cjs [rodadas=2] [arquivo_do_prompt]
// O prompt é lido de docs/clientes/enerzee-consultoria/prompt_carla.md (texto após a linha ---), com as variáveis trocadas.
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..') + path.sep;
const bgPath = require.resolve(R + 'budgetGuard.js'); // o teto de custo usa Redis; aqui não precisa
require.cache[bgPath] = { id: bgPath, filename: bgPath, loaded: true, exports: { podeGastar: async () => true, registrarGasto: async () => {} } };
const closer = require(R + 'agents/closerAgent.js');
const supervisor = require(R + 'agents/supervisorAgent.js');
const { chamarLLM, MODELOS } = require(R + 'lib/llm.js');
const { definirTenantLLM } = require(R + 'lib/llmContext.js');
const { secoesFixas } = require(R + 'lib/promptSecoes.js');
let cortar = null; try { cortar = require(R + 'lib/umaPergunta.js').cortarPerguntasEmpilhadas; } catch (_) { /* opcional */ }

const USER = 'cf8950a2-318f-47b5-831c-ee697d8c5c51';
const RODADAS = Number(process.argv[2]) || 2;
const SO = (process.argv[4] || '').split(',').filter(Boolean); // opcional: ids de persona separados por vírgula (ex.: P1-replay,P5-conta-baixa)
const ARQ = process.argv[3] || R + 'docs/clientes/enerzee-consultoria/prompt_carla.md';
const BASE = fs.readFileSync(ARQ, 'utf8').split(/^---\s*$/m).slice(1).join('---').trim()
  .replace(/\$\{agentName\}/g, 'Carla').replace(/\$\{companyName\}/g, 'Enerzee').replace(/\$\{calendlyLink\}/g, 'NÃO envie nenhum link — diga que já vai verificar os horários')
  + secoesFixas({ chipAutonomo: true }).roteiro + secoesFixas({ chipAutonomo: true }).antiInvencao;

const PERSONAS = [
  { id: 'P1-replay', conta: 800, abre: 'O valor', desc: 'Dono de uma pequena empresa (loja) em Florianópolis/SC, conta de uns R$ 800 por mês. Veio de um anúncio sobre conta de luz. Responde curto. O que incomoda é o valor e os reajustes. Em algum momento pergunta "como funciona a empresa de vocês?". Se ela falar de mercado livre, diz "acho que não me enquadro no mercado livre". Já viu painel solar mas achou caro. Se ouvir uma proposta clara de desconto sem investimento, aceita conversar com o consultor.' },
  { id: 'P2-casa', conta: 450, abre: 'Oi, tudo bem? Quero pagar menos de luz', desc: 'Mulher, casa em Curitiba/PR, conta de R$ 450. Objetiva. Responde direto o que perguntam. Pergunta se tem fidelidade. Aceita a reunião se fizer sentido.' },
  { id: 'P3-industria', conta: 18000, abre: 'Boa tarde, queria entender como reduzir o custo de energia da minha indústria', desc: 'Gerente financeiro de uma indústria em Campinas/SP, ligação trifásica, conta de uns R$ 18 mil por mês. Quer previsibilidade de custo. Pergunta quanto tempo leva a migração. Formal e curto. Aceita reunião.' },
  { id: 'P4-desconfiada', conta: 350, abre: 'Bom dia, vi a mensagem de vocês. Isso não é golpe?', desc: 'Senhora em Belo Horizonte/MG (Cemig), casa, conta R$ 350. Desconfiada: pergunta se precisa instalar alguma coisa, se tem taxa extra e se tem contrato longo. Só aceita conversar se a explicação for simples e honesta.' },
  { id: 'P5-conta-baixa', conta: 180, abre: 'Oi, tô com a conta de R$180, queria ver como economizar', desc: 'Rapaz, apartamento em Salvador/BA, conta de R$ 180. Responde curto e informal ("blz", "show"). Quer economizar. Se disserem que não compensa, agradece e se despede.' },
];

const limpa = (t) => String(t || '').replace(/\[[^\]]*\]/g, '').replace(/\s+\n/g, '\n').trim();

async function falaCliente(p, hist) {
  const sys = `Você SIMULA um cliente brasileiro no WhatsApp conversando com a atendente de uma empresa de energia. Persona: ${p.desc}\nEscreva SÓ a próxima mensagem do cliente: curta (1 a 2 frases), estilo WhatsApp. Não invente fatos fora da persona. Não diga que é simulação. NÃO peça para marcar reunião antes de a atendente ter explicado a solução e o desconto; responda o que ela perguntar e só aceite conversar com o consultor depois que ela convidar. Se a atendente propôs conversar com o consultor e você aceitou, responda curto.`;
  const msgs = hist.map(m => ({ role: m.role === 'user' ? 'assistant' : 'user', content: limpa(m.content) }));
  const r = await chamarLLM({ system: sys, messages: msgs, model: MODELOS.cerebro, maxTokens: 200 });
  return String(r || '').trim().replace(/^["']|["']$/g, '');
}

async function rodar(p, turnos = 9) {
  const hist = [];
  const lead = { name: 'Cliente', user_id: USER, current_stage: 0, whatsapp_id: 'sim@s.whatsapp.net', status: 'contact' };
  const falas = [];
  let corrSup = 0;
  let agendou = false;
  for (let t = 0; t < turnos; t++) {
    const c = t === 0 ? p.abre : await falaCliente(p, hist);
    hist.push({ role: 'user', content: c });
    falas.push({ quem: 'CLIENTE', txt: c });
    let resp = await closer.gerarRespostaCloser(hist, lead, BASE, 'DUVIDA', { instanceType: 'generico', bookingAtivo: true, agendaConectada: true, chipAutonomo: true, primeiroContato: t === 0 });
    resp = typeof resp === 'string' ? resp : JSON.stringify(resp);
    let nota = '';
    if (resp.trim().length >= 25 || /\?/.test(resp)) {
      const crit = await supervisor.revisar({ historico: hist, lead, draft: resp, primeiroContato: t === 0 }).catch(() => ({ ok: true, problemas: [] }));
      const uteis = supervisor.filtrarProblemas(crit.problemas || [], { chipAutonomo: true });
      if (!crit.ok && uteis.length) {
        const corr = await supervisor.corrigir({ draft: resp, problemas: uteis, historico: hist, promptBase: BASE }).catch(() => null);
        if (corr) { resp = corr; corrSup++; nota = ` {supervisor: ${uteis.join(',')}}`; }
      }
    }
    const est = /EST[AÁ]GIO\s*:?\s*(\d)/i.exec(resp);
    if (est) lead.current_stage = Number(est[1]);
    let texto = limpa(resp);
    if (cortar) { const k = cortar(texto); if (k && k.cortado) texto = k.texto; }
    hist.push({ role: 'assistant', content: texto });
    falas.push({ quem: 'CARLA', txt: texto, est: lead.current_stage, nota });
    // Em produção o orquestrador de agenda assume quando a pessoa aceita o convite: aqui a conversa termina quando a Carla aciona a agenda.
    if (/(ver|puxar|verificar|buscar)[^.?!]{0,30}hor[áa]rios|hor[áa]rios[^.?!]{0,25}(dispon[ií]ve|aparec)/i.test(texto)) { agendou = true; break; }
    if (lead.current_stage >= 4 && /\b(sim|pode|bora|claro|ok|vamos|fechado|topo|combinado)\b/i.test(c)) break;
  }
  return { falas, corrSup, agendou };
}

// ── métricas automáticas
function metricas(p, r) {
  const carla = r.falas.filter(f => f.quem === 'CARLA');
  const todas = carla.map(f => f.txt).join('\n');
  const dor = carla.filter(f => /o que (mais )?(te )?(pesa|incomoda)|valor total ou|imprevisibilidade|qual (é )?a (sua )?prioridade|o que seria prioridade/i.test(f.txt)).length;
  const iSol = carla.findIndex(f => /\d+\s*%/.test(f.txt)); // 1ª mensagem com a faixa de desconto = solução apresentada
  return {
    dorRepetida: Math.max(0, dor - 1),
    turnosAteSolucao: iSol >= 0 ? iSol + 1 : null,
    mercadoLivreIndevido: p.conta < 5000 ? carla.filter(f => /mercado livre/i.test(f.txt)).length : 0,
    decisor: (todas.match(/quem decide|decisor/gi) || []).length,
    invencao: (todas.match(/mensalidade|salvei|te aviso quando|pode acabar pagando mais|vou te avisar/gi) || []).length,
    supervisor: r.corrSup,
    chegouNaAgenda: !!r.agendou,
  };
}

(async () => {
  definirTenantLLM(USER, { leadNome: 'simulação' });
  const linhas = [], saida = [];
  for (const p of PERSONAS.filter(x => !SO.length || SO.some(id => x.id.startsWith(id)))) for (let k = 1; k <= RODADAS; k++) {
    const r = await rodar(p).catch(e => ({ falas: [{ quem: 'ERRO', txt: e.message }], corrSup: 0 }));
    const m = metricas(p, r);
    linhas.push({ persona: p.id, rodada: k, ...m });
    const bloco = `\n##### ${p.id} #${k} | dor repetida: ${m.dorRepetida} | turnos até solução: ${m.turnosAteSolucao ?? 'nunca'} | mercado livre indevido: ${m.mercadoLivreIndevido} | decisor: ${m.decisor} | invenção: ${m.invencao} | supervisor: ${m.supervisor}\n`
      + r.falas.map(f => `${f.quem}${f.est !== undefined ? ' [est ' + f.est + ']' : ''}${f.nota || ''}: ${String(f.txt).replace(/\n+/g, ' / ')}`).join('\n');
    console.log(bloco); saida.push(bloco);
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'amostras_voz', '..', 'testes', 'sim_carla_saida.txt'), saida.join('\n'));
  }
  console.log('\n===== RESUMO =====');
  console.table(linhas);
  const soma = (k) => linhas.reduce((a, l) => a + (l[k] || 0), 0);
  const sol = linhas.filter(l => l.turnosAteSolucao).map(l => l.turnosAteSolucao);
  console.log(`dor repetida total: ${soma('dorRepetida')} | mercado livre indevido: ${soma('mercadoLivreIndevido')} | decisor: ${soma('decisor')} | invenção: ${soma('invencao')} | supervisor: ${soma('supervisor')} | solução (faixa de desconto) em ${sol.length}/${linhas.length} conversas, máx ${sol.length ? Math.max(...sol) : '-'} respostas | chegou na agenda em ${linhas.filter(l => l.chegouNaAgenda).length}/${linhas.length}`);
})();
