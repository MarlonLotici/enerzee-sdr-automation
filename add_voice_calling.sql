-- =============================================================================
-- Ligações de Voz IA (Twilio Media Streams) — Migração de Banco (Supabase)
-- Execute UMA ÚNICA VEZ no SQL Editor do Supabase antes de testar.
-- =============================================================================

-- [1] Tabela de histórico de tentativas de ligação.
-- Diferente do Calendly (evento único → colunas flat em leads), uma ligação pode
-- ser tentada N vezes por lead — o histórico precisa de linhas próprias.
CREATE TABLE IF NOT EXISTS public.calls (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id           UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    instance_id       UUID REFERENCES public.instances(id) ON DELETE SET NULL,
    user_id           UUID NOT NULL,
    trigger           TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'auto'
    twilio_call_sid   TEXT,
    status            TEXT NOT NULL DEFAULT 'queued',   -- queued/initiated/ringing/in-progress/completed/failed/no-answer/busy/canceled
    outcome           TEXT,                             -- booked/callback_requested/not_interested/no_answer/voicemail/wrong_number/failed
    started_at        TIMESTAMP WITH TIME ZONE,
    ended_at          TIMESTAMP WITH TIME ZONE,
    duration_seconds  INTEGER,
    transcript        JSONB,                            -- [{speaker:'ai'|'lead', text, at}]
    cost_cents        INTEGER,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_lead ON public.calls (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_sid  ON public.calls (twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_user ON public.calls (user_id, created_at DESC);

-- [2] Colunas de estado "atual" no leads — mesmo padrão das colunas do Calendly.
-- do_not_call é OBRIGATÓRIO checar antes de qualquer disparo (LGPD/Não Me Perturbe).
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS last_call_at           TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS last_call_status       TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS last_call_outcome      TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS call_attempts_count    INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_call_scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS do_not_call            BOOLEAN DEFAULT FALSE;

-- [3] Flags por instância — mesmo padrão de use_email_outbound / use_sms_outbound.
ALTER TABLE public.instances
    ADD COLUMN IF NOT EXISTS use_voice_outbound       BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS voice_calling_hour_start SMALLINT DEFAULT 9,
    ADD COLUMN IF NOT EXISTS voice_calling_hour_end   SMALLINT DEFAULT 19,
    ADD COLUMN IF NOT EXISTS max_calls_per_day        INTEGER DEFAULT 20;

-- Verificação: confirma as colunas criadas
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'calls')
   OR (table_name = 'leads'     AND column_name LIKE '%call%')
   OR (table_name = 'instances' AND column_name LIKE '%voice%')
ORDER BY table_name, column_name;
