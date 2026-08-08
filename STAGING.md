# STAGING — Ambiente de teste isolado

**Por que existe:** pra você testar código novo **sem arriscar Reino, Lince e Antix**. A proteção real não é
mágica — é o **fluxo**: produção só recebe código que já passou no staging.

```
branch `staging`  →  Railway staging deploya sozinho  →  testa no número/tenant de teste
     →  passou?  →  merge `staging` → `versao-profissional`  →  produção deploya
```

O código é 100% orientado por variáveis de ambiente. O **mesmo código** roda em staging e em prod — muda só o
`.env`. Nenhuma alteração de código é necessária pra suportar dois ambientes.

> ⚠️ **A regra de ouro deste ambiente:** nenhuma variável do staging pode apontar pro **Supabase, Redis ou
> domínio de produção**. Um erro aqui e um teste atinge cliente real — aí o staging não serve pra nada.
> O passo 5 é uma checklist só pra confirmar isso.

---

## Divisão de tarefas

| Faço eu (repo)                              | Faz você (dashboards)                                   |
|---------------------------------------------|---------------------------------------------------------|
| Branch `staging`                            | Criar projeto **Supabase staging** + clonar schema      |
| `.env.staging.example` (mapa das variáveis) | Criar **serviço Railway staging** + Redis + variáveis   |
| `STAGING.md` (este runbook)                 | Escanear o **número de teste** no QR                     |
| Código do fix de nome (na branch staging)   | Criar 1 **tenant de teste** no Supabase staging         |

---

## Passo 1 — Criar o projeto Supabase de staging

1. https://supabase.com/dashboard → **New project** (free tier serve). Nome sugerido: `enerzee-staging`.
2. Guarde a senha do banco (você vai precisar pra `pg_dump`/`psql`).
3. Em **Project Settings → API**, anote: `Project URL`, `anon key`, `service_role key`.
4. Em **Project Settings → Database → Connection string (URI)**, anote a connection string.

## Passo 2 — Clonar o schema de produção pro staging (clone fiel)

Isso copia **só a estrutura** (tabelas, PK, FK, defaults, RLS, triggers) — **sem dados de cliente**.
Você precisa do `pg_dump`/`psql` (vêm com o Postgres client; no Windows, instale via
`winget install PostgreSQL.PostgreSQL` ou use o console SQL do Supabase como fallback — ver abaixo).

Pegue as duas connection strings em Supabase → Project Settings → Database (URI) de cada projeto.

```bash
# 1) Exporta SÓ o schema de PRODUÇÃO (sem dados) pra um arquivo
pg_dump --schema-only --no-owner --no-privileges -n public \
  "postgresql://postgres:SENHA_PROD@HOST_PROD:5432/postgres" > schema_prod.sql

# 2) Restaura o schema no STAGING
psql "postgresql://postgres:SENHA_STAGING@HOST_STAGING:5432/postgres" < schema_prod.sql
```

> **Fallback sem pg_dump:** no dashboard de PROD, SQL Editor, não dá pra exportar schema completo com 1 clique.
> Se não conseguir rodar `pg_dump`, me peça que eu gero um `db/schema.sql` aproximado a partir do mapa de colunas
> que já conhecemos. Limitação honesta: esse fallback **não traz FK/defaults/RLS/triggers** — sobe o app, mas não
> é clone perfeito. Prefira o `pg_dump`.

## Passo 3 — Aplicar as policies RLS no staging

As policies RLS não vêm no dump padrão em todos os casos. Rode no **SQL Editor do staging** as mesmas policies de
prod. Inclui a policy de UPDATE em `profiles` do fix de nome (eu entrego o SQL junto do fix).

## Passo 4 — Criar o serviço Railway de staging

Duas opções — escolha uma:

- **Opção A (recomendada): Environments.** No projeto Railway → menu de ambiente (topo) → **New Environment** →
  nome `staging`. Nesse ambiente, aponte o serviço pra branch **`staging`** (Service → Settings → Source →
  Branch = `staging`).
- **Opção B: serviço novo.** New Service → Deploy from GitHub repo → mesmo repo → branch `staging`.

Depois, no ambiente staging:
1. **Adicione um Redis** (New → Database → Redis). Copie a `REDIS_URL` que ele gera.
2. **Variables:** cole tudo do `.env.staging.example`, preenchendo com os valores do **Supabase staging** (passo 1),
   do **Redis staging** (acima) e do **domínio staging** (o Railway gera em Settings → Networking → Generate Domain).
3. Deploy.

## Passo 5 — ✅ Checklist de isolamento (NÃO PULE)

Antes de mandar qualquer mensagem de teste, confirme no painel Variables do staging:

- [ ] `SUPABASE_URL` / `VITE_SUPABASE_URL` = projeto **staging** (NÃO o de prod)
- [ ] `REDIS_URL` = Redis **do staging** (NÃO o de prod)
- [ ] `PUBLIC_BASE_URL` / `APP_URL` = domínio **staging** (NÃO o de prod)
- [ ] `ADMIN_SECRET` = segredo diferente do de prod
- [ ] `PROXY_BASE_URL` vazio (número de teste roda no IP do Railway)

## Passo 6 — Conectar o número de teste + tenant de teste

1. Abra o frontend de staging (o domínio Railway do staging).
2. Crie 1 conta/tenant de teste (Supabase staging) pra simular um cliente.
3. Escaneie o QR com o **número de teste** (não use número de cliente).
4. Mande uma mensagem pro número de teste e confirme que a IA responde. **Boot smoke ok = staging vivo.**

---

## Fluxo de trabalho diário (a partir de agora)

1. Trabalho vai pra branch **`staging`** → Railway staging deploya sozinho.
2. Testo no número/tenant de teste.
3. Passou? **Checklist pré-merge:** `npm test` + `npm run build` + smoke no domínio de staging.
4. Merge `staging` → `versao-profissional` → produção deploya (com o mesmo checklist já verde).

Produção **nunca mais** recebe código não testado.

---

## Fora de escopo (por ora)
- CI/CD automatizado (GitHub Actions) — dá pra somar depois; o fluxo manual branch→merge já resolve.
- Réplica de dados reais no staging — de propósito: schema vazio + tenant de teste, sem dado de cliente.
