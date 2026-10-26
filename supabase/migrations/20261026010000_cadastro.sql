-- Cadastro feito pelo administrador.
-- O administrador cria o usuário (nome de usuário fixo) com uma senha temporária.
-- No primeiro acesso a pessoa completa: nome completo, e-mail, CPF e nova senha.
-- Depois disso, o login pede só usuário e senha.

alter table public.profiles
  add column username text unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  add column created_by uuid references auth.users(id) on delete set null,
  add column needs_setup boolean not null default false;

-- E-mail real de cada pessoa (o login usa o usuário, não o e-mail)
create unique index profiles_email_uniq on public.profiles (lower(email)) where email <> '';

-- CPF fica separado: só a própria pessoa e os administradores dos grupos dela veem
create table public.profile_private (
  id uuid primary key references auth.users(id) on delete cascade,
  cpf text not null unique check (cpf ~ '^[0-9]{11}$'),
  updated_at timestamptz not null default now()
);
alter table public.profile_private enable row level security;
create policy private_read on public.profile_private for select using (
  id = auth.uid() or exists (
    select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and a.role = 'admin' and b.user_id = profile_private.id
  )
);
-- gravação só pela função complete_profile

-- O e-mail usado em convites passa a ser o do perfil (o e-mail de login é interno)
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(lower(email), '') from profiles where id = auth.uid()),
    lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare internal boolean := lower(coalesce(new.email, '')) like '%@usuarios.rngroup.app';
begin
  insert into profiles (id, name, email, username, created_by, needs_setup)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when internal then '' else lower(coalesce(new.email, '')) end,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'created_by', '')::uuid,
    internal
  )
  on conflict (id) do nothing;
  if not internal then
    update item_members set user_id = new.id where user_id is null and lower(email) = lower(new.email);
    update group_members set user_id = new.id where user_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end $$;

-- O próprio usuário não muda o nome de usuário, quem o criou nem pula o cadastro
create or replace function public.protect_profile() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and current_setting('rn.complete', true) is distinct from 'on' then
    new.username := old.username;
    new.created_by := old.created_by;
    new.needs_setup := old.needs_setup;
    if old.needs_setup then new.email := old.email; end if;
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
for each row execute function public.protect_profile();

-- Primeiro acesso: completa o cadastro (a senha nova é trocada pelo app antes)
create or replace function public.complete_profile(p_name text, p_email text, p_cpf text) returns void
language plpgsql security definer set search_path = public as $$
declare v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
begin
  if auth.uid() is null then raise exception 'sem_login'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 3 or position(' ' in trim(p_name)) = 0 then raise exception 'nome_incompleto'; end if;
  if lower(trim(coalesce(p_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_invalido'; end if;
  if not public.cpf_valido(v_cpf) then raise exception 'cpf_invalido'; end if;
  if exists (select 1 from profiles where lower(email) = lower(trim(p_email)) and id <> auth.uid()) then raise exception 'email_em_uso'; end if;
  if exists (select 1 from profile_private where cpf = v_cpf and id <> auth.uid()) then raise exception 'cpf_em_uso'; end if;
  perform set_config('rn.complete', 'on', true);
  update profiles set name = trim(p_name), email = lower(trim(p_email)), needs_setup = false where id = auth.uid();
  insert into profile_private (id, cpf) values (auth.uid(), v_cpf)
  on conflict (id) do update set cpf = excluded.cpf, updated_at = now();
  perform public.claim_invites();
end $$;

create or replace function public.cpf_valido(c text) returns boolean
language plpgsql immutable as $$
declare s int; d1 int; d2 int; i int;
begin
  if c !~ '^[0-9]{11}$' or c ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(c, i, 1)::int * (11 - i); end loop;
  d1 := (s * 10) % 11; if d1 = 10 then d1 := 0; end if;
  s := 0; for i in 1..10 loop s := s + substr(c, i, 1)::int * (12 - i); end loop;
  d2 := (s * 10) % 11; if d2 = 10 then d2 := 0; end if;
  return d1 = substr(c, 10, 1)::int and d2 = substr(c, 11, 1)::int;
end $$;

-- Só quem não foi criado por um administrador (as contas originais) cria grupos
drop policy groups_insert on public.groups;
create policy groups_insert on public.groups for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.created_by is null)
);

-- Administrador vê o usuário das pessoas (já coberto por profiles_read via grupo)
