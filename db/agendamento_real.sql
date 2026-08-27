-- ============================================================================
--  AGENDAMENTO REAL na Google Agenda (Fase B) — colunas de config + de evento
-- ============================================================================
--  Fica INERTE até um tenant conectar a Google Agenda e ativar o booking
--  (booking_ativo=true). Sem isso, o SDR se comporta como hoje.
--  Idempotente. Rode no STAGING primeiro, depois PROD. A tabela leads já tem RLS.
-- ============================================================================

-- Config de booking por tenant (reusa a conexão OAuth já existente em calendar_connections).
ALTER TABLE public.calendar_connections ADD COLUMN IF NOT EXISTS booking_ativo        boolean DEFAULT false;
ALTER TABLE public.calendar_connections ADD COLUMN IF NOT EXISTS booking_calendar_id  text;      -- calendário onde criar; null = usa calendar_id/primary
ALTER TABLE public.calendar_connections ADD COLUMN IF NOT EXISTS booking_hora_inicio  int  DEFAULT 9;   -- expediente BRT
ALTER TABLE public.calendar_connections ADD COLUMN IF NOT EXISTS booking_hora_fim     int  DEFAULT 18;
ALTER TABLE public.calendar_connections ADD COLUMN IF NOT EXISTS booking_duracao_min  int  DEFAULT 30;  -- duração da reunião

-- Estado do agendamento no lead.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS gcal_event_id     text;   -- id do evento criado (prova de booking real)
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS gcal_meet_link    text;   -- link do Google Meet
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS slots_propostos   jsonb;  -- [{inicioISO,fimISO,label}] oferecidos, aguardando confirmação
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS slot_calendar_id  text;   -- calendário usado na proposta
-- Lembrete 24h reutiliza a coluna reminder_sent já existente; aqui só o de 1h antes:
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lembrete_1h_enviado  boolean DEFAULT false;
-- calendly_event_at (data/hora do evento) provavelmente já existe da feature de confirmação;
-- IF NOT EXISTS cobre caso não exista:
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS calendly_event_at timestamptz;
