-- ============================================================================
--  B — LEAD POR TENANT: unique global (whatsapp_id) → composto (whatsapp_id, user_id)
-- ============================================================================
--  PROBLEMA: hoje o mesmo número só existe 1x na tabela leads (unique GLOBAL em
--  whatsapp_id). Quando um número fala com 2 tenants, o lead "pula" de dono
--  (a re-vinculação sobrescreve user_id) → pausa/estágio/status TROCADOS entre contas,
--  e o operador vê conversa de outro tenant. Este é o núcleo do vazamento de isolamento.
--
--  FIX: unicidade POR TENANT — (whatsapp_id, user_id). Cada conta tem o SEU próprio lead
--  do mesmo número, isolado. Um insert de um segundo tenant passa a SUCEDER (não colide),
--  então não há mais roubo/re-vinculação entre contas.
--
--  Backend (service_role) não é afetado; muda só a REGRA DE UNICIDADE.
--  Idempotente. Rode no SQL Editor.
--
--  >>> ORDEM: rode ESTE SQL PRIMEIRO. Só depois suba o código novo (onConflict composto +
--      recuperação escopada por user_id). Rodar o SQL antes garante zero janela de regressão.
--
--  SEGURO: como o unique global garantia whatsapp_id único, NÃO existem pares
--  (whatsapp_id, user_id) duplicados hoje → a criação do composto não vai falhar.
--
--  ROLLBACK:
--     ALTER TABLE public.leads DROP CONSTRAINT leads_whatsapp_user_unique;
--     ALTER TABLE public.leads ADD CONSTRAINT unique_whatsapp_id UNIQUE (whatsapp_id);
-- ============================================================================

-- 1) Remove o unique GLOBAL de whatsapp_id. O nome no banco é 'unique_whatsapp_id'
--    (confirmado via pg_constraint). DROP ... IF EXISTS é idempotente e seguro.
--    Se um dia o nome for outro, rode a query de VERIFICAÇÃO abaixo pra descobrir e ajuste.
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS unique_whatsapp_id;

-- 2) Cria o unique COMPOSTO (whatsapp_id, user_id) — idempotente.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_whatsapp_user_unique') THEN
        ALTER TABLE public.leads
            ADD CONSTRAINT leads_whatsapp_user_unique UNIQUE (whatsapp_id, user_id);
        RAISE NOTICE 'Criado unique composto (whatsapp_id, user_id).';
    ELSE
        RAISE NOTICE 'Unique composto já existe — nada a fazer.';
    END IF;
END $$;

-- ============================================================================
--  VERIFICAÇÃO (rode depois):
--    SELECT conname, pg_get_constraintdef(oid) AS def
--    FROM pg_constraint
--    WHERE conrelid = 'public.leads'::regclass AND contype = 'u';
--  Esperado: aparece leads_whatsapp_user_unique UNIQUE (whatsapp_id, user_id)
--            e NENHUMA unique só de (whatsapp_id).
-- ============================================================================
