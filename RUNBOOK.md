# RUNBOOK — Antix (operação & recuperação)

Guia prático pra quando algo quebra ou precisa de deploy. Fatos de infra que NÃO são óbvios
no código. Mantenha atualizado.

---

## 1. Fatos de infra (decore ou volte aqui)

| O quê | Valor |
|---|---|
| **Branch de PRODUÇÃO** | `versao-profissional` (NÃO é `main` nem `staging`) |
| Branch de staging | `staging` (2º env no Railway, Supabase separado) |
| `main` | desatualizada (~25 commits atrás) — **não** é usada pra deploy |
| URL de prod | https://antix.up.railway.app |
| Supabase de prod | projeto `pzkyuanzmbjbczabaxud` (mesmo do `.env` local) |
| Número oficial Antix | +55 48 9820-3038 · PHONE_NUMBER_ID `1366136896578904` · WABA `1114782524418024` |
| App Meta | "Antix Colony API" (ID `1255597746733405`) |
| Chip oficial Antix | instance id `290a03b9-85aa-4afb-9527-1c2453588e66` (user_id Antix `f437f090…`) |
| Token da Meta | vem do env **`WA_TOKEN`** no Railway (NUNCA gravado no banco) |

---

## 2. Como fazer deploy pra PROD

```bash
# 1. Trabalhe e valide na staging
git checkout staging
npm test                      # 123 testes têm que passar
git add <arquivos> && git commit -m "..."
git push

# 2. Veja EXATAMENTE o que vai pra prod (não só seus commits)
git log origin/versao-profissional..staging --oneline

# 3. Fast-forward pra prod (sem divergência = sem conflito) + push
git checkout versao-profissional
git pull --ff-only origin versao-profissional
git merge --ff-only staging
git push origin versao-profissional     # Railway redeploya sozinho

git checkout staging          # volta pro branch de trabalho
```

### Rollback (se o deploy quebrou)
```bash
git checkout versao-profissional
git reset --hard <commit_anterior_bom>   # ex.: o hash antes do merge
git push --force origin versao-profissional
```

### Smoke test pós-deploy (SEMPRE, 3 min)
1. `curl -s -X POST https://antix.up.railway.app/api/web-chat -H "Content-Type: application/json" -d '{"sessionId":"smoke","message":"oi"}'` → deve responder.
2. Manda "oi" do WhatsApp pro número oficial → ✓✓ azul + resposta + aparece no painel.
3. Railway → Deployments → deploy novo está **verde (Success)**.

---

## 3. Modos de falha conhecidos → conserto

### "WhatsApp não responde, sem ✓✓, nada no painel"
O webhook não está sendo processado. Em ordem de probabilidade:

1. **Chip oficial não existe no banco** (foi deletado). Verifique:
   ```
   SELECT id,name,whatsapp_provider FROM instances WHERE whatsapp_provider='official';
   ```
   Se vazio → **recrie** (ver seção 4).
2. **Token do webhook errado na URL da Meta.** A Callback URL (Meta → WhatsApp → Configuration)
   tem que ser exatamente:
   `https://antix.up.railway.app/webhook/whatsapp?instanceId=290a03b9-85aa-4afb-9527-1c2453588e66&token=<WHATSAPP_WEBHOOK_SECRET>`
   Nos logs do Railway: se aparece `🚫 [WA-WEBHOOK] Inbound DESCARTADO` → token errado.
3. **WABA não inscrita no app.** Checar: `GET graph.facebook.com/v20.0/<WABA_ID>/subscribed_apps` (Bearer = WA_TOKEN) → o app `1255597746733405` tem que aparecer. Se vazio → `POST` no mesmo endpoint reinscreve.

### "Recebeu e salvou (✓✓ + painel), mas não respondeu"
Token da Meta expirou. Renove o `WA_TOKEN` no Railway (System User token permanente é o ideal).

### "Travou — só respondeu quando outra mensagem chegou"
Worker da fila ficou parado (stall de Redis). A rede de segurança (`loopRecuperacaoConversas`,
roda a cada 3 min) reenfileira e destrava. Se recorrente, investigar a conexão Redis do worker.

### "Prod não reflete o código novo"
Confirme que deployou de `versao-profissional` (não main/staging). Reinicie o serviço no Railway
pra limpar cache de regras (`cacheRegrasInstancia`).

---

## 4. Recriar o chip oficial da Antix (se foi deletado)

⚠️ "Remover chip" no painel APAGA a linha da instância inteira. Pra só desconectar, use
"Resetar Sessão" — nunca "Remover". Se já foi removido, recrie via INSERT no Supabase:

```sql
INSERT INTO public.instances
  (id, user_id, name, agent_name, company_name, whatsapp_provider,
   cloud_api_key, cloud_base_url, inbound_only, firing_paused, dry_run,
   whatsapp_status, product_type, daily_limit, use_email_outbound, use_sms_outbound)
VALUES
  ('290a03b9-85aa-4afb-9527-1c2453588e66',
   'f437f090-5fa0-4a94-b4aa-8c22998c9cf6',
   'Chip Kau', 'Sofia', 'Antix', 'official',
   NULL,                                                      -- token vem do env WA_TOKEN
   'https://graph.facebook.com/v25.0/1366136896578904',      -- base + PHONE_NUMBER_ID
   true, true, false, 'CONNECTED', 'generico', 20, false, false);
```

Depois: reinicie o serviço no Railway + mande "oi" de teste. Referência: `db/sofia_api_oficial.sql`.

---

## 5. Reset de conversa pra teste (zerar um número)

```sql
-- troque pelo whatsapp_id real (formato 55DDNUMERO@s.whatsapp.net)
DELETE FROM messages WHERE whatsapp_id = '55...@s.whatsapp.net';
DELETE FROM leads    WHERE whatsapp_id = '55...@s.whatsapp.net';
```
Próxima mensagem vira primeiro contato (lead novo, sem histórico/estágio).

---

## 6. Regra de ouro

Nunca misture **disparo frio / número de teste** com o **número oficial de um cliente**. Disparo
em número oficial verificado = risco de ban que derruba o canal real do cliente. Teste de disparo
sempre em chip Baileys separado e descartável.
