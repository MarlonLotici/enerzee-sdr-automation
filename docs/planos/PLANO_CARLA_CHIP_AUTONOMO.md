# Plano: Carla (Enerzee) sem travar na dor, sem identidade da Antix vazando e com voz mais expressiva

Data: 2026-11-24. Autor do diagnóstico: sessão anterior (Opus). Executor: Sonnet.
Repositório: `C:\dev\enerzee-sdr-automation`. Produção = branch `versao-profissional` (Railway, projeto `optimistic-trust`, serviço `enerzee-sdr-automation`). Último deploy: `8182a39`.

## 0. Contexto em 1 minuto

- A Carla é o chip `7ca283d1-d28f-4c9b-a97e-17568e21f749` (conta Enerzee, user `cf8950a2-318f-47b5-831c-ee697d8c5c51`), WhatsApp oficial, número +55 48 8824-5113. O prompt dela fica em `instances.system_prompt` (override por chip) e o texto-fonte está em `docs/clientes/enerzee-consultoria/prompt_carla.md`.
- **É o ÚNICO chip com `system_prompt` próprio hoje** (conferido no banco). Tudo que este plano condicionar a "chip com prompt próprio" afeta SÓ a Carla. A Sofia (Antix, Chip Kau `290a03b9…`) e os outros clientes NÃO podem mudar de comportamento.
- Sintoma: a Carla fica repetindo a pergunta de dor ("o que mais pesa: valor ou imprevisibilidade?") mesmo depois de o cliente responder, oferece mercado livre para conta de R$ 800, pergunta "quem decide na empresa" e repete frases quando o cliente responde "aham".
- Causa (provada em logs + simulação): o prompt da Carla é menos da metade do que o modelo lê (~6.200 tokens por resposta). O resto é texto fixo do código, que vem DEPOIS do prompt do chip e vence:
  1. `agents/closerAgent.js` linhas 9-15, `BLOCO_CICLO_AGENDAMENTO`: "EXPLORAR A DIFICULDADE… como faz hoje, o que trava… clientes perdidos… Precisa de pelo menos UMA resposta… antes de seguir". Injetado nos modos DUVIDA e LIXO.
  2. `4_sdr.js` ~1181, `REGRA_ROTEIRO` (dentro de `resolverPromptCompleto`): "SPIN… Não avance sem entender…" + bloco "não seja interrogatório" com exemplos da Antix.
  3. `agents/supervisorAgent.js`: julga pelo SPIN e REESCREVE a resposta (`nao_explora_necessidade`, `pulou_etapa`, `nao_pediu_nome`). Foi 8 das 11 reescritas na conversa real. Legenda de estágios dele (3 = qualificação) contradiz a da Carla (3 = solução).
  4. `closerAgent.js` modo DUVIDA: regras de "decisor" → gera "quem decide isso na empresa?".
  5. `closerAgent.js` modo LIXO: "NUNCA repita… Mude o ângulo… termine sempre com pergunta aberta focada no negócio dele" → frases quase repetidas e perguntas novas a cada "aham".
  6. `closerAgent.js` DNA do vendedor: "Você NÃO precisa desta venda. Há outras empresas na fila", "preciso te dar baixa aqui" (tom de closer agressivo, ruim para conta de luz residencial).
  7. `closerAgent.js` regra 4: exemplo hardcoded `("de 30 a 40%")`, que é o percentual do mercado livre e contamina respostas de assinatura.
  8. `4_sdr.js` ~1155 `REGRA_ANTI_INVENCAO`: "NUNCA ofereça prospecção ativa… Nosso foco é atender e qualificar quem chega" (escopo da Antix) e exemplo "time na call".
  9. `4_sdr.js` ~5748 `avisoCiclo` (retry quando o closer promete horário cedo): manda "pergunte sobre essa dificuldade (como faz hoje, o que trava)".
- Vazamentos de identidade da Antix fora do prompt:
  - `4_sdr.js:4852` descrição do evento do Google: "Agendado pela SDR IA (Antix)".
  - `4_sdr.js:4937` e `4_sdr.js:5176` textos de agenda dizem "nosso especialista" (a Carla fala "consultor").
  - `4_sdr.js:1094` fallback de link `https://antix.com.br/agendar` quando não há agenda, `calendly_link` nem `owner_phone` (a Carla tem os dois vazios).
  - `enviarBriefingReuniao` (~4602) usa `tenant_prompts.system_prompt` (prompt antigo Lorena/solar) como contexto do negócio, e não o prompt do chip.
- O que NÃO mistura (não mexer): não há `MAPA_*`/texto solar no `4_sdr.js`; `perfilComportamental` só entra se o prompt usar o placeholder; REVEAL só para `product_type='antix'`; ciclo de venda (`lib/cicloVenda.js`) só para o tenant Antix; web chat (linhas ~6890-7060) é só da Antix.

## Regras para quem executa

- Não mudar comportamento da Sofia nem de outros tenants. Toda mudança de funil fica atrás da flag "chip autônomo" (definida no passo 1.1). Mudanças de identidade (passo 2) usam dados do próprio chip, com o comportamento atual como default.
- Não imprimir tokens/segredos. Não colar saídas com credenciais.
- Arquivos usam CRLF em parte do repo: ao editar via script, preserve o fim de linha. Prefira o Edit tool.
- A working tree está no branch `feat/ansi-prospeccao` com mudanças não relacionadas e não commitadas (planos do Gemini, scripts). Não commite nada que não seja deste plano.
- Suíte: `node --test test/*.test.js` (hoje 404 passando). Não use `node --test test/` (quebra).
- Não use `git worktree remove --force` em worktree que tenha junction de `node_modules` (já apagou o `node_modules` do projeto uma vez). Ver seção Deploy.

## Fase 1: modo "chip autônomo" (código)

Objetivo: quando o chip tem `system_prompt` próprio, o modelo segue o funil DO PROMPT. Saem os blocos de funil/identidade da Antix; ficam só travas de segurança neutras.

### 1.1 Definir a flag

- Em `4_sdr.js`, no worker (~linha 5440), já existe `const overrideChipWorker = instanceData?.system_prompt?.trim();` com teste `length >= 100`. Crie logo após: `const chipAutonomo = !!(overrideChipWorker && overrideChipWorker.length >= 100);`.
- Passe a flag para:
  - `resolverPromptCompleto(promptBase, lead, instanceData, historico, { ..., chipAutonomo })` na chamada da linha ~5464 (é o 5º argumento `extras`).
  - TODAS as chamadas de `closerAgent.gerarRespostaCloser` do worker (linhas ~5546, 5578, 5582, 5619, 5646, 5665, 5670, 5683, 5720, 5749): acrescente `chipAutonomo` no objeto `opcoes`. Não mexa na chamada do web chat (~7055).
  - O gate do Supervisor (~5780).
- Para as outras chamadas de `resolverPromptCompleto` (linhas ~1264 e ~5905), calcule a flag do mesmo jeito a partir de `instanceData?.system_prompt` se o `promptBase` vier do chip; se não for trivial, deixe sem flag (default false = comportamento atual) e anote no relatório.

### 1.2 `resolverPromptCompleto` (4_sdr.js ~1003-1201)

- Ler `const chipAutonomo = extras.chipAutonomo === true;`.
- Extrair as seções fixas para um módulo puro e testável: criar `lib/promptSecoes.js` com `function secoesFixas({ chipAutonomo, companyName })` que devolve `{ roteiro, antiInvencao }`:
  - `chipAutonomo === false`: devolve EXATAMENTE os textos atuais de `REGRA_ROTEIRO` e `REGRA_ANTI_INVENCAO` (copiar sem alterar uma vírgula; o comportamento da Sofia não pode mudar).
  - `chipAutonomo === true`:
    - `roteiro` = versão mínima e neutra, por exemplo:
      ```
      [COMO CONDUZIR]
      Siga as etapas e regras do SEU prompt acima; elas valem mais que qualquer outra instrução.
      Cada resposta precisa conversar com o que a pessoa ACABOU de dizer: se ela perguntou algo ou disse que não se encaixa, responda isso primeiro.
      Nunca pergunte de novo algo que a pessoa já respondeu.
      ```
    - `antiInvencao` = a regra atual SEM a linha "NUNCA ofereça prospecção ativa…" e trocando o exemplo "time na call" por "o consultor confirma isso na conversa". Manter: não inventar preço/desconto/política/prazo/link, não confirmar reunião sozinho, sem travessão, responder no idioma do lead.
- Substituir na concatenação final (linha ~1200) `REGRA_ROTEIRO` e `REGRA_ANTI_INVENCAO` pelos valores de `secoesFixas(...)`. Manter a ORDEM atual (fixo primeiro, variável no fim) por causa do cache do prompt.
- `secaoPerguntarNome`: no modo autônomo, manter (é útil), mas só se o prompt do chip não tiver regra própria de nome. Simples: manter igual.
- Fallback de link (linha ~1094): `https://antix.com.br/agendar` só pode ser usado quando `(contextoLead?.user_id || instanceData?.user_id) === ANTIX_USER_ID` (constante já importada de `lib/discordTenant`). Para os outros, quando não há agenda, `calendly_link` nem `owner_phone`, usar o texto `'NÃO envie nenhum link — diga que o consultor vai chamar pra combinar o horário'`.

### 1.3 `agents/closerAgent.js`

Ler `const chipAutonomo = opcoes.chipAutonomo === true;` no início de `gerarRespostaCloser`.

- `BLOCO_CICLO_AGENDAMENTO` (DUVIDA e LIXO): no autônomo, trocar por um bloco neutro de agendamento:
  ```
  🔁 AGENDAMENTO: siga as etapas do seu prompt. Só convide para a reunião depois de apresentar a solução, e só fale de horário depois que a pessoa aceitar o convite (o sistema mostra os horários reais). Exceção: se a própria pessoa pedir para marcar, pode ir direto ao convite.
  ```
- Modo DUVIDA, no autônomo: remover as linhas de "decisor" ("HARD RULE — PROIBIDO CONFIRMAÇÕES VAZIAS: Se o lead confirmar que é o decisor…" e "OBRIGATÓRIO: Se o lead confirmar que é o decisor, mude imediatamente para [ESTAGIO:1]") e o "PROIBIDO: Saltar direto para o CTA sem qualificar a dor do lead". Manter: responder à dúvida com confiança, linguagem simples, flexibilidade de nome.
- Modo LIXO, no autônomo, trocar o bloco por:
  ```
  💬 MENSAGEM CURTA ("ok", "aham", "sim", "entendi")
  - Se você tinha feito uma pergunta de sim/não e a resposta é "sim/aham", trate como resposta e AVANCE para a próxima etapa do seu prompt.
  - Não repita nem reformule a frase que você acabou de mandar.
  - Se a pessoa só concordou com o que você disse, siga para a próxima etapa do seu prompt (não invente pergunta nova sobre a dor).
  ```
- DNA do vendedor, no autônomo: remover "AUTORIDADE RELAXADA" inteira ("Você NÃO precisa desta venda…", "não aceita depois te respondo…", "preciso te dar baixa aqui…") e "FRASES RECOMENDADAS" (convertem); manter "ESTILO" (exceto "Você é um CLOSER" no título → título neutro "🎭 ESTILO DE CONVERSA"), "FRASES PROIBIDAS" e as REGRAS ABSOLUTAS.
- Regra 4 (TODOS os modos, inclusive Sofia, porque é só exemplo): trocar `Fale em % ("de 30 a 40%") ou um número real…` por `Fale em % que esteja nas suas instruções ou um número real…`. ATENÇÃO: isso muda o texto da Sofia; é seguro (exemplo neutro), mas verifique que nenhum teste depende do texto antigo.
- Regra 3 "EXCEÇÃO: … REVEAL ANTIX": no autônomo, tirar "REVEAL ANTIX" da lista.
- `primeiroContato`, `blocoBookingAuto`, `blocoStandby`, `blocoVoz`, modos COMPRA/REPASSE: manter como estão (COMPRA com Antix só entra se `isAntix`).
- Manter a ordem do `promptFinal` (prompt do chip primeiro, DNA/regras, `blocosVariaveis` no fim) por causa do cache.

### 1.4 Supervisor

- Em `agents/supervisorAgent.js`, exportar uma função pura `filtrarProblemas(problemas, { chipAutonomo })`:
  - autônomo: manter só `inventou`, `agendamento_fake`, `agendou_cedo`, `empilhou_perguntas`, `textao`, `inconsistente`. Descartar `nao_explora_necessidade`, `pulou_etapa`, `pulou_acolhida`, `nao_pediu_nome`, `contexto_incoerente`, `robotico`.
  - não autônomo: devolve a lista intacta.
- Em `4_sdr.js` no gate (~5790): após `revisar(...)`, aplicar `filtrarProblemas(_crit.problemas, { chipAutonomo })`; se sobrar lista vazia, NÃO chamar `corrigir` (mantém o rascunho) e logar `🧑‍⚖️ [SUPERVISOR] Ignorado no chip autônomo: [lista original]`.
- Alternativa aceitável se a anterior der trabalho: no autônomo, pular o Supervisor inteiro (log `Pulado: chip autônomo`). A simulação mostrou 0 problema de qualidade relevante sem ele; a perda é a checagem de invenção. Preferir a versão com filtro.

### 1.5 Retry `avisoCiclo` (4_sdr.js ~5748)

- No autônomo, trocar o final do aviso ("Siga o ciclo: se ainda não explorou a dificuldade dele… pergunte sobre essa dificuldade (como faz hoje, o que trava). Se já explorou, mostre como a gente resolve essa dor.") por: "Siga as etapas do seu prompt: se ainda não apresentou a solução, apresente agora; se já apresentou, pergunte se faz sentido uma conversa com o consultor."

### 1.6 Testes (obrigatórios)

- `test/promptSecoes.test.js`: `secoesFixas({chipAutonomo:false})` === textos atuais (copiar as strings esperadas do código antigo) e `chipAutonomo:true` NÃO contém "SPIN", "prospecção", "Instagram", "time na call".
- `test/closerPrompt.test.js`: stubar `../lib/llm` via `require.cache` (mesma técnica usada para `budgetGuard` em scripts de simulação) para capturar o `system` passado a `chamarLLM`. Casos:
  - autônomo + DUVIDA: não contém "EXPLORAR A DIFICULDADE", "decisor", "Você NÃO precisa desta venda", "de 30 a 40%".
  - autônomo + LIXO: não contém "Mude o ângulo".
  - não autônomo (Sofia): contém "EXPLORAR A DIFICULDADE" e "decisor" (prova que a Sofia não mudou), e não contém "de 30 a 40%".
- `test/supervisorFiltro.test.js`: `filtrarProblemas` nos dois modos.
- Rodar `node --test test/*.test.js` → tudo verde (404 + novos).

## Fase 2: identidade por cliente (agenda e briefing)

- `4_sdr.js:4852` descrição do evento: `Agendado pela SDR IA (${instanceData?.company_name || 'IA'})`. Confirmar que `instanceData` está no escopo de `efetivar` (é usado logo abaixo em `avisarDonoSeNaoForEle(instanceData, …)`).
- "nosso especialista" (`4_sdr.js` ~4917, 4927, 4930, 4937, 5176): criar helper `termoEspecialista(instanceData)` → `'consultor'` se `/\bconsultor/i.test(instanceData?.system_prompt || '')`, senão `'especialista'` (default = comportamento atual). Usar nas frases (`nosso ${termo}`, `um ${termo}`).
- `enviarBriefingReuniao` (~4602): contexto do negócio = `instanceData?.system_prompt` (se >= 100 caracteres) senão `tenant_prompts.system_prompt`. Se `instanceData` vier sem `system_prompt`, buscar `instances.system_prompt` por `instanceData.id`.
- Testes: unitário do `termoEspecialista` (pode ficar em `lib/`).

## Fase 3: prompt da Carla (banco + arquivo-fonte)

Editar `docs/clientes/enerzee-consultoria/prompt_carla.md` e aplicar no banco (UPDATE em `instances.system_prompt` do chip da Carla, extraindo o texto após a linha `---`; fazer backup do valor atual antes, em `docs/backups/`).

Acrescentar ao final do prompt (é o bloco "B" que passou na simulação, com os defeitos corrigidos):

```
[REGRAS DE FASE — valem mais que qualquer outra instrução acima]
1) PRODUTO PELO VALOR DA CONTA: conta abaixo de R$ 5 mil por mês = SEMPRE energia por assinatura, mesmo sendo empresa. Mercado livre SÓ com conta acima de R$ 5 mil E ligação trifásica. Nunca ofereça mercado livre pra conta menor.
2) O QUE VOCÊ PRECISA SABER antes da solução (uma pergunta por vez, sem repetir o que já sabe): casa ou empresa, valor médio da conta e o ESTADO ou cidade (sem o estado você não sabe o desconto).
3) DOR: assim que a pessoa disser UMA coisa que incomoda (valor alto, custo, reajuste, variação), a dor está mapeada. Proibido perguntar a dor de novo ("o que mais pesa", "valor ou imprevisibilidade", "o que seria prioridade"). Se ela já chegou dizendo que quer pagar menos, a dor já está mapeada.
4) Com os 3 dados, a PRÓXIMA mensagem é a SOLUÇÃO: espelhe o que ela disse, diga a faixa de desconto da tabela para o estado dela, sem obra e sem investimento, e termine com UMA pergunta de validação ("isso faria sentido pra você?"). Marque [ESTAGIO:3].
5) Depois de um sim/ok à solução: CONVITE para a conversa de 30 minutos com o consultor. Marque [ESTAGIO:4]. Não fale de horário antes do sim.
6) Pergunta ou "não me encaixo": responda primeiro, com a verdade, em no máximo 2 frases. Se disser que não se encaixa no mercado livre, ofereça a assinatura.
7) NÃO pergunte quem decide na empresa.
8) Conta abaixo de R$ 300: diga com honestidade que a assinatura em geral não compensa nesse valor e que o consultor pode avaliar outra opção. NÃO fale de "mensalidade", NÃO diga que a pessoa pode pagar mais, e NÃO prometa avisar no futuro nem "salvar o número" (o sistema não faz isso).
9) Encerramento: depois que a pessoa se despedir ("até", "valeu", "obrigado"), responda UMA vez, curto, e não continue a troca de despedidas.
10) Sempre termine com [ESTAGIO:N] coerente: 1 situação, 2 dor, 3 solução, 4 convite, 5 agendado.
```

Também no prompt existente: trocar a pergunta de dor sugerida no estágio 2 (lista "conta alta, aumento recente, bandeira tarifária, custo da empresa") por uma instrução de UMA pergunta só ("o que mais te incomoda na conta hoje?"), para evitar o vício "valor ou imprevisibilidade".

## Fase 4: voz mais expressiva (Carla e Sofia usam a voz `RGymW84CSmfVugnA5tvA`)

Hoje TODOS os áudios saem com tom `neutro` (`lib/tomVoz.js`: stability 0.50, style 0.15, speed 1.00). Modelo em produção: `eleven_multilingual_v2` (env `ELEVENLABS_MODEL_ID`). O TTS de produção é `ttsElevenLabs.js` (raiz).

1. Em `scripts/amostras_voz.js`, aceitar overrides por env (`VOZ_STABILITY`, `VOZ_STYLE`, `VOZ_SPEED`) aplicados sobre `configVozParaTom('neutro', MODELO)`, e um sufixo no nome do arquivo para não sobrescrever.
2. Gerar 3 amostras com a voz `RGymW84CSmfVugnA5tvA` e uma frase com pergunta e exclamação (ex.: "Oi! Aqui é a Carla, da Enerzee. Que bom que você chamou! Me conta: a sua conta de luz tá vindo em quanto por mês?"):
   - A: stability 0.40, style 0.30, speed 1.02
   - B: stability 0.33, style 0.45, speed 1.04
   - C: stability 0.28, style 0.55, speed 1.05
   Comando (na pasta linkada ao Railway, para usar a chave sem imprimir):
   `railway run -s enerzee-sdr-automation node C:/dev/enerzee-sdr-automation/scripts/amostras_voz.js RGymW84CSmfVugnA5tvA` com as envs acima.
   Arquivos em `docs/amostras_voz/`.
3. **Parar e pedir ao Marlon** que ouça e escolha. Só depois: alterar `PRESETS.neutro` em `lib/tomVoz.js` com os valores escolhidos (vale para Carla e Sofia; os outros tons ficam).
4. Ênfase em "?" e "!": testar na mesma rodada uma variante do texto em que a frase com "?" ou "!" vai separada por ponto (frases curtas). Se a diferença for audível, documentar como regra de escrita (frases curtas antes da pergunta), sem mexer no código.
5. Teste existente de `tomVoz` (se houver) deve continuar verde; ajustar só a expectativa dos números de `neutro`.

## Fase 5: validação

1. Copiar o simulador `C:\Users\marlo\AppData\Local\Temp\claude\c--dev-enerzee-sdr-automation\87dfa27f-4852-4b04-9f30-2dad2a6ed7c3\scratchpad\sim_carla.cjs` para `scripts/sim_carla.cjs` (se o arquivo não existir mais, recriar: cliente simulado por LLM `MODELOS.cerebro` × Closer + Supervisor, sem gravar no banco nem enviar WhatsApp, com stub de `budgetGuard` via `require.cache`).
   - Corrigir o defeito conhecido: dar a PRIMEIRA fala de cada persona fixa (o cliente simulado do perfil "empresa grande" começou a conversa no meio).
   - Fazer o simulador passar `chipAutonomo: true` ao Closer e aplicar `filtrarProblemas` no Supervisor, igual à produção.
   - Ler o prompt do banco (o que está em produção) ou do `.md`.
   - Rodar com `railway run -s enerzee-sdr-automation node scripts/sim_carla.cjs` na pasta linkada (scratchpad `rl/` da sessão anterior ou `railway link --project optimistic-trust` num diretório temporário).
2. Personas mínimas: replay da conversa real (empresa SC R$ 800, "O valor", pergunta "como funciona", "não me enquadro no mercado livre"), casa PR R$ 450 objetiva, indústria SP R$ 18 mil trifásica, desconfiada MG R$ 350 ("é golpe?"), conta baixa BA R$ 180. Pelo menos 2 rodadas por persona.
3. Metas (todas):
   - perguntas de dor repetidas: no máximo 1 por conversa;
   - solução (faixa de desconto do estado) em até 4 respostas da Carla;
   - zero mercado livre para conta < R$ 5 mil;
   - zero "quem decide";
   - zero invenção ("mensalidade", "salvei seu número", preço/prazo fora da tabela);
   - reescritas do Supervisor: só as das chaves permitidas.
4. Entregar ao Marlon a tabela de métricas + 2 conversas de exemplo.
5. Deploy (abaixo) e pedir ao Marlon um teste real com a Carla. Ler os logs (`railway logs -s enerzee-sdr-automation -d --lines 1500`, filtrar `ROTEADOR|SUPERVISOR|Texto limpo|💲`).

## Deploy (produção = `versao-profissional`)

1. `git fetch origin` e conferir que só os arquivos deste plano diferem de `origin/versao-profissional`:
   `git diff --stat origin/versao-profissional -- 4_sdr.js agents/ lib/ test/ scripts/`
2. Worktree limpa SEM junction: `git worktree add -b deploy/carla-autonomo C:/dev/_deploy_carla origin/versao-profissional`, copiar só os arquivos alterados (`cp`), commitar lá com a mensagem terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. Os testes rodam na working tree principal (tem `node_modules`). Na worktree só `node --check` dos arquivos.
4. **Pedir autorização explícita ao Marlon antes do push.** Depois: `git push origin deploy/carla-autonomo:versao-profissional`.
5. Aguardar `railway deployment list -s enerzee-sdr-automation` = SUCCESS; conferir boot nos logs (`Ligando SDR: Enerzee (Carla)`, `Chip Kau`) e painel HTTP 200 em `https://antix.up.railway.app/`.
6. Remover a worktree (`git worktree remove C:/dev/_deploy_carla`, sem `--force`) e apagar o branch local.
7. O prompt da Carla (Fase 3) vive no banco: aplicar o UPDATE depois do deploy do código. O servidor cacheia as regras do chip por 30 minutos: rodar `railway restart -s enerzee-sdr-automation -y` depois do UPDATE.

## Ordem de execução

1. Fase 1 (código autônomo + testes) e Fase 2 (identidade) no mesmo commit.
2. Fase 3 (prompt) preparado no `.md`, sem aplicar.
3. Fase 5 passos 1-4 (simulação com o código novo + prompt novo).
4. Se as metas baterem: pedir autorização, deploy, UPDATE do prompt, restart, teste real.
5. Fase 4 (voz) em paralelo: gerar amostras, esperar a escolha do Marlon, aplicar no próximo deploy.

## Plano B (se a Fase 5 não bater as metas)

Estender o ciclo de venda em código (`lib/cicloVenda.js`) para a Carla: hoje `tenantComCiclo` só aceita a Antix e os textos (`SOLUCAO_FIXA`, `CONVITES_FIXOS`, `RE_SOLUCAO`, blocos de fase) falam de "agente de IA" e "especialista". Seria preciso parametrizar por tenant (textos e regex de solução: "desconto", "assinatura", "%") antes de ligar `CICLO_SOLUCAO_USER_IDS` para `cf8950a2…`. Só fazer depois de mostrar ao Marlon que o modo autônomo não bastou.

## Riscos e cuidados

- Regra 4 do Closer (exemplo "30 a 40%") muda o texto também para a Sofia. É neutro, mas confirmar com a suíte.
- `chipAutonomo` depende de `system_prompt` >= 100 caracteres. Se no futuro outro cliente ganhar prompt por chip, ele também entra no modo autônomo (é o desejado: o prompt do chip manda).
- Não mexer em `lib/cicloVenda.js` nem no fluxo do web chat neste plano.
- Ao final: atualizar a memória `project_chip_enerzee_carla_2026_11_23.md` com o que foi feito e o hash do deploy.
