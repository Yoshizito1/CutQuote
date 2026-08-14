-- =============================================================================
-- 0001 — Perfis de usuário
-- =============================================================================
-- O Supabase Auth já guarda e-mail e senha em auth.users. Esta tabela carrega
-- só o que é do negócio: nome, empresa e papel.
-- =============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  company     text,
  role        text not null default 'cliente' check (role in ('cliente', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Dados de negócio do usuário. O papel "admin" libera a edição do catálogo.';

-- -----------------------------------------------------------------------------
-- is_admin(): usado por quase toda policy.
--
-- SECURITY DEFINER é obrigatório aqui. Sem isso, uma policy de profiles que
-- consultasse profiles entraria em recursão infinita — o Postgres aplicaria RLS
-- de novo na própria checagem. A função roda com o dono e ignora RLS.
--
-- search_path fixo evita que um schema malicioso no path sequestre a resolução
-- de nomes dentro de uma função SECURITY DEFINER.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Cria o perfil automaticamente quando alguém se cadastra.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, company)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'company', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Mantém updated_at coerente, sem depender da aplicação lembrar.
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "perfil: leitura própria" on public.profiles;
create policy "perfil: leitura própria"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "perfil: atualização própria" on public.profiles;
create policy "perfil: atualização própria"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Sem policy de INSERT/DELETE de propósito: quem cria o perfil é o trigger,
-- e apagar o usuário em auth.users já remove o perfil em cascata.
