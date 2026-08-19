# Runbook de Onboarding — por um cliente novo no ar

Checklist repetível pra ativar um cliente. Feito pra rodar sem consultar código. Tempo alvo:
~15 min por cliente (fora a burocracia da Meta, se for API oficial).

> Regra de ouro: faça **tudo no STAGING primeiro** com um número de teste antes de repetir em produção.

---

## 1. Criar a conta

Via script (recomendado):
```bash
node scripts/criar_cliente.js \
  --email cliente@empresa.com \
  --senha SENHA_FORTE_8+ \
  --empresa "Nome da Empresa" \
  --produto solar
```
Requer `ADMIN_SECRET` e `APP_URL`/`PUBLIC_BASE_URL` no ambiente (ou passe `--secret`/`--host`).
Guarde o `user_id` que ele imprime.

Alternativa manual (mesmo efeito):
```bash
curl -X POST "$APP_URL/api/admin/criar-conta" \
  -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"email":"cliente@empresa.com","password":"SENHA_FORTE_8+","nome_empresa":"Nome da Empresa","produto":"solar"}'
```
Entregue email + senha ao cliente (ele troca a senha depois no painel).

---

## 2. Configurar a persona / prompt do tenant

No painel, logado como o cliente (ou via Configurações da Conta):
- **Nome do agente** e **nome da empresa** (persona que aparece nas mensagens).
- **Prompt do tenant** (`tenant_prompts`): a "constituição" do SDR daquele cliente — tom,
  produto, regras de qualificação, link de agendamento (`calendly_link`).
- Se um chip específico precisar de um prompt próprio (ex.: chip de anúncio que recebe lead
  quente), preencha o `system_prompt` **do chip** (override — vale quando tem ≥100 chars).

---

## 3. Conectar o canal do WhatsApp

Escolha **um** por chip:

### Opção A — Baileys (WhatsApp Web, grátis)
1. No painel, adicione um chip novo pra esse cliente.
2. Clique em conectar → o painel mostra o **QR Code** (evento `qr_code`).
3. Escaneie com o WhatsApp do cliente (Aparelhos conectados).
4. Confirme status **PRONTO** no painel de saúde.
> Bom pra funil de anúncio/inbound (lead chega chamando = risco de ban baixíssimo).
> Deixe `inbound_only=true` se o chip só responde (não prospecta frio).

### Opção B — API Oficial (Meta Cloud API — sem risco de ban)
Pré-requisito (burocracia Meta, uma vez por cliente): Meta Business verificado, número na
WABA do cliente, **access token permanente** + **PHONE_NUMBER_ID**, templates de abertura
aprovados. (Rode `db/cloud_api_columns.sql` no banco uma vez, se ainda não rodou.)

1. Ative o provider oficial no chip do cliente:
   ```sql
   UPDATE instances SET
     whatsapp_provider = 'official',
     cloud_api_key  = '<ACCESS_TOKEN_PERMANENTE>',
     cloud_base_url = 'https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>'
   WHERE id = '<instance_id>';
   ```
2. No painel da Meta (WhatsApp → Configuration → Webhook), aponte o webhook pra:
   ```
   https://SEU-HOST/webhook/whatsapp?token=<WHATSAPP_WEBHOOK_SECRET>&instanceId=<instance_id>
   ```
   e no Railway confirme `WHATSAPP_VERIFY_TOKEN` (challenge do GET) e `WHATSAPP_WEBHOOK_SECRET`.
3. Mande uma mensagem do seu celular pro número do cliente → deve chegar no painel e a IA responder.
> Uso hoje é **inbound** (cliente recebe, IA responde na janela de 24h). Outbound frio oficial
> (via template) ainda não está implementado.

---

## 4. Tetos de custo (proteger margem)

Os tetos de LLM são de segurança (globais, altos) e já vêm por default — só ajuste se quiser
apertar via env (`BUDGET_LLM_CEREBRO_DIA`, `BUDGET_LLM_RAPIDO_DIA`, `BUDGET_LLM_VISAO_DIA`).
Se o cliente usa email/voz, configure o teto daquele canal (por chip).

Acompanhe o gasto do dia por cliente em `GET /api/uso` (autenticado como o tenant).

---

## 5. Checklist de "pronto"

- [ ] Conta criada (login funciona).
- [ ] Persona + prompt do tenant configurados.
- [ ] Chip **PRONTO** no `GET /api/health` (Baileys) **ou** inbound oficial chegando (Meta).
- [ ] Uma conversa de ponta a ponta no número de teste (qualificação → agendamento).
- [ ] `GET /api/uso` mostrando o contador subir após a conversa.
- [ ] (Se o cliente usa) confirmação de reunião via Google Agenda ligada (opt-in).

Feito isso, o cliente está no ar.
