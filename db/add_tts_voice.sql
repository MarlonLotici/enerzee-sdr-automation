-- =============================================================================
-- Voz de áudio (ElevenLabs) por cliente — Migração de Banco (Supabase)
-- Execute UMA VEZ no SQL Editor do Supabase. Idempotente (pode rodar de novo).
-- =============================================================================

-- Voice ID do ElevenLabs por chip/instância (ex.: 'Xb7hH8MSUJpSbSDYk0k2').
-- NULL = usa a voz padrão do ELEVENLABS_VOICE_ID (env do Railway).
ALTER TABLE public.instances
    ADD COLUMN IF NOT EXISTS tts_voice TEXT DEFAULT NULL;

-- Voz padrão da CONTA: chips sem tts_voice próprio herdam esta.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS default_tts_voice TEXT DEFAULT NULL;

-- Verificação
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'instances' AND column_name = 'tts_voice')
   OR (table_name = 'profiles'  AND column_name = 'default_tts_voice');

-- EXEMPLOS (descomente e troque pelos IDs reais):
-- UPDATE public.instances SET tts_voice = 'ID_DA_VOZ_MASCULINA' WHERE id = 'UUID_DO_CHIP_DO_CLIENTE_A';
-- UPDATE public.instances SET tts_voice = 'ID_DA_VOZ_FEMININA'  WHERE id = 'UUID_DO_CHIP_DO_CLIENTE_B';
-- UPDATE public.profiles  SET default_tts_voice = 'ID_DA_VOZ' WHERE id = 'UUID_DO_USUARIO';
