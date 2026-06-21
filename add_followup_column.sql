-- =============================================================================
-- Motor de Follow-Up Inteligente — Migração de Banco (Supabase)
-- Execute UMA ÚNICA VEZ no SQL Editor do Supabase antes de testar.
-- =============================================================================

-- Adiciona a coluna follow_up_at na tabela leads (se ainda não existir)
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Índice para a query do Despertador (verificarFollowUpsVencidos)
-- Filtra is_paused=true E follow_up_at <= NOW(), tornando a varredura de 1 min barata.
CREATE INDEX IF NOT EXISTS idx_leads_followup
    ON public.leads (is_paused, follow_up_at)
    WHERE follow_up_at IS NOT NULL;

-- Verificação: confirma que a coluna existe após o comando
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'leads' AND column_name = 'follow_up_at';
