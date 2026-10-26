-- Grupos com administrador.
-- O administrador escolhe, para todos os membros ou para cada pessoa, se ela
-- pode criar itens em Pessoal, em Empresa e se pode enviar convites.
-- Quem não está em nenhum grupo (ou é administrador) pode tudo.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  -- padrão para quem entrar no grupo
  can_pessoal boolean not null default true,
  can_empresa boolean not null default true,
  can_invite boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,  -- null até a pessoa criar conta
  email text,
  role text not null default 'membro' check (role in ('admin','membro')),
  can_pessoal boolean not null default true,
  can_empresa boolean not null default true,
  can_invite boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_id, user_id),
  unique (group_id, email)
);
create index group_members_user_idx on public.group_members (user_id);
create index group_members_email_idx on public.group_members (lower(email));

-- Funções auxiliares ------------------------------------------------------
create or replace function public.in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members m
    where m.group_id = p_group
      and (m.user_id = auth.uid() or (m.user_id is null and lower(m.email) = my_email()))
  ) or exists (select 1 from groups g where g.id = p_group and g.created_by = auth.uid())
$$;

create or replace function public.is_group_admin(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members m where m.group_id = p_group and m.user_id = auth.uid() and m.role = 'admin'
  )
$$;

create or replace function public.shares_group_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = p_user
  )
$$;

-- Pode fazer? perm = 'pessoal' | 'empresa' | 'convite'
create or replace function public.can_do(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null
    or not exists (select 1 from group_members m where m.user_id = auth.uid() and m.role = 'membro')
    or exists (
      select 1 from group_members m
      where m.user_id = auth.uid()
        and (m.role = 'admin'
          or (p_perm = 'pessoal' and m.can_pessoal)
          or (p_perm = 'empresa' and m.can_empresa)
          or (p_perm = 'convite' and m.can_invite))
    )
$$;

-- Regras aplicadas pelo banco ---------------------------------------------
create or replace function public.check_item_perm() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.cat is distinct from old.cat then
    if not public.can_do(new.cat) then
      raise exception 'sem_permissao_%', new.cat using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger items_check_perm before insert or update of cat on public.items
for each row execute function public.check_item_perm();

create or replace function public.check_invite_perm() returns trigger
language plpgsql as $$
begin
  if new.role = 'convidado' and not public.can_do('convite') then
    raise exception 'sem_permissao_convite' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger members_check_invite before insert on public.item_members
for each row execute function public.check_invite_perm();

-- Quem cria o grupo vira administrador
create or replace function public.add_group_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, email, role)
  values (new.id, new.created_by, (select email from profiles where id = new.created_by), 'admin')
  on conflict do nothing;
  return new;
end $$;
create trigger groups_add_admin after insert on public.groups
for each row execute function public.add_group_admin();

-- Convites por e-mail (itens e grupos) passam a ser da pessoa ao criar conta
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int; g int;
begin
  update item_members set user_id = auth.uid()
   where user_id is null and lower(email) = my_email() and my_email() <> ''
     and not exists (select 1 from item_members x where x.item_id = item_members.item_id and x.user_id = auth.uid());
  get diagnostics n = row_count;
  update group_members set user_id = auth.uid()
   where user_id is null and lower(email) = my_email() and my_email() <> ''
     and not exists (select 1 from group_members x where x.group_id = group_members.group_id and x.user_id = auth.uid());
  get diagnostics g = row_count;
  return n + g;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), lower(coalesce(new.email, '')))
  on conflict (id) do nothing;
  update item_members set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  update group_members set user_id = new.id
   where user_id is null and lower(email) = lower(new.email);
  return new;
end $$;

-- Segurança (RLS) ---------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy groups_read on public.groups for select using (created_by = auth.uid() or public.in_group(id));
create policy groups_insert on public.groups for insert with check (created_by = auth.uid());
create policy groups_update on public.groups for update using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy groups_delete on public.groups for delete using (public.is_group_admin(id));

create policy gm_read on public.group_members for select using (public.in_group(group_id));
create policy gm_insert on public.group_members for insert with check (public.is_group_admin(group_id));
create policy gm_update on public.group_members for update
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));
-- o administrador não remove a si mesmo (o grupo nunca fica sem administrador)
create policy gm_delete on public.group_members for delete
  using (public.is_group_admin(group_id) and user_id is distinct from auth.uid());

-- Administrador e membros veem o nome uns dos outros
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (public.shares_item_with(id) or public.shares_group_with(id));

alter publication supabase_realtime add table public.groups, public.group_members;
