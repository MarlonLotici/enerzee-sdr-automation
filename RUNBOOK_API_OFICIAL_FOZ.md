# Runbook — Ligar o Foz na WhatsApp API Oficial (Meta Cloud API)

Objetivo: o número que recebe os anúncios do Foz roda na **API oficial da Meta** (imune a
soft-ban, estável, feito pra operação que "não pode oscilar"). O código já está pronto —
isto é só a burocracia + configuração.

> **Regra de ouro:** enquanto a Meta não aprova (leva dias), NÃO aponte anúncio pra número
> Baileys. Se quiser testar a IA antes, use um **número Baileys descartável** (não o do anúncio).

---

## Modelo de contas — 1 Business Manager da Antix → N clientes (decidido)

O que é **compartilhado** e o que é **por cliente**:

| Camada | Como fica |
|---|---|
| **Business Manager (verificação)** | **1 só, o da Antix** — verifica com o CNPJ da Antix **uma única vez** |
| **WABA + número + display name** | **1 por cliente** (o número mostra o nome da empresa DELE aos leads) |
| **Access Token** | por cliente/WABA (o sistema guarda `cloud_api_key` **por chip**) |

- Você **não** re-verifica negócio a cada cliente. Do **2º cliente em diante** é só: adicionar
  **+1 número** dentro do mesmo BM da Antix, criar a WABA/display name dele, gerar/reusar token,
  e rodar o `db/foz_api_oficial.sql` (uma cópia por cliente, trocando os placeholders).
- **Billing:** a Meta cobra a Antix (seu cartão no BM) por conversa — centavos pra inbound.
  Você **embute isso na mensalidade** do cliente (vira margem). O cliente não vê a Meta.
- Quando escalar (~10-15 clientes), reavaliar mover pra BM do próprio cliente ou virar Tech
  Provider oficial — hoje seria over-engineering.

---

## Parte 1 — Burocracia na Meta (você faz; ~1 a 5 dias)

1. **Verificar o negócio da Antix (só 1x na vida)** — [business.facebook.com](https://business.facebook.com):
   - Crie/entre no Business Manager da Antix.
   - Menu **Configurações do Negócio** (engrenagem) → **Central de Segurança** (ou **Verificação
     do Negócio**) → **Iniciar verificação**.
   - Envie os dados/documentos da Antix (CNPJ, comprovante de endereço, etc.). **Comece por aqui —
     é o que mais demora (1-5 dias).** Enquanto não verifica, dá pra ir montando o resto, mas os
     limites de envio ficam baixos até aprovar.
2. **Número dedicado**: consiga um **número de telefone novo** (chip pré-pago serve) que
   **não esteja registrado no app do WhatsApp**. ⚠️ Uma vez na Cloud API, esse número **sai do
   app normal** — não use o celular do Carlos nem o chip atual.
3. **WhatsApp Business Account (WABA)**: em Business Manager → WhatsApp → adicione o número.
   Confirme o código de verificação que a Meta manda por SMS/ligação.
4. **Nome de exibição**: cadastre o nome que aparece pro cliente (ex.: "Foz Energia"). A Meta aprova.
5. Anote os 2 valores:
   - **PHONE_NUMBER_ID**: em **WhatsApp Manager** (ou Configurações do Negócio → Contas → WhatsApp)
     → seu número → **Configuração da API / API Setup**. É um número longo ao lado do telefone.
     (⚠️ NÃO é o número de telefone em si — é o "Phone number ID".)
   - **Access Token permanente**: Configurações do Negócio → **Usuários do sistema** → criar um
     System User (papel Admin) → **Adicionar ativos** → dê acesso à **WABA** do cliente →
     **Gerar novo token** → app do WhatsApp → **sem expiração** → marque `whatsapp_business_messaging`
     e `whatsapp_business_management`. Copie o token na hora (só aparece 1 vez). O token de teste de
     24h NÃO serve pra produção.

---

## Parte 2 — Configuração no nosso lado (me manda os valores que eu ligo, ou você mesmo)

### 2a) Variáveis no Railway (app `antix.up.railway.app`)
- `WHATSAPP_VERIFY_TOKEN` = uma senha qualquer que você inventa (ex.: `foz-verify-8x2k`). Vai ser
  usada no passo do webhook.
- `WHATSAPP_WEBHOOK_SECRET` = outra senha que você inventa (ex.: `foz-hook-93jd`). Protege o webhook.

### 2b) Webhook na Meta (Business Manager → WhatsApp → Configuração → Webhook)
- **Callback URL** (⚠️ **detalhe que quebra silenciosamente se errar**):
  ```
  https://antix.up.railway.app/webhook/whatsapp?instanceId=<CHIP_DO_FOZ>&token=<WHATSAPP_WEBHOOK_SECRET>
  ```
  - `<CHIP_DO_FOZ>` = o `id` do chip do Foz (a query de verificação no `db/foz_api_oficial.sql` te dá).
  - `&token=<...>` **é obrigatório**: a Meta preserva a query string, e é assim que nosso webhook
    confere o segredo. Sem ele, o inbound é recusado **sem erro visível**.
- **Verify token**: exatamente o `WHATSAPP_VERIFY_TOKEN` que você pôs no Railway.
- Clique verificar (a Meta chama o GET e espera o `hub.challenge` — nosso código já responde).
- **Assine o campo `messages`** (é o que entrega as mensagens recebidas).

### 2c) Virar o chip do Foz pra oficial (SQL)
- Abra `db/foz_api_oficial.sql`, troque os 3 placeholders (`cloud_api_key`, `PHONE_NUMBER_ID`,
  `owner_phone` do Carlos) e rode no SQL Editor do Supabase.
- Isso seta `whatsapp_provider='official'` + credenciais + `inbound_only=true` + corrige o
  `owner_phone` (estava nulo → o repasse pro Carlos não funcionaria).

---

## Parte 3 — Teste ANTES de apontar o anúncio (obrigatório)

1. Do seu celular pessoal, mande uma mensagem pro **número oficial** do Foz.
2. Confirme: a mensagem aparece no painel (aba WhatsApp) e a **IA responde** (dentro da janela de 24h,
   resposta é texto livre — sem template).
3. Faça uma conversa de qualificação curta e verifique: nome capturado, 1 pergunta por vez,
   proposta de horário real (Google Agenda) quando pedir pra marcar.
4. Simule o repasse: veja se o handoff pro Carlos dispara pro `owner_phone` setado.
5. Só depois de tudo ok → **aponte os anúncios (click-to-WhatsApp) pro número oficial.**

---

## Notas de custo e operação
- **Custo**: indo direto na Meta (nosso caso), a hospedagem é grátis — paga-se só a conversa. Pra
  inbound (lead fala primeiro, janela de 24h), no Brasil as conversas de serviço são baratas/muitas
  vezes gratuitas. Pra ~40 leads/dia é irrisório.
- **Fora da janela de 24h** (reabrir conversa fria): exige **template aprovado** pela Meta. Pro Foz,
  100% inbound, isso quase não acontece — mas se for usar a confirmação de reunião no dia seguinte,
  aprove 1 template simples.
- **Estabilidade**: some o "chip caindo" — não há socket/proxy; a Meta entrega por webhook.

## Checklist rápido
- [ ] Business verificado na Meta
- [ ] Número novo dedicado + WABA + nome aprovado
- [ ] PHONE_NUMBER_ID + Access Token permanente anotados
- [ ] `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_WEBHOOK_SECRET` no Railway
- [ ] Webhook cadastrado com `?instanceId=...&token=...` + campo `messages` assinado
- [ ] `db/foz_api_oficial.sql` rodado (com owner_phone do Carlos)
- [ ] Teste ponta-a-ponta ok
- [ ] Anúncios apontados pro número oficial
