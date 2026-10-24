-- ============================================================================
--  CAMPANHAS DE REAQUECIMENTO DE BASE (WhatsApp API oficial) — Migração Supabase
-- ============================================================================
--  O cliente (tenant) importa a PRÓPRIA base de clientes e dispara campanhas com
--  TEMPLATE APROVADO pela Meta (obrigatório fora da janela de 24h). Quem responde
--  cai na esteira normal da IA (prompt do tenant = verdade única).
--
--  Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS). Rode no SQL Editor
--  (staging primeiro), ANTES de subir o código que usa estas tabelas.
--  O código é tolerante: sem estas tabelas, o motor de campanhas só loga e não roda.
-- ============================================================================

-- [1] Instância: id da WABA (lista os templates aprovados na Meta)
ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS waba_id TEXT;

-- [2] Leads: dados da base do cliente + opt-out (LGPD) + controle de frequência
ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS dados_cliente       JSONB DEFAULT NULL,   -- colunas livres do CSV (última compra, produto, valor...)
    ADD COLUMN IF NOT EXISTS base_lote           TEXT DEFAULT NULL,    -- nome do lote de importação
    ADD COLUMN IF NOT EXISTS base_consentimento  TEXT DEFAULT NULL,    -- base legal declarada no upload
    ADD COLUMN IF NOT EXISTS opt_out             BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS opt_out_at          TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS do_not_call         BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ultima_campanha_at  TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS ultima_campanha_id  UUID DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_base_lote ON public.leads (user_id, base_lote);

-- [3] Campanhas
CREATE TABLE IF NOT EXISTS public.campanhas (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    instance_id      UUID NOT NULL REFERENCES public.instances(id) ON DELETE CASCADE,
    nome             TEXT NOT NULL,
    objetivo         TEXT NOT NULL DEFAULT 'reativacao',     -- reativacao | upsell | outro
    filtro_segmento  JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { lotes:[...], campo, operador, valor }
    templates        JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{ nome, idioma, texto, variaveis:[...], esperaDias }]
    prompt_campanha  TEXT,                                   -- contexto da campanha escrito pelo cliente
    janela_inicio    SMALLINT NOT NULL DEFAULT 9,            -- hora BRT
    janela_fim       SMALLINT NOT NULL DEFAULT 19,
    limite_diario    INTEGER NOT NULL DEFAULT 100,
    frequencia_dias  INTEGER NOT NULL DEFAULT 30,            -- não reabordar quem recebeu OUTRA campanha há < N dias
    status           TEXT NOT NULL DEFAULT 'rascunho',       -- rascunho | ativa | pausada | concluida
    motivo_pausa     TEXT,
    criada_em        TIMESTAMPTZ DEFAULT NOW(),
    iniciada_em      TIMESTAMPTZ,
    concluida_em     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_campanhas_user   ON public.campanhas (user_id, criada_em DESC);
CREATE INDEX IF NOT EXISTS idx_campanhas_status ON public.campanhas (status);

-- [4] Contatos de cada campanha (1 linha por lead x campanha)
CREATE TABLE IF NOT EXISTS public.campanha_contatos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campanha_id       UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
    lead_id           UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL,
    passo             SMALLINT NOT NULL DEFAULT 0,           -- próximo passo a enviar (0 = 1º template)
    status            TEXT NOT NULL DEFAULT 'pendente',      -- pendente|enviado|entregue|lido|respondeu|convertido|optout|falhou|ignorado
    wamid             TEXT,                                  -- id da última mensagem enviada (casa com o webhook de status)
    erro              TEXT,
    proximo_envio_at  TIMESTAMPTZ,
    ultimo_envio_at   TIMESTAMPTZ,
    entregue_at       TIMESTAMPTZ,
    lido_at           TIMESTAMPTZ,
    respondeu_at      TIMESTAMPTZ,
    convertido_at     TIMESTAMPTZ,
    custo_cents       INTEGER NOT NULL DEFAULT 0,
    criado_em         TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT campanha_contatos_unico UNIQUE (campanha_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_cc_fila  ON public.campanha_contatos (campanha_id, proximo_envio_at);
CREATE INDEX IF NOT EXISTS idx_cc_wamid ON public.campanha_contatos (wamid);
CREATE INDEX IF NOT EXISTS idx_cc_lead  ON public.campanha_contatos (lead_id);

-- [5] RLS: cada tenant só enxerga as próprias linhas no frontend (backend usa service_role)
ALTER TABLE public.campanhas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_contatos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campanhas_tenant ON public.campanhas;
CREATE POLICY campanhas_tenant ON public.campanhas
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS campanha_contatos_tenant ON public.campanha_contatos;
CREATE POLICY campanha_contatos_tenant ON public.campanha_contatos
    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Verificação
SELECT table_name, column_name FROM information_schema.columns
WHERE table_name IN ('campanhas', 'campanha_contatos')
   OR (table_name = 'leads' AND column_name IN ('dados_cliente', 'base_lote', 'opt_out', 'ultima_campanha_at'))
   OR (table_name = 'instances' AND column_name = 'waba_id')
ORDER BY table_name, column_name;
