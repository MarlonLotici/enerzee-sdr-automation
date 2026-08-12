-- ============================================================================
--  Feature: Confirmação diária de reuniões via Google Agenda (SDR das 11h)
--  Rode PRIMEIRO no Supabase de STAGING; valide; só então em PRODUÇÃO.
--  Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS). Seguro rodar de novo.
-- ============================================================================

-- 1) Conexão Google por tenant (1 linha por conta). Tokens fora de profiles.
CREATE TABLE IF NOT EXISTS public.calendar_connections (
    user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    provider           text NOT NULL DEFAULT 'google',
    refresh_token      text,                       -- token de longa duração (troca por access token)
    google_email       text,                       -- email da conta Google conectada
    calendar_id        text,                       -- agenda escolhida (ex.: marlon.lotici@reinoeducacao.com)
    confirmacao_ativa  boolean NOT NULL DEFAULT false,
    confirmacao_hora   int NOT NULL DEFAULT 11,     -- hora BRT do disparo diário
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

-- O tenant só enxerga/edita a própria conexão. O refresh_token é sensível: o backend usa a
-- SERVICE ROLE key (que ignora RLS) pra ler o token no job; o cliente nunca precisa lê-lo.
DROP POLICY IF EXISTS "cc_select_own" ON public.calendar_connections;
CREATE POLICY "cc_select_own" ON public.calendar_connections
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "cc_insert_own" ON public.calendar_connections;
CREATE POLICY "cc_insert_own" ON public.calendar_connections
    FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "cc_update_own" ON public.calendar_connections;
CREATE POLICY "cc_update_own" ON public.calendar_connections
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2) Colunas de confirmação no lead.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS confirmacao_status     text;   -- pendente|confirmado|desmarcado
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS confirmacao_pedido_em  timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS gcal_event_id          text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS gcal_calendar_id       text;

-- Índice pra achar rápido o lead pelo evento (idempotência do job) e os pendentes de hoje.
CREATE INDEX IF NOT EXISTS idx_leads_gcal_event ON public.leads (gcal_event_id);
CREATE INDEX IF NOT EXISTS idx_leads_confirmacao ON public.leads (confirmacao_status) WHERE confirmacao_status = 'pendente';
