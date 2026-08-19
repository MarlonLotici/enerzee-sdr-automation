-- ============================================================================
--  WhatsApp API OFICIAL (Meta Cloud API direto) — colunas por instância
-- ============================================================================
--  Habilita uma instância (chip) a enviar/receber pela Cloud API oficial da Meta
--  em vez do Baileys. Fica INERTE até uma instância ter whatsapp_provider='official'
--  + estas colunas preenchidas — Baileys 100% inalterado.
--
--  Como usar (por CLIENTE, cada um com a PRÓPRIA WABA/número/token da Meta):
--    UPDATE instances SET
--       whatsapp_provider = 'official',
--       cloud_api_key  = '<ACCESS_TOKEN_PERMANENTE_DA_META>',
--       cloud_base_url = 'https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>'
--    WHERE id = '<instance_id>';
--
--  O transporte (transports/cloudApiTransport.js) usa cloud_api_key como Bearer token
--  e cloud_base_url (com o PHONE_NUMBER_ID no path) como endpoint. O webhook da Meta
--  deve apontar pra: https://SEU-HOST/webhook/whatsapp?token=<WHATSAPP_WEBHOOK_SECRET>&instanceId=<instance_id>
--
--  Idempotente (ADD COLUMN IF NOT EXISTS). Rode no STAGING primeiro, depois PROD.
-- ============================================================================

ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS cloud_api_key  TEXT;
ALTER TABLE public.instances ADD COLUMN IF NOT EXISTS cloud_base_url TEXT;
