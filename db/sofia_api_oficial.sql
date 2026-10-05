-- ============================================================================
--  SOFIA / ANTIX → WhatsApp API OFICIAL (Meta Cloud API)
-- ============================================================================
--  Número: +55 48 9820-3038  |  PHONE_NUMBER_ID: 1366136896578904
--  WABA:   1114782524418024  |  Portfólio: 978295844257795  |  Graph: v25.0
--
--  >>> RODE ISTO SÓ DEPOIS de o número estar CONNECTED na Meta <<<
--      (nome de exibição aprovado + `node scripts/setup_cloud_api.js` mostrando
--       status CONNECTED). Virar antes disso derruba o chip da Antix: ele para
--       de subir Baileys e tenta enviar via Cloud API num número ainda não ativo.
--
--  SEGURANÇA: cloud_api_key fica NULL de propósito. O token vem da env var
--  WA_TOKEN (setada no Railway) e NUNCA é gravado no banco.
-- ============================================================================

-- 1) Vira o transporte da Sofia/Antix (Chip Kau) para a Meta Cloud API.
UPDATE public.instances
SET
    whatsapp_provider = 'official',
    cloud_api_key     = NULL,                                                      -- token vem do env WA_TOKEN
    cloud_base_url    = 'https://graph.facebook.com/v25.0/1366136896578904',       -- base + PHONE_NUMBER_ID
    inbound_only      = true                                                       -- Antix é receptivo (site/anúncio)
WHERE id = '290a03b9-85aa-4afb-9527-1c2453588e66'
  AND company_name = 'Antix';   -- trava de segurança: só o chip da Sofia/Antix

-- ============================================================================
--  VERIFICAÇÃO (rode antes E depois):
--    SELECT id, name, agent_name, company_name, whatsapp_provider, inbound_only,
--           (cloud_api_key IS NOT NULL) AS tem_token_no_banco, cloud_base_url
--    FROM public.instances
--    WHERE id = '290a03b9-85aa-4afb-9527-1c2453588e66';
--  Esperado depois: whatsapp_provider='official', tem_token_no_banco=false,
--                   cloud_base_url=...v25.0/1366136896578904
--
--  URL do webhook pra colar na Meta (WABA → Configuration → Webhooks):
--    https://antix.up.railway.app/webhook/whatsapp?instanceId=290a03b9-85aa-4afb-9527-1c2453588e66&token=<WHATSAPP_WEBHOOK_SECRET>
--  Verify token (campo "Verify token" da Meta): o valor de WHATSAPP_VERIFY_TOKEN.
--
--  ROLLBACK (voltar pro Baileys — escaneia QR de novo):
--    UPDATE public.instances SET whatsapp_provider='baileys', cloud_base_url=NULL
--    WHERE id = '290a03b9-85aa-4afb-9527-1c2453588e66';
-- ============================================================================
