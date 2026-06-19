-- =============================================================================
-- Anti-Ban P0 — SQLs para rodar no Supabase SQL Editor (uma única vez)
-- Branch: hotfix/p0-anti-ban-sdr-auto
-- =============================================================================

-- [1] Índice para getDailyContactCount (database.js:90)
-- Essa query roda a cada iteração do loop de disparo de cada chip.
-- Sem índice: Supabase faz full-scan em leads a cada checagem de limite.
-- Com índice: lookup direto por chip + data.
CREATE INDEX IF NOT EXISTS idx_leads_daily_count
    ON public.leads (instance_id, last_contact_at)
    WHERE followup_count = 0;

-- [2] Índice auxiliar para lookup de leads por chip (usado em múltiplos pontos do 4_sdr.js)
CREATE INDEX IF NOT EXISTS idx_leads_instance_status
    ON public.leads (instance_id, status);

-- [3] Garante que a coluna proxy_url existe em instances
-- (O código original já selecionava essa coluna. Se ela não existir, o SELECT falhava silenciosamente.)
-- SAFE: IF NOT EXISTS — se já existir, não faz nada.
ALTER TABLE public.instances
    ADD COLUMN IF NOT EXISTS proxy_url TEXT DEFAULT NULL;

-- [4] Garante que o valor 'proxy_failed' é aceito em whatsapp_status
-- Verifica primeiro se a coluna é TEXT ou ENUM. Se for TEXT, não precisa de ALTER.
-- Se for ENUM, rode o bloco abaixo. Caso contrário, IGNORE este bloco.
-- ATENÇÃO: Rode este bloco SOMENTE se whatsapp_status for do tipo ENUM no seu banco.
-- Para verificar: SELECT data_type FROM information_schema.columns WHERE table_name='instances' AND column_name='whatsapp_status';
-- DO $$
-- BEGIN
--     IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'proxy_failed'
--                    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'whatsapp_status_enum')) THEN
--         ALTER TYPE whatsapp_status_enum ADD VALUE IF NOT EXISTS 'proxy_failed';
--     END IF;
-- END $$;
