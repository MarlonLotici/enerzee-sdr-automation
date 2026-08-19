-- ============================================================================
--  RLS — 2ª CAMADA DE ISOLAMENTO MULTI-TENANT (defesa em profundidade)
-- ============================================================================
--  Contexto: o BACKEND usa a service_role key (SUPABASE_KEY), que IGNORA RLS —
--  ele continua enxergando tudo (correto, precisa disso). Esta migração NÃO muda
--  o backend. Ela protege o OUTRO caminho: o FRONTEND fala com o Supabase pela
--  ANON key + JWT do usuário logado. Sem RLS, o navegador de um cliente consegue
--  ler dados de outro tenant direto no banco. Com RLS, cada tenant só enxerga as
--  próprias linhas — e ainda vira rede de segurança contra bugs de `.eq('user_id')`
--  esquecido na camada de app.
--
--  Hoje só `profiles` e `calendar_connections` têm RLS (ver db/rls_profiles.sql).
--
--  >>> ORDEM DE EXECUÇÃO: rode PRIMEIRO no Supabase de STAGING (SQL Editor),
--      valide (ver bloco de VERIFICAÇÃO no fim), e só então rode em PRODUÇÃO.
--
--  Idempotente: pode rodar mais de uma vez sem efeito colateral (ENABLE é no-op se
--  já ligado; policies são recriadas com DROP ... IF EXISTS antes).
--
--  Rollback (se algo sumir no painel): por tabela,
--      ALTER TABLE public.<tabela> DISABLE ROW LEVEL SECURITY;
-- ============================================================================


-- ----------------------------------------------------------------------------
--  PRÉ-CHECK (rode ISTO ANTES, à parte, e confira que dá 0 em cada tabela).
--  Linhas com user_id NULL ficam INVISÍVEIS pro frontend depois do RLS (o backend
--  service_role ainda as vê). Se der > 0, faça o backfill do user_id antes de
--  aplicar em produção, senão o cliente "perde" esses registros no painel.
-- ----------------------------------------------------------------------------
--  DO $$
--  DECLARE t text; tabelas text[] := ARRAY['instances','leads','messages','client_briefings','tenant_prompts','calls']; n bigint;
--  BEGIN
--    FOREACH t IN ARRAY tabelas LOOP
--      IF to_regclass('public.'||t) IS NULL THEN RAISE NOTICE '%: tabela nao existe (ok, sera ignorada)', t; CONTINUE; END IF;
--      EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id IS NULL', t) INTO n;
--      RAISE NOTICE '%: % linha(s) com user_id NULL', t, n;
--    END LOOP;
--  END $$;
-- ----------------------------------------------------------------------------


-- ============================================================================
--  GRUPO A — TABELAS POR-TENANT (têm coluna user_id)
--  Policy: cada usuário só vê/mexe nas linhas onde user_id = auth.uid().
--  Cobre SELECT/INSERT/UPDATE/DELETE. O backend (service_role) ignora tudo isto.
-- ============================================================================
DO $$
DECLARE
    t text;
    tabelas text[] := ARRAY[
        'instances',        -- frontend lê/edita (chips)
        'leads',            -- frontend lê/edita (pipeline)
        'messages',         -- frontend lê (histórico de conversa); saveMessage já grava user_id
        'client_briefings', -- frontend lê/grava (onboarding briefing)
        'tenant_prompts',   -- hoje só backend, mas tem user_id → policy correta p/ o futuro
        'calls'             -- hoje só backend (voz), mas tem user_id → policy correta
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        -- Pula tabelas que não existem neste banco (ex.: 'calls' se a feature de voz
        -- nunca foi deployada). to_regclass devolve NULL quando a relação não existe.
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'RLS: pulando % (tabela não existe neste banco)', t;
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select_own', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() = user_id);',
            t || '_select_own', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_insert_own', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id);',
            t || '_insert_own', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_update_own', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);',
            t || '_update_own', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_delete_own', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE USING (auth.uid() = user_id);',
            t || '_delete_own', t);

        RAISE NOTICE 'RLS por-tenant aplicado em %', t;
    END LOOP;
END $$;


-- ============================================================================
--  GRUPO B — TABELAS GLOBAIS / DE CREDENCIAL (NÃO têm user_id)
--  RLS LIGADO, SEM POLICY nenhuma → nega TODO acesso via anon/authenticated.
--  O frontend nunca lê estas tabelas; o backend (service_role) ignora o RLS e
--  segue funcionando. Objetivo: impedir que o navegador leia credencial de sessão
--  do WhatsApp (whatsapp_sessions/keys) ou as listas globais.
-- ============================================================================
DO $$
DECLARE
    t text;
    tabelas text[] := ARRAY[
        'blacklist',          -- lista global (whatsapp_id + motivo), sem user_id
        'email_suppression',  -- supressão global por email (LGPD), sem user_id
        'niche_intelligence', -- cache de nichos compartilhado entre tenants, sem user_id
        'whatsapp_sessions',  -- credenciais Baileys (NUNCA devem ir pro browser)
        'whatsapp_keys'       -- cache de chaves Baileys (idem)
    ];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'RLS lockdown: pulando % (tabela não existe neste banco)', t;
            CONTINUE;
        END IF;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        -- Nenhuma policy criada de propósito: sem policy + RLS on = deny-all pra anon.
        -- Limpa qualquer policy legada que porventura exista (mantém o deny-all).
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select_own', t);
        RAISE NOTICE 'RLS lockdown (deny-all anon) aplicado em %', t;
    END LOOP;
END $$;


-- ============================================================================
--  VERIFICAÇÃO (rodar DEPOIS, no staging, antes de ir pra prod)
-- ============================================================================
--  1) Confirmar que o RLS está ligado em todas:
--     SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('instances','leads','messages','client_briefings','tenant_prompts',
--                       'calls','blacklist','email_suppression','niche_intelligence',
--                       'whatsapp_sessions','whatsapp_keys')
--     ORDER BY relname;   -- relrowsecurity deve ser TRUE em todas.
--
--  2) No painel logado como Tenant A: confirmar que só aparecem os leads/conversas do A.
--     Criar/logar um Tenant B e confirmar que ele NÃO vê nada do A.
--
--  3) No console do navegador (aba do painel, já autenticado), rodar:
--        const { data } = await window.supabase.from('leads').select('id,user_id')
--     e conferir que todo user_id retornado é o do usuário logado (nunca de outro).
--
--  4) Backend intacto: o SDR (service_role) deve continuar salvando mensagem e lendo
--     histórico normalmente — mandar uma mensagem no número de teste e ver a conversa
--     fluir. Se o backend quebrasse, seria sinal de que alguma conexão está usando a
--     anon key por engano (não deveria).
-- ============================================================================
