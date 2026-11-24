-- ============================================================================
--  ENERZEE (CARLA) → WhatsApp API OFICIAL (Meta Cloud API)  |  número +55 48 8824-5113 (Phone Number ID 1400458459825400; WABA 2148464835774402)
-- ============================================================================
--  O chip JÁ FOI CRIADO no banco em 23/11/2026 (id abaixo), com persona Carla, prompt próprio (override por chip, que
--  ignora os 4 prompts da Lorena), whatsapp_provider='official', inbound_only=true, firing_paused=true, product_type='generico'.
--  Falta só ligar às credenciais da Meta. Rode o UPDATE abaixo DEPOIS de ter, no WhatsApp Manager / Business Manager:
--    - <ACCESS_TOKEN>     token permanente do System User, com acesso SÓ à WABA da Enerzee
--    - <PHONE_NUMBER_ID>  "Phone number ID" (NÃO é o telefone)
--    - <WABA_ID>          id da WABA
--  >>> Troque os 3 placeholders. NÃO comite token real. <<<
--
--  Chip:  7ca283d1-d28f-4c9b-a97e-17568e21f749   |   Conta Enerzee: cf8950a2-318f-47b5-831c-ee697d8c5c51
-- ============================================================================

UPDATE public.instances
SET
    cloud_api_key  = '<ACCESS_TOKEN>',
    cloud_base_url = 'https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>',
    waba_id        = '<WABA_ID>'
WHERE id = '7ca283d1-d28f-4c9b-a97e-17568e21f749'
  AND user_id = 'cf8950a2-318f-47b5-831c-ee697d8c5c51';   -- trava de segurança: só o chip da Enerzee

-- ============================================================================
--  VERIFICAÇÃO (depois do UPDATE):
--    SELECT id, name, agent_name, company_name, whatsapp_provider, inbound_only, firing_paused, product_type,
--           (cloud_api_key IS NOT NULL) AS tem_token, cloud_base_url, waba_id, length(system_prompt) AS tam_prompt
--    FROM public.instances WHERE id = '7ca283d1-d28f-4c9b-a97e-17568e21f749';
--  Esperado: official, tem_token=true, cloud_base_url=...v25.0/<PHONE_NUMBER_ID>, tam_prompt ≈ 7900.
--
--  Depois do UPDATE: faça o redeploy no Railway (ou "Reconectar" no painel). O startInstance pula o Baileys e marca CONNECTED.
--
--  Webhook: NÃO mexer. O app Antix Colony já aponta pro servidor, que roteia pelo phone_number_id (o ?instanceId= é só plano B).
--
--  ROLLBACK (desliga a Cloud API neste chip e apaga o chip):
--    DELETE FROM public.instances WHERE id = '7ca283d1-d28f-4c9b-a97e-17568e21f749' AND user_id = 'cf8950a2-318f-47b5-831c-ee697d8c5c51';
-- ============================================================================
