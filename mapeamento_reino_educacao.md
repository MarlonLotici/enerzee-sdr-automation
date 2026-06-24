# Mapeamento de Bugs — Reino Educação SDR

**Sistema:** Pipeline de SDR WhatsApp (Node.js + Baileys + Groq LLM)  
**Tenant:** Reino Educação (chips: Chip Mar, Chip Per — instâncias criadas pelo user 4c11a89e)  
**Contexto:** Sistema B2B solar adaptado para uso B2C de educação. Os alunos já compraram o produto "Comandor IA" (criado pelo Cristiano Cris / Crix) e estão sendo abordados para reengajamento.

---

## Bug 1 — Contexto "milhas e renda extra" contamina a primeira resposta

**Conversa observada:**
```
SDR: "Oie Hélio! Aqui é a Luna da Reino Educação, vi que você é nosso aluno do Comandor IA."
SDR: "Estou fazendo um acompanhamento rápido, você já conseguiu começar a estudar e aplicar nosso método?"
Lead: "Ola boa tarde"
SDR: "Boa tarde! Tudo bem? Você está procurando uma forma de viajar mais ou criar uma nova fonte de renda com milhas?"  ← ERRADO
```

**Causa provável:** O `llm_prompt` do opening_template no Supabase (tabela `opening_templates`) contém contexto de "milhas e renda extra" que pertence a outro produto/tenant. Quando o lead responde à abertura e a IA gera a primeira resposta de acompanhamento, esse contexto vaza para a resposta.

**Código relevante (`4_sdr.js:54-70`):**
```js
function gerarContextoNicho(niche) {
    if (!niche) return '';
    const n = niche.toLowerCase();
    if (n.includes('restaurante') || ...) return '...câmara fria...';
    // ... outros nichos B2B solar
    return `\nCONTEXTO DE NICHO: Empresa do ramo de ${niche}. Adapte a linguagem ao setor quando possível.`;
}
```

Se `lead.niche` no banco contiver algo como "milhas", "viagem" ou "renda", essa função injetaria o texto errado. Também pode ser o `llm_prompt` do template de abertura em Supabase estar errado — verificar campo `opening_templates.llm_prompt` para os chips da Reino Educação.

**Impacto:** Primeira impressão de contexto completamente errado. Lead fica confuso.

**Fix:** Verificar e corrigir o `llm_prompt` em `opening_templates` para os chips Chip Mar e Chip Per. Se `lead.niche` estiver errado no banco, corrigir também.

---

## Bug 2 — "RCC Premium" tratada como nome de empresa

**Conversa observada:**
```
SDR: "Que legal que me atendeu! Você consegue me passar o contato do responsável pelo Comandador IA na RCC Premium?"
SDR: "Entendi, então você está aberto a novas oportunidades? Você gostaria de saber mais sobre como podemos ajudar a RCC Premium?"
```

**Causa (código `4_sdr.js:873` e `4_sdr.js:1010`):**
```js
// linha 873 — pega lead.name como se fosse empresa
const nomeEmpresa = limparNomeEmpresa(contextoLead.name);

// linha 1010 — injeta no prompt do LLM com label "Empresa"
const secaoRegional = `[CONTEXTO DO LEAD]
- Localização: ${bairroLead}
- Empresa: ${nomeEmpresa}   ← "RCC Premium" aparece aqui
- ${perfilComportamental}`;
```

No banco B2B solar, `lead.name` é o nome da empresa scrapeada (ex: "Padaria Central Ltda"). No banco B2C da Reino Educação, `lead.name` contém o nome do produto adquirido ("RCC Premium - 6 meses"). O LLM recebe `Empresa: RCC Premium` e infere que está falando com uma empresa chamada "RCC Premium", gerando respostas como "podemos ajudar a RCC Premium".

**Fix:**
1. Adicionar coluna `b2c_mode boolean default false` na tabela `instances`.
2. Para os chips da Reino Educação, setar `b2c_mode = true` no Supabase.
3. No código, quando `b2c_mode = true`, trocar a seção do prompt:

```js
const secaoRegional = instanceData?.b2c_mode
    ? `[CONTEXTO DO LEAD]
- Produto adquirido: ${nomeEmpresa}
- CONTEXTO B2C: O lead já é cliente/aluno. NÃO há empresa envolvida. É uma pessoa física que comprou o produto. Você é o acompanhamento pós-venda, não uma prospecção. O próprio lead é o decisor — NUNCA pergunte por "responsável".`
    : `[CONTEXTO DO LEAD]
- Localização: ${bairroLead}
- Empresa: ${nomeEmpresa}
- ${perfilComportamental}`;
```

---

## Bug 3 — Pergunta de gatekeeper B2B em conversa B2C

**Conversa observada:**
```
Lead: "É do Cristiano cris?"
SDR: "Que legal que me atendeu! Você consegue me passar o contato do responsável pelo Comandador IA na RCC Premium?"
```

**Causa (`4_sdr.js:1000` — diretriz fixa no prompt):**
```js
const secaoDiretrizes = `[DIRETRIZES DE FECHAMENTO]
...
- EMPATIA COM GATEKEEPER (REGRA DE OURO): Quando alguém disser que não é o decisor,
  NUNCA pule direto para "vai passar o contato?". Primeiro: agradeça a atenção...
  Só então, de forma leve e natural, pergunte se consegue uma ponte com o responsável.
```

A pergunta "É do Cristiano Cris?" foi interpretada pelo LLM como alguém dizendo que não é o decisor (como um recepcionista que atende em nome do dono). O LLM aplicou a regra de gatekeeper e pediu o "responsável". Mas o lead IS o decisor — é o próprio aluno que comprou o produto.

**Fix:** Quando `b2c_mode = true`, remover a diretriz de gatekeeper do prompt. Adicionar instrução contrária:
```
- B2C OBRIGATÓRIO: A pessoa que responde é o próprio aluno e decisor. NUNCA pergunte por "responsável". Se perguntarem de onde somos, explicar que é o acompanhamento do Comandor IA, produto do Cristiano Cris (Crix).
```

---

## Bug 4 — [SUSPEITA_BOT] em mensagens humanas

**Conversas observadas:**
```
Lead: "[SUSPEITA_BOT] É do Cristiano cris?"           ← humano perguntando de onde é
Lead: "[SUSPEITA_BOT] No momento não estou mexendo com nada"   ← resposta natural
Lead: "[SUSPEITA_BOT] Gostaria sim"                   ← confirmação humana
Lead: "[SUSPEITA_BOT] Não sei onde está o meu acesso ao curso" ← pedido de ajuda real
```

**Causa (`4_sdr.js:1985-1990`):**
```js
// A função salva a mensagem com prefixo [SUSPEITA_BOT] quando detecta padrão de bot no histórico
if (await avaliarRiscoRoboComHistorico(histParaBot)) {
    await db.saveMessage(lead.whatsapp_id, 'user', `[SUSPEITA_BOT] ${texto}`, instanceId);
    await supabase.from('leads').update({ is_paused: true }).eq('id', lead.id);
    return; // IA PARA DE RESPONDER
}
```

`avaliarRiscoRoboComHistorico` (`4_sdr.js:604-624`) detecta bot quando:
- SDR enviou 4+ mensagens E nenhuma mensagem do lead tem "sinal humano"
- OU últimas 3 mensagens do lead: todas < 25 chars E sem sinal humano

`detectarSinalHumano` (`4_sdr.js:589-599`) aceita como humano apenas:
```js
/\b(eu|minha?|meu|noss[ao]|nossa\s+empresa|minha\s+empresa)\b/i  // pronomes
/\b(tô|tá|num|tava|tamo|né|cara|ó|oxe|poxa)\b/i                 // gírias
/R\$\s*[\d.,]+/                                                   // valores
/\d{4,}/                                                          // números longos
```

Respostas B2C naturais que FALHAM:
- "Boa tarde" → ❌ sem pronome, sem gíria, sem R$, sem número
- "Não me lembro" → ❌
- "É do Cristiano Cris?" → ❌
- "Seria bom" → ❌
- "Gostaria sim" → ❌

O sistema foi calibrado para B2B solar onde humanos mencionam kWh, CNPJ, "nossa empresa". Alunos B2C de curso online falam de forma mais casual e curta.

**Fix:**
1. Adicionar coluna `bot_detection_enabled boolean default true` na tabela `instances`.
2. Para os chips da Reino Educação, setar `bot_detection_enabled = false`.
3. No código, antes de chamar `avaliarRiscoRoboComHistorico`, verificar a flag:
```js
const botDetectionAtivo = instanceData?.bot_detection_enabled !== false;
if (botDetectionAtivo && await avaliarRiscoRoboComHistorico(histParaBot)) {
    // ... pausar lead
}
```

---

## Bug 5 — Bot ignora pergunta direta do aluno (sobre como começar/acessar o curso)

**Conversa observada:**
```
Lead: "Por onde começo a estudar?"
SDR: "Vou te ajudar a criar um plano para começar. Qual é o seu objetivo principal com o Comandor IA, é viajar mais ou criar uma renda extra?"
←  ignorou a pergunta e voltou ao script de qualificação

Lead: "Não sei onde está o meu acesso ao curso, tive imprevistos familiares e acabei deixando tudo de lado. Você pode me mandar o acesso ao curso novamente?"
SDR: "Por onde você acha que devo começar? Viagens ou renda extra. Gostaria das duas opções."
← ignorou completamente o pedido de ajuda
```

**Causa:** O `system_prompt` / `llm_prompt` do agente está orientado para qualificação e fechamento (SDR de vendas), não para suporte pós-venda. Quando um aluno faz uma pergunta de suporte, o LLM tenta redirecionar para o script de qualificação ao invés de responder.

**Fix:** No `system_prompt` das instâncias da Reino Educação (ou no template), adicionar instruções de suporte:
```
SUPORTE AO ALUNO:
- Se o aluno perguntar por onde começar → responder: "Comece pelo módulo introdutório na plataforma. Quer que eu te mande o link de acesso?"
- Se o aluno disser que não tem acesso ou não encontra o curso → responder: "Confira o email que você usou para comprar o curso, o acesso foi enviado para lá. Se não encontrar, me manda o email que te ajudo a recuperar."
- Se o aluno perguntar sobre o Cristiano Cris / Crix → responder: "Sim! O Comandor IA é uma ferramenta criada pelo Cristiano Cris (Crix). Você vai aprender a usar no curso."
- NUNCA redirecionar para script de vendas quando o aluno está pedindo ajuda com acesso ou dúvida sobre o produto.
```

---

## Bug 6 — Demora de resposta / lead sem resposta

**Observado:** Um lead da Cristiane aguardou mais de 1h sem resposta após enviar "Não sei onde está o meu acesso ao curso" (15:47). O SDR anterior respondeu às 15:46 e depois a conversa parou.

**Causa provável:** O Bug 4 (SUSPEITA_BOT) pausa o lead automaticamente. Uma vez pausado com `is_paused = true`, nenhuma mensagem nova recebe resposta, mesmo que o lead escreva. O lead fica "preso" aguardando intervenção manual no painel.

**Confirmação:** O bug de `[SUSPEITA_BOT]` no mesmo lead (Cristiane) aconteceu às 15:47 — exatamente quando as respostas pararam.

**Fix secundário:** Quando um lead é pausado por suspeita de bot, o gestor deveria receber alerta IMEDIATO com a conversa para reativar manualmente se necessário. Verificar se o `enviarAlerta()` está sendo chamado nesse fluxo (está no código, mas verificar se o webhook do Discord está configurado).

---

## Resumo das mudanças necessárias

| # | Tipo | Onde | Ação |
|---|------|------|------|
| 1 | Supabase | `opening_templates.llm_prompt` (chips Chip Mar e Chip Per) | Remover contexto "milhas/viagem" — substituir por contexto correto do Comandor IA |
| 2 | Supabase + código | Tabela `instances` + `4_sdr.js:1009` | Adicionar `b2c_mode=true` + trocar label "Empresa" por "Produto adquirido" + instrução B2C no prompt |
| 3 | Código | `4_sdr.js:1000` (secaoDiretrizes) | Quando `b2c_mode`, remover regra de gatekeeper e adicionar instrução B2C |
| 4 | Supabase + código | Tabela `instances` + `4_sdr.js:1985` | Adicionar `bot_detection_enabled=false` para chips Reino + checar flag antes de pausar |
| 5 | Supabase | `system_prompt` / `llm_prompt` das instâncias Reino | Adicionar bloco de suporte ao aluno: acesso, Cristiano Cris, onde começar |
| 6 | Consequência do fix 4 | — | Quando bot_detection_enabled=false, bug 6 (lead parado) também se resolve |

**Prioridade sugerida:**
1. Fix 1 (Supabase only — imediato, zero risco)
2. Fix 5 (Supabase only — imediato, zero risco)  
3. Fixes 2+3+4 juntos (código — deploy necessário)
