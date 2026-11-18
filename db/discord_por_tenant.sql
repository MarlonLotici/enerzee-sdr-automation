-- Discord POR CLIENTE (opcional). Cada tenant pode ter o próprio webhook pra receber avisos de lead novo,
-- reunião agendada e briefing da reunião. Sem isso, dá pra configurar pelo Railway na variável
-- DISCORD_WEBHOOKS_POR_TENANT = {"<user_id>": "<webhook>"}. Sem nenhum dos dois, cai no Discord da Antix.
alter table public.profiles add column if not exists discord_webhook_url text;

-- Exemplo (troque o user_id e o webhook):
-- update public.profiles set discord_webhook_url = 'https://discord.com/api/webhooks/...' where id = '<user_id>';
