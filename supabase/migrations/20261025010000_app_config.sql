-- Configurações públicas do app (ex.: chave pública do push).
-- Qualquer um pode ler; só o servidor grava.
create table public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config for select using (true);
grant select on public.app_config to anon, authenticated;
