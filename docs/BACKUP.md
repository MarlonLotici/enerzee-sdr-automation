# Backup & Restore — Supabase (plano Free)

O Supabase Free **não tem PITR** (point-in-time recovery). Sem backup, um erro operacional
(um `DELETE` errado, um `DROP TABLE`) perde dados de cliente pagante sem volta. Este projeto
tem um backup lógico simples que roda em qualquer lugar com Node.

## O que o backup cobre

`scripts/backup_supabase.js` exporta as **linhas** das tabelas críticas de negócio
(`leads`, `messages`, `conversations`, `instances`, `tenant_prompts`, `client_briefings`,
`calls`, `profiles`, `calendar_connections`, `blacklist`, `email_suppression`,
`niche_intelligence`) num JSON gzipado e sobe pra um **bucket privado** do Supabase Storage,
com retenção por idade.

**Não** inclui: schema/índices/RLS policies (é snapshot de dados), nem as credenciais Baileys
(`whatsapp_sessions`/`whatsapp_keys` — efêmeras, re-QR resolve).

## Rodar manualmente

```bash
node scripts/backup_supabase.js
```

Env necessárias (já existem em prod):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_KEY`)

Opcionais:
- `BACKUP_BUCKET` (default `backups`)
- `BACKUP_RETENTION_DAYS` (default `14`)
- `BACKUP_TABLES` (CSV pra sobrescrever a lista padrão)

Saída esperada:
```
✅ [BACKUP] backups/backup-2026-08-18-03-00-00.json.gz (742.1 KB) — leads=1240, messages=8830, ...
🧹 [BACKUP] Retenção: removidos 1 backup(s) > 14 dias.
```

## Agendar (diário) no Railway

Crie um **serviço de cron** no Railway (ou use o Cron Schedule do serviço) apontando pro mesmo
repositório, com:
- **Schedule:** `0 6 * * *` (06:00 UTC ≈ 03:00 BRT, madrugada)
- **Start command:** `node scripts/backup_supabase.js`
- As mesmas env vars do serviço principal (SUPABASE_URL + service role).

## Restore (a partir de um `.json.gz`)

1. Baixe o arquivo do bucket `backups` (painel Supabase → Storage → backups) ou via API.
2. Descomprima e leia o JSON:
   ```bash
   gunzip -c backup-2026-08-18-03-00-00.json.gz > backup.json
   ```
   Estrutura: `{ geradoEm, tabelas: { leads: [...], messages: [...], ... } }`.
3. Re-insira as linhas na tabela alvo (num projeto novo ou após recriar a tabela). Ex. via um
   script pontual usando `supabase.from('<tabela>').upsert(linhas, { onConflict: 'id' })` em
   lotes de 500. (Faça num projeto de STAGING/descartável primeiro pra validar.)

## Fidelidade total (schema + dados) — quando precisar

Pro dia a dia o backup acima basta. Se quiser um dump SQL completo (schema, índices, policies),
rode o `pg_dump` **localmente** (na sua máquina, que tem o Postgres client), usando a connection
string direta do Supabase (Project Settings → Database → Connection string → URI):

```bash
pg_dump "postgresql://postgres:[SENHA]@[HOST]:5432/postgres" -Fc -f enerzee-full.dump
```

Guarde esse `.dump` **fora** do Supabase (off-site) — é o que garante DR se o projeto inteiro cair.
Restore: `pg_restore -d "postgresql://..." enerzee-full.dump`.

## DR de verdade (off-site) — próximo passo quando o volume crescer

O bucket de backup vive no mesmo projeto Supabase. Pra sobreviver à perda do projeto inteiro,
aponte o backup pra um storage externo (Backblaze B2 / S3) ou baixe os `.json.gz` periodicamente
pra fora. Fica como evolução — pro estágio de 15 clientes, o backup diário no bucket já cobre o
risco real (erro humano no banco).
