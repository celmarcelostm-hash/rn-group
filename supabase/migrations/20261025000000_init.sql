-- RN Group: esquema inicial
-- Tarefas, lembretes e reuniões ficam em "items". Quem participa de um item
-- (o dono e os convidados) fica em "item_members". Cada pessoa tem o próprio
-- "concluído", resposta ao convite e soneca.

create extension if not exists pgcrypto;

-- Perfil de cada pessoa ---------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  timezone text not null default 'America/Sao_Paulo',
  default_alerts int[] not null default '{240,60,10}',
  brief_on boolean not null default true,
  brief_time time not null default '07:00',
  telegram_user text,
  telegram_chat_id bigint,
  telegram_link_code text unique default encode(gen_random_bytes(6), 'hex'),
  telegram_on boolean not null default false,
  created_at timestamptz not null default now()
);

-- Itens: tarefa, lembrete ou reunião --------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('tarefa','lembrete','reuniao')),
  cat text not null check (cat in ('pessoal','empresa')),
  title text not null check (char_length(title) between 1 and 140),
  notes text not null default '',
  place text not null default '',
  agenda text not null default '',   -- pauta da reunião
  minutes text not null default '',  -- ata da reunião
  due_at timestamptz,                -- null = sem data
  all_day boolean not null default false,
  alerts int[],                      -- minutos antes; null = usar o padrão do perfil
  recurrence text check (recurrence in ('diaria','dias_uteis','semanal','mensal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_due_idx on public.items (due_at);

create table public.item_members (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,  -- null enquanto a pessoa não tem conta
  email text,                                                  -- convite por e-mail
  name text not null default '',                               -- nome digitado para quem não tem conta
  role text not null default 'convidado' check (role in ('dono','convidado')),
  rsvp text not null default 'pendente' check (rsvp in ('pendente','sim','nao')),
  done boolean not null default false,
  snooze_until timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, user_id),
  unique (item_id, email)
);
create index item_members_user_idx on public.item_members (user_id);
create index item_members_email_idx on public.item_members (lower(email));

-- Histórico de reagendamentos (visível para todos os participantes)
create table public.reschedules (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  from_at timestamptz,
  to_at timestamptz,
  reason text not null check (char_length(reason) between 1 and 300),
  by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Pedido de novo horário feito por um convidado
create table public.reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  by uuid not null references auth.users(id) default auth.uid(),
  to_at timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'aberto' check (status in ('aberto','aceito','recusado')),
  created_at timestamptz not null default now()
);

-- Avisos rápidos: "Estou atrasado"
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  by uuid not null references auth.users(id) default auth.uid(),
  kind text not null default 'atraso' check (kind in ('atraso')),
  minutes int,
  message text not null default '',
  created_at timestamptz not null default now()
);

-- Aparelhos que recebem push
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

-- Controle para não mandar o mesmo alerta duas vezes
create table public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Funções auxiliares ------------------------------------------------------
create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_member(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from item_members m
    where m.item_id = p_item
      and (m.user_id = auth.uid() or (m.user_id is null and lower(m.email) = my_email()))
  ) or exists (select 1 from items i where i.id = p_item and i.owner = auth.uid())
$$;

create or replace function public.is_owner(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from items i where i.id = p_item and i.owner = auth.uid())
$$;

create or replace function public.shares_item_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from item_members a join item_members b on a.item_id = b.item_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- Acha uma pessoa cadastrada pelo e-mail (para convidar)
create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name from profiles p where lower(p.email) = lower(trim(p_email)) limit 1
$$;

-- Quando alguém cria conta, os convites feitos para o e-mail passam a ser dele
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update item_members set user_id = auth.uid()
   where user_id is null and lower(email) = my_email() and my_email() <> ''
     and not exists (select 1 from item_members x where x.item_id = item_members.item_id and x.user_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end $$;

-- Cria o perfil automaticamente no cadastro
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), lower(coalesce(new.email, '')))
  on conflict (id) do nothing;
  update item_members set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- O dono entra como participante automaticamente
create or replace function public.add_owner_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into item_members (item_id, user_id, role, rsvp) values (new.id, new.owner, 'dono', 'sim')
  on conflict do nothing;
  return new;
end $$;
create trigger items_add_owner after insert on public.items
for each row execute function public.add_owner_member();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger items_touch before update on public.items
for each row execute function public.touch_updated_at();

-- Segurança (RLS) ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.item_members enable row level security;
alter table public.reschedules enable row level security;
alter table public.reschedule_requests enable row level security;
alter table public.notices enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log enable row level security;

create policy profiles_read on public.profiles for select using (public.shares_item_with(id));
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());

create policy items_read on public.items for select using (owner = auth.uid() or public.is_member(id));
create policy items_insert on public.items for insert with check (owner = auth.uid());
create policy items_update on public.items for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy items_delete on public.items for delete using (owner = auth.uid());

create policy members_read on public.item_members for select using (public.is_member(item_id));
create policy members_insert on public.item_members for insert with check (public.is_owner(item_id));
create policy members_delete on public.item_members for delete using (public.is_owner(item_id) and role <> 'dono');
create policy members_update on public.item_members for update
  using (user_id = auth.uid() or public.is_owner(item_id))
  with check (user_id = auth.uid() or public.is_owner(item_id));

create policy resched_read on public.reschedules for select using (public.is_member(item_id));
create policy resched_insert on public.reschedules for insert with check (public.is_owner(item_id) and by = auth.uid());

create policy req_read on public.reschedule_requests for select using (public.is_member(item_id));
create policy req_insert on public.reschedule_requests for insert with check (public.is_member(item_id) and by = auth.uid());
create policy req_update on public.reschedule_requests for update using (public.is_owner(item_id));

create policy notices_read on public.notices for select using (public.is_member(item_id));
create policy notices_insert on public.notices for insert with check (public.is_member(item_id) and by = auth.uid());

create policy push_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- notification_log: só o servidor (service role) usa; sem políticas = ninguém do app acessa.

-- Atualização em tempo real no app
alter publication supabase_realtime add table public.items, public.item_members, public.reschedules, public.reschedule_requests, public.notices;
