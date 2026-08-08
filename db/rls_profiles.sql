-- ============================================================================
--  RLS: profiles — permitir que cada usuário LEIA e ATUALIZE a própria linha
-- ============================================================================
--  Contexto: o modal "Configurações da Conta" grava em profiles via
--  supabase.from('profiles').upsert({ id: user.id, ... }). Se o RLS não tiver
--  uma policy de UPDATE/INSERT batendo em (id = auth.uid()), o upsert falha
--  silenciosamente — foi a causa de "mudei o nome e não salvou".
--
--  Rode PRIMEIRO no Supabase de STAGING (SQL Editor), valide o save no painel,
--  e só então rode em PRODUÇÃO.
--
--  Idempotente: dropa antes de criar. Seguro rodar mais de uma vez.
-- ============================================================================

-- Garante RLS ligado (não faz nada se já estiver).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT da própria linha
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- INSERT da própria linha (necessário pro upsert quando a linha ainda não existe)
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- UPDATE da própria linha (o fix principal — sem isto o save de nome/empresa falha)
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Colunas de default da persona (caso o schema de staging ainda não as tenha).
-- Em prod já existem; ADD COLUMN IF NOT EXISTS é no-op se já estiverem lá.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_agent_name   text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_company_name text;
