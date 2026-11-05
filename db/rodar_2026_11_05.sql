-- ============================================================================
--  RODAR UMA VEZ (2026-11-05) — performance + pausa humana + origem de anúncio
--  Supabase → SQL Editor → colar tudo → Run. Idempotente: pode rodar de novo.
--    Seções 1–4: PERFORMANCE (índices + RLS sem recálculo por linha)
--    Seção 5:    COLUNAS NOVAS em leads (marcos da pausa humana + referral do anúncio)
-- ============================================================================
--  Contexto: banco Nano com CPU 96% e Disk IO Balance 7% com só 45 MB de dados.
--  Consultas simples levavam 10–40s. Três causas, todas corrigidas aqui:
--
--  1) messages SEM índice por conversa: o painel (lista de conversas, a cada 20s) e o
--     backend (SALVAMENTO a cada 3 min, histórico da IA) fazem
--       WHERE whatsapp_id = ? [AND user_id = ?] ORDER BY created_at DESC LIMIT n
--     → sem índice, cada uma varre e ordena a tabela inteira.
--  2) leads sem índice para os filtros do painel/pipeline (user_id + status + ordem).
--  3) RLS com `auth.uid() = user_id`: o Postgres reavalia auth.uid() para CADA LINHA
--     lida. Envolvendo em `(select auth.uid())` ele avalia UMA vez por consulta
--     (recomendação oficial do Supabase — lint "auth_rls_initplan"). Mesma regra de
--     acesso, mesmo nome de policy: só muda o custo.
--
--  Idempotente (IF NOT EXISTS / DROP IF EXISTS). Tabelas pequenas → cada índice cria
--  em milissegundos (não precisa de CONCURRENTLY). Pode rodar de novo sem efeito.
-- ============================================================================

-- ---------- 1. messages ----------
CREATE INDEX IF NOT EXISTS idx_messages_wa_user_created
    ON public.messages (whatsapp_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_created
    ON public.messages (user_id, created_at DESC);

-- ---------- 2. leads ----------
CREATE INDEX IF NOT EXISTS idx_leads_user_status_contact
    ON public.leads (user_id, status, last_contact_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_instance_status
    ON public.leads (instance_id, status, is_paused);
CREATE INDEX IF NOT EXISTS idx_leads_followup_pausados
    ON public.leads (follow_up_at) WHERE is_paused = true;

-- ---------- 3. RLS: (select auth.uid()) — avaliado 1x por consulta ----------
DO $$
DECLARE
    t text;
    tabelas text[] := ARRAY['instances', 'leads', 'messages', 'client_briefings', 'tenant_prompts', 'calls'];
BEGIN
    FOREACH t IN ARRAY tabelas LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'RLS: pulando % (tabela não existe)', t;
            CONTINUE;
        END IF;

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING ((select auth.uid()) = user_id);', t || '_select_own', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_insert_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK ((select auth.uid()) = user_id);', t || '_insert_own', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_update_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);', t || '_update_own', t);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_delete_own', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING ((select auth.uid()) = user_id);', t || '_delete_own', t);

        RAISE NOTICE 'RLS otimizado em %', t;
    END LOOP;
END $$;

-- ---------- 4. Estatísticas atualizadas pro planejador usar os índices ----------
ANALYZE public.messages;
ANALYZE public.leads;

-- ---------- 5. COLUNAS NOVAS em leads ----------
-- Marcos da PAUSA HUMANA (o código já grava; sem estas colunas o update falha em silêncio):
--   ultima_intervencao_humana_em → quando uma pessoa da equipe respondeu pelo painel (nunca é apagado)
--   ia_retomada_em               → quando a IA voltou a responder depois da pausa
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ultima_intervencao_humana_em timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ia_retomada_em timestamptz;
-- Origem de ANÚNCIO (Click-to-WhatsApp): referral da 1ª mensagem (id do anúncio + id do clique)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ad_referral jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ad_source_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ad_ctwa_clid text;
CREATE INDEX IF NOT EXISTS idx_leads_ad_source ON public.leads (ad_source_id) WHERE ad_source_id IS NOT NULL;

-- ---------- Conferência (opcional): deve listar os índices novos ----------
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('messages','leads') ORDER BY 1;
