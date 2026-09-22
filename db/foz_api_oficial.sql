-- ============================================================================
--  FOZ → WhatsApp API OFICIAL (Meta Cloud API)
-- ============================================================================
--  Rode ISTO SÓ DEPOIS de ter em mãos (ver RUNBOOK_API_OFICIAL_FOZ.md):
--    - cloud_api_key  = ACCESS TOKEN permanente (System User) da Meta
--    - cloud_base_url = https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>
--  e de ter setado no Railway: WHATSAPP_VERIFY_TOKEN e WHATSAPP_WEBHOOK_SECRET.
--
--  >>> Troque os 3 placeholders <...> antes de rodar. NÃO comite token real. <<<
--
--  O chip do Foz hoje é o "teste teste" (user_id começa com cfa8f1e9). Confirme
--  o id exato com a query de VERIFICAÇÃO no fim antes de aplicar.
-- ============================================================================

-- 1) Vira o transporte do chip do Foz para a Meta Cloud API.
UPDATE public.instances
SET
    whatsapp_provider = 'official',
    cloud_api_key     = '<COLE_O_ACCESS_TOKEN_PERMANENTE_DA_META>',
    cloud_base_url    = 'https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>',
    inbound_only      = true,   -- Foz é 100% receptivo (leads vêm do anúncio)
    firing_paused     = true,   -- sem disparo frio automático
    dry_run           = false,  -- envia de verdade
    -- ⚠️ owner_phone estava NULL: sem ele o repasse pro Carlos (handoff humano)
    -- não sabe pra quem transferir. Coloque o WhatsApp do Carlos (só dígitos, com DDI+DDD, com o 9):
    owner_phone       = '<55DDDNUMERODOCARLOS>'
WHERE user_id::text LIKE 'cfa8f1e9%'
  AND name = 'teste teste';   -- trava de segurança: só o chip do Foz

-- ============================================================================
--  VERIFICAÇÃO (rode antes E depois):
--    SELECT id, name, user_id, whatsapp_provider, inbound_only, firing_paused,
--           (cloud_api_key IS NOT NULL) AS tem_token, cloud_base_url, owner_phone
--    FROM public.instances
--    WHERE user_id::text LIKE 'cfa8f1e9%';
--
--  O `id` que aparecer é o <chip_do_Foz> que vai na URL do webhook:
--    https://antix.up.railway.app/webhook/whatsapp?instanceId=<id>&token=<WHATSAPP_WEBHOOK_SECRET>
--
--  ROLLBACK (voltar pro Baileys):
--    UPDATE public.instances SET whatsapp_provider='baileys'
--    WHERE user_id::text LIKE 'cfa8f1e9%' AND name='teste teste';
-- ============================================================================
