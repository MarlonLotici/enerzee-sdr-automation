-- db/site_events.sql — eventos do funil do site (antix-ia.com) pra saber ONDE o lead some.
-- Rodar UMA vez no SQL Editor do Supabase (prod). Idempotente (IF NOT EXISTS).
--
-- Mede o topo do funil que o backend não enxergava: anúncio → chegou no site → abriu o
-- chat → mandou a 1ª mensagem. A parte de baixo (qualificou → agendou) já sai de leads/messages.

create table if not exists public.site_events (
    id          bigint generated always as identity primary key,
    session_id  text,                         -- mesmo sessionId do widget (casa com web_<sid>@web em leads)
    event       text not null,                -- 'pageview' | 'chat_aberto' | 'primeira_msg' | 'agendou' | ...
    path        text,                         -- url/rota onde ocorreu
    referrer    text,                         -- de onde veio (p/ separar anúncio de orgânico)
    utm_source  text,                         -- ?utm_source= do anúncio (instagram/meta/etc.)
    utm_campaign text,                        -- ?utm_campaign=
    user_agent  text,
    meta        jsonb default '{}'::jsonb,    -- qualquer extra sem precisar migrar coluna
    created_at  timestamptz not null default now()
);

-- Consultas do funil filtram por data e por evento → índices ajudam.
create index if not exists idx_site_events_created on public.site_events (created_at desc);
create index if not exists idx_site_events_event   on public.site_events (event);
create index if not exists idx_site_events_session on public.site_events (session_id);

-- RLS: o insert vem do site público (anon). Permite INSERT anônimo, bloqueia leitura anônima
-- (o painel lê via service key no backend, que ignora RLS). Sem isso o widget não grava.
alter table public.site_events enable row level security;

drop policy if exists site_events_insert_anon on public.site_events;
create policy site_events_insert_anon on public.site_events
    for insert to anon, authenticated with check (true);
