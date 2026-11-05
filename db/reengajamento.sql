-- ============================================================================
--  REENGAJAMENTO de quem sumiu (2026-11-05)
--  Supabase → SQL Editor → colar tudo → Run. Idempotente.
--
--  Lead que ESCREVEU PRIMEIRO, a Sofia respondeu e ele não falou mais:
--    • 45 min depois da última fala da Sofia  → "Fulano, estou aqui pra te ajudar... consegue falar agora e testar como funciono?"
--    • ~22 h depois da última msg DO LEAD     → "Fulano, respeito seu tempo e decisão... Desejo uma ótima semana!"
--  Só de 08:00 às 21:00 (Brasília); nunca depois de 23,5 h do lead (janela de 24h da Meta).
--
--  Fica DESLIGADO por padrão em cada chip: o texto fala em "testar como funciono", que só serve pra Antix.
--  Outros clientes (ex.: Foz) ligam só quando tiverem o próprio texto (colunas reengaj_msg_*).
-- ============================================================================
ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS reengajamento_ativo boolean NOT NULL DEFAULT false;
-- Textos próprios do cliente (opcionais). Use {nome} onde entra o primeiro nome. Vazio = texto padrão da Antix.
ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS reengaj_msg_lembrete text;
ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS reengaj_msg_despedida text;

-- Liga no chip da Antix (Chip Kau):
UPDATE public.instances SET reengajamento_ativo = true
 WHERE id = '290a03b9-85aa-4afb-9527-1c2453588e66';

-- Conferência: SELECT id, name, reengajamento_ativo FROM public.instances;
