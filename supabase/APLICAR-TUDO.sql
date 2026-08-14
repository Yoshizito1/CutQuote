-- =============================================================================
-- BELLARI - APLICAR TUDO
-- =============================================================================
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em Run.
-- Contem as 4 migrations na ordem correta. Rodar duas vezes e seguro.
-- =============================================================================



-- >>>>> 20260814120000_perfis.sql >>>>>

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


-- >>>>> 20260814120100_catalogo.sql >>>>>

-- =============================================================================
-- 0002 — Catálogo versionado
-- =============================================================================
-- Por que versionado: sem isso, corrigir o R$/kg do inox hoje mudaria o valor
-- de um orçamento enviado semana passada. Aqui o catálogo é imutável depois de
-- publicado — para alterar preço, cria-se uma nova versão e publica-se ela.
-- =============================================================================

create table if not exists public.catalog_versions (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  status        text not null default 'rascunho'
                check (status in ('rascunho', 'publicado', 'arquivado')),
  notes         text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

-- Só pode existir uma versão publicada por vez. O índice parcial transforma
-- essa regra de negócio em uma garantia do banco, não em disciplina do código.
create unique index if not exists catalog_versions_unica_publicada
  on public.catalog_versions ((status))
  where status = 'publicado';

-- -----------------------------------------------------------------------------
-- Processos de corte
-- -----------------------------------------------------------------------------
create table if not exists public.processes (
  id                         uuid primary key default gen_random_uuid(),
  version_id                 uuid not null references public.catalog_versions (id) on delete cascade,
  code                       text not null,
  name                       text not null,
  machine_rate_per_hour      numeric not null check (machine_rate_per_hour >= 0),
  kerf                       numeric not null check (kerf >= 0),
  handling_seconds_per_part  numeric not null check (handling_seconds_per_part >= 0),
  base_lead_days             integer not null check (base_lead_days >= 0),
  sheet_width                numeric not null check (sheet_width > 0),
  sheet_height               numeric not null check (sheet_height > 0),
  description                text,
  unique (version_id, code)
);

-- -----------------------------------------------------------------------------
-- Materiais
-- -----------------------------------------------------------------------------
create table if not exists public.materials (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.catalog_versions (id) on delete cascade,
  code          text not null,
  name          text not null,
  family        text not null,
  process_code  text not null,
  density       numeric not null check (density > 0),
  price_per_kg  numeric not null check (price_per_kg >= 0),
  scrap_factor  numeric not null check (scrap_factor >= 0 and scrap_factor < 1),
  tappable      boolean not null default true,
  notes         text,
  sort_order    integer not null default 0,
  unique (version_id, code)
);

comment on column public.materials.scrap_factor is
  'Perda de aninhamento (0,18 = 18%). Multiplica o custo de material.';

create table if not exists public.material_thicknesses (
  id                   uuid primary key default gen_random_uuid(),
  material_id          uuid not null references public.materials (id) on delete cascade,
  mm                   numeric not null check (mm > 0),
  label                text not null,
  cut_speed_m_per_min  numeric not null check (cut_speed_m_per_min > 0),
  pierce_seconds       numeric not null check (pierce_seconds >= 0),
  min_hole_ratio       numeric not null default 1 check (min_hole_ratio > 0),
  min_web_ratio        numeric not null default 1 check (min_web_ratio > 0),
  bendable             boolean not null default true,
  min_flange_ratio     numeric not null default 4 check (min_flange_ratio > 0),
  bend_radius          numeric not null default 1 check (bend_radius > 0),
  available            boolean not null default true,
  unique (material_id, mm)
);

comment on column public.material_thicknesses.cut_speed_m_per_min is
  'Velocidade real de corte. É o número mais importante para calibrar o preço.';

-- -----------------------------------------------------------------------------
-- Acabamentos
-- -----------------------------------------------------------------------------
create table if not exists public.finishes (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references public.catalog_versions (id) on delete cascade,
  code            text not null,
  name            text not null,
  price_per_m2    numeric not null default 0 check (price_per_m2 >= 0),
  setup_cost      numeric not null default 0 check (setup_cost >= 0),
  price_per_part  numeric not null default 0 check (price_per_part >= 0),
  lead_days       integer not null default 0 check (lead_days >= 0),
  description     text,
  sort_order      integer not null default 0,
  unique (version_id, code)
);

-- Quais acabamentos cada material aceita.
create table if not exists public.material_finishes (
  material_id  uuid not null references public.materials (id) on delete cascade,
  finish_code  text not null,
  sort_order   integer not null default 0,
  primary key (material_id, finish_code)
);

-- -----------------------------------------------------------------------------
-- Faixas de quantidade
-- -----------------------------------------------------------------------------
create table if not exists public.quantity_breaks (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references public.catalog_versions (id) on delete cascade,
  min_qty          integer not null check (min_qty >= 1),
  variable_factor  numeric not null check (variable_factor > 0 and variable_factor <= 1),
  unique (version_id, min_qty)
);

-- -----------------------------------------------------------------------------
-- Parâmetros gerais do pedido + serviços
-- -----------------------------------------------------------------------------
create table if not exists public.catalog_settings (
  version_id             uuid primary key references public.catalog_versions (id) on delete cascade,
  currency               text not null default 'BRL',
  locale                 text not null default 'pt-BR',
  minimum_order_value    numeric not null default 0 check (minimum_order_value >= 0),
  margin_rate            numeric not null default 0 check (margin_rate >= 0),
  order_handling_fee     numeric not null default 0 check (order_handling_fee >= 0),
  max_instant_lead_days  integer not null default 20 check (max_instant_lead_days > 0),
  cut_setup_cost         numeric not null default 0 check (cut_setup_cost >= 0),
  services               jsonb not null
);

comment on column public.catalog_settings.services is
  'Parâmetros de dobra, rosca, insertos e gravação. JSONB por serem aninhados e mudarem pouco.';

-- -----------------------------------------------------------------------------
-- Índices de leitura
-- -----------------------------------------------------------------------------
create index if not exists processes_version_idx on public.processes (version_id);
create index if not exists materials_version_idx on public.materials (version_id, sort_order);
create index if not exists thicknesses_material_idx on public.material_thicknesses (material_id, mm);
create index if not exists finishes_version_idx on public.finishes (version_id, sort_order);
create index if not exists quantity_breaks_version_idx on public.quantity_breaks (version_id, min_qty);

-- -----------------------------------------------------------------------------
-- RLS
--
-- Leitura: qualquer um (inclusive anônimo) enxerga APENAS a versão publicada.
-- Rascunhos ficam visíveis só para admin — é o que permite montar a próxima
-- tabela de preços sem que ela vaze para os clientes antes da hora.
--
-- Escrita: exclusiva de admin.
-- -----------------------------------------------------------------------------
alter table public.catalog_versions      enable row level security;
alter table public.processes             enable row level security;
alter table public.materials             enable row level security;
alter table public.material_thicknesses  enable row level security;
alter table public.finishes              enable row level security;
alter table public.material_finishes     enable row level security;
alter table public.quantity_breaks       enable row level security;
alter table public.catalog_settings      enable row level security;

drop policy if exists "versões: leitura da publicada" on public.catalog_versions;
create policy "versões: leitura da publicada"
  on public.catalog_versions for select
  to anon, authenticated
  using (status = 'publicado' or public.is_admin());

drop policy if exists "versões: admin escreve" on public.catalog_versions;
create policy "versões: admin escreve"
  on public.catalog_versions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Tabelas ligadas a uma versão: herdam a visibilidade da versão.
do $$
declare
  t text;
begin
  foreach t in array array['processes', 'materials', 'finishes', 'quantity_breaks', 'catalog_settings']
  loop
    execute format($f$
      drop policy if exists "%1$s: leitura da versão publicada" on public.%1$I;
      create policy "%1$s: leitura da versão publicada"
        on public.%1$I for select
        to anon, authenticated
        using (exists (
          select 1 from public.catalog_versions v
          where v.id = %1$I.version_id
            and (v.status = 'publicado' or public.is_admin())
        ));

      drop policy if exists "%1$s: admin escreve" on public.%1$I;
      create policy "%1$s: admin escreve"
        on public.%1$I for all
        to authenticated
        using (public.is_admin())
        with check (public.is_admin());
    $f$, t);
  end loop;
end;
$$;

-- Tabelas ligadas a um material: sobem dois níveis até a versão.
drop policy if exists "espessuras: leitura da versão publicada" on public.material_thicknesses;
create policy "espessuras: leitura da versão publicada"
  on public.material_thicknesses for select
  to anon, authenticated
  using (exists (
    select 1
    from public.materials m
    join public.catalog_versions v on v.id = m.version_id
    where m.id = material_thicknesses.material_id
      and (v.status = 'publicado' or public.is_admin())
  ));

drop policy if exists "espessuras: admin escreve" on public.material_thicknesses;
create policy "espessuras: admin escreve"
  on public.material_thicknesses for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "material_acabamentos: leitura da versão publicada" on public.material_finishes;
create policy "material_acabamentos: leitura da versão publicada"
  on public.material_finishes for select
  to anon, authenticated
  using (exists (
    select 1
    from public.materials m
    join public.catalog_versions v on v.id = m.version_id
    where m.id = material_finishes.material_id
      and (v.status = 'publicado' or public.is_admin())
  ));

drop policy if exists "material_acabamentos: admin escreve" on public.material_finishes;
create policy "material_acabamentos: admin escreve"
  on public.material_finishes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Publicar uma versão: operação atômica.
--
-- Arquivar a anterior e publicar a nova precisa acontecer junto. Fora de uma
-- transação, uma falha no meio deixaria o sistema sem nenhuma versão publicada
-- — e todo orçamento novo cairia no fallback estático sem ninguém perceber.
-- -----------------------------------------------------------------------------
create or replace function public.publish_catalog_version(target uuid)
returns public.catalog_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  resultado public.catalog_versions;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem publicar uma versão do catálogo.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.catalog_settings where version_id = target) then
    raise exception 'A versão % não tem parâmetros de pedido definidos.', target
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.materials where version_id = target) then
    raise exception 'A versão % não tem nenhum material.', target
      using errcode = '23514';
  end if;

  update public.catalog_versions
     set status = 'arquivado'
   where status = 'publicado' and id <> target;

  update public.catalog_versions
     set status = 'publicado',
         published_at = now()
   where id = target
  returning * into resultado;

  if resultado.id is null then
    raise exception 'Versão % não encontrada.', target using errcode = 'P0002';
  end if;

  return resultado;
end;
$$;

revoke all on function public.publish_catalog_version(uuid) from public;
grant execute on function public.publish_catalog_version(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Clonar uma versão: base para editar preços sem mexer no que está no ar.
-- -----------------------------------------------------------------------------
create or replace function public.clone_catalog_version(source uuid, new_label text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nova uuid;
  material_antigo uuid;
  material_novo uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem clonar o catálogo.' using errcode = '42501';
  end if;

  insert into public.catalog_versions (label, status, created_by, notes)
  values (new_label, 'rascunho', auth.uid(), 'Clonado de ' || source::text)
  returning id into nova;

  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  )
  select nova, code, name, machine_rate_per_hour, kerf,
         handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
    from public.processes where version_id = source;

  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  )
  select nova, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
    from public.finishes where version_id = source;

  insert into public.quantity_breaks (version_id, min_qty, variable_factor)
  select nova, min_qty, variable_factor
    from public.quantity_breaks where version_id = source;

  insert into public.catalog_settings (
    version_id, currency, locale, minimum_order_value, margin_rate,
    order_handling_fee, max_instant_lead_days, cut_setup_cost, services
  )
  select nova, currency, locale, minimum_order_value, margin_rate,
         order_handling_fee, max_instant_lead_days, cut_setup_cost, services
    from public.catalog_settings where version_id = source;

  -- Materiais precisam de laço: os filhos referenciam o id novo de cada um.
  for material_antigo in select id from public.materials where version_id = source loop
    insert into public.materials (
      version_id, code, name, family, process_code, density,
      price_per_kg, scrap_factor, tappable, notes, sort_order
    )
    select nova, code, name, family, process_code, density,
           price_per_kg, scrap_factor, tappable, notes, sort_order
      from public.materials where id = material_antigo
    returning id into material_novo;

    insert into public.material_thicknesses (
      material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
      min_web_ratio, bendable, min_flange_ratio, bend_radius, available
    )
    select material_novo, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
           min_web_ratio, bendable, min_flange_ratio, bend_radius, available
      from public.material_thicknesses where material_id = material_antigo;

    insert into public.material_finishes (material_id, finish_code, sort_order)
    select material_novo, finish_code, sort_order
      from public.material_finishes where material_id = material_antigo;
  end loop;

  return nova;
end;
$$;

revoke all on function public.clone_catalog_version(uuid, text) from public;
grant execute on function public.clone_catalog_version(uuid, text) to authenticated;


-- >>>>> 20260814120200_orcamentos.sql >>>>>

-- =============================================================================
-- 0003 — Orçamentos e itens
-- =============================================================================
-- A decisão central: cada orçamento carrega uma CÓPIA CONGELADA do catálogo em
-- catalog_snapshot. Reabrir um orçamento antigo recalcula com os preços da
-- época, não com os de hoje. Sem isso, republicar a tabela de preços mudaria
-- silenciosamente o valor de propostas já enviadas ao cliente.
-- =============================================================================

-- Numeração legível: ORC-2026-0001.
create sequence if not exists public.quote_reference_seq;

create or replace function public.next_quote_reference()
returns text
language sql
volatile
as $$
  select 'ORC-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.quote_reference_seq')::text, 4, '0');
$$;

create table if not exists public.quotes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  reference           text not null unique default public.next_quote_reference(),
  title               text,
  status              text not null default 'rascunho'
                      check (status in ('rascunho', 'enviado', 'aceito', 'recusado', 'expirado')),

  -- Rastreabilidade: qual versão gerou, e a cópia imutável dela.
  catalog_version_id  uuid references public.catalog_versions (id) on delete set null,
  catalog_snapshot    jsonb not null,

  currency            text not null default 'BRL',
  total               numeric not null default 0 check (total >= 0),
  lead_days           integer not null default 0 check (lead_days >= 0),
  notes               text,

  -- Compartilhamento por link, sem exigir conta de quem recebe.
  share_token         text unique default replace(gen_random_uuid()::text, '-', ''),
  shared              boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '30 days')
);

comment on column public.quotes.catalog_snapshot is
  'Catálogo congelado no momento do salvamento. É a fonte de verdade para recalcular este orçamento.';
comment on column public.quotes.shared is
  'Enquanto false, o share_token não dá acesso. Compartilhar é um ato explícito.';

create table if not exists public.quote_items (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null references public.quotes (id) on delete cascade,
  position         integer not null default 0,

  filename         text not null,
  origin           text not null check (origin in ('arquivo', 'template')),

  -- Para itens de template: o que foi escolhido, o que permite regenerar exato.
  template_id      text,
  template_params  jsonb,

  -- Geometria completa para o preview. Fica nula quando o desenho é grande
  -- demais para valer a pena guardar (ver geometry_truncated).
  geometry             jsonb,
  geometry_truncated   boolean not null default false,

  -- Números que o motor de preço realmente consome. Sempre presentes, e é o
  -- que garante que o orçamento seja recalculável mesmo sem a geometria.
  geometry_summary jsonb not null,

  config           jsonb not null,
  unit_price       numeric not null check (unit_price >= 0),
  total_price      numeric not null check (total_price >= 0),
  lead_days        integer not null default 0,
  price_breakdown  jsonb not null,

  created_at       timestamptz not null default now()
);

create index if not exists quotes_user_idx on public.quotes (user_id, created_at desc);
create index if not exists quotes_status_idx on public.quotes (status);
create index if not exists quote_items_quote_idx on public.quote_items (quote_id, position);

drop trigger if exists quotes_touch on public.quotes;
create trigger quotes_touch
  before update on public.quotes
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: cada cliente enxerga só os próprios orçamentos.
-- -----------------------------------------------------------------------------
alter table public.quotes      enable row level security;
alter table public.quote_items enable row level security;

drop policy if exists "orçamentos: dono lê" on public.quotes;
create policy "orçamentos: dono lê"
  on public.quotes for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "orçamentos: dono cria" on public.quotes;
create policy "orçamentos: dono cria"
  on public.quotes for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "orçamentos: dono atualiza" on public.quotes;
create policy "orçamentos: dono atualiza"
  on public.quotes for update
  to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "orçamentos: dono apaga" on public.quotes;
create policy "orçamentos: dono apaga"
  on public.quotes for delete
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Itens seguem o dono do orçamento pai.
drop policy if exists "itens: seguem o orçamento" on public.quote_items;
create policy "itens: seguem o orçamento"
  on public.quote_items for all
  to authenticated
  using (exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id
      and (q.user_id = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id
      and (q.user_id = auth.uid() or public.is_admin())
  ));

-- -----------------------------------------------------------------------------
-- Acesso por link compartilhado.
--
-- Feito por função SECURITY DEFINER em vez de policy para anon: uma policy que
-- liberasse SELECT com base no token exigiria que o cliente pudesse consultar a
-- tabela, o que permitiria varrer tokens. A função devolve um orçamento só, e
-- apenas se o compartilhamento estiver ligado e não tiver expirado.
-- -----------------------------------------------------------------------------
create or replace function public.get_shared_quote(token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if token is null or length(token) < 16 then
    return null;
  end if;

  select jsonb_build_object(
           'quote', to_jsonb(q) - 'user_id' - 'share_token',
           'items', coalesce(
             (select jsonb_agg(to_jsonb(i) order by i.position)
                from public.quote_items i
               where i.quote_id = q.id),
             '[]'::jsonb
           )
         )
    into resultado
    from public.quotes q
   where q.share_token = token
     and q.shared = true
     and q.expires_at > now();

  return resultado;
end;
$$;

revoke all on function public.get_shared_quote(text) from public;
grant execute on function public.get_shared_quote(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Salvar um orçamento inteiro em uma transação.
--
-- Cabeçalho e itens precisam entrar juntos: um orçamento com o total salvo mas
-- sem itens (ou vice-versa) é pior que nenhum orçamento.
-- -----------------------------------------------------------------------------
create or replace function public.save_quote(
  payload jsonb,
  quote_id uuid default null
)
returns public.quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  destino public.quotes;
  item jsonb;
  posicao integer := 0;
begin
  if auth.uid() is null then
    raise exception 'É preciso estar autenticado para salvar um orçamento.' using errcode = '42501';
  end if;

  if quote_id is null then
    insert into public.quotes (
      user_id, title, status, catalog_version_id, catalog_snapshot,
      currency, total, lead_days, notes
    )
    values (
      auth.uid(),
      payload ->> 'title',
      coalesce(payload ->> 'status', 'rascunho'),
      nullif(payload ->> 'catalog_version_id', '')::uuid,
      payload -> 'catalog_snapshot',
      coalesce(payload ->> 'currency', 'BRL'),
      coalesce((payload ->> 'total')::numeric, 0),
      coalesce((payload ->> 'lead_days')::integer, 0),
      payload ->> 'notes'
    )
    returning * into destino;
  else
    update public.quotes
       set title              = payload ->> 'title',
           status             = coalesce(payload ->> 'status', status),
           catalog_version_id = nullif(payload ->> 'catalog_version_id', '')::uuid,
           catalog_snapshot   = payload -> 'catalog_snapshot',
           currency           = coalesce(payload ->> 'currency', currency),
           total              = coalesce((payload ->> 'total')::numeric, 0),
           lead_days          = coalesce((payload ->> 'lead_days')::integer, 0),
           notes              = payload ->> 'notes'
     where id = quote_id
       and (user_id = auth.uid() or public.is_admin())
    returning * into destino;

    if destino.id is null then
      raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = 'P0002';
    end if;

    -- Substitui os itens por completo: é mais simples e mais seguro do que
    -- tentar casar item a item, e o volume por orçamento é pequeno.
    delete from public.quote_items where quote_items.quote_id = destino.id;
  end if;

  for item in select * from jsonb_array_elements(coalesce(payload -> 'items', '[]'::jsonb))
  loop
    insert into public.quote_items (
      quote_id, position, filename, origin, template_id, template_params,
      geometry, geometry_truncated, geometry_summary, config,
      unit_price, total_price, lead_days, price_breakdown
    )
    values (
      destino.id,
      posicao,
      coalesce(item ->> 'filename', 'peça'),
      coalesce(item ->> 'origin', 'arquivo'),
      item ->> 'template_id',
      item -> 'template_params',
      item -> 'geometry',
      coalesce((item ->> 'geometry_truncated')::boolean, false),
      item -> 'geometry_summary',
      item -> 'config',
      coalesce((item ->> 'unit_price')::numeric, 0),
      coalesce((item ->> 'total_price')::numeric, 0),
      coalesce((item ->> 'lead_days')::integer, 0),
      coalesce(item -> 'price_breakdown', '[]'::jsonb)
    );
    posicao := posicao + 1;
  end loop;

  return destino;
end;
$$;

revoke all on function public.save_quote(jsonb, uuid) from public;
grant execute on function public.save_quote(jsonb, uuid) to authenticated;


-- >>>>> 20260814120300_seed_catalogo.sql >>>>>

-- =============================================================================
-- 0004 — Seed do catálogo
-- =============================================================================
-- GERADO AUTOMATICAMENTE por scripts/generate-seed-sql.ts — não edite à mão.
-- Para alterar, mude src/lib/quote/catalog.ts e rode: npm run seed:sql
--
-- Idempotente: apaga a versão "Catálogo inicial" e a recria do zero.
-- =============================================================================

do $$
declare
  v_id uuid;
  m_id uuid;
begin
  -- Remove um seed anterior, se existir. Orçamentos já salvos NÃO são afetados:
  -- eles carregam o próprio snapshot congelado do catálogo.
  delete from public.catalog_versions where label = 'Catálogo inicial';

  insert into public.catalog_versions (label, status, notes)
  values ('Catálogo inicial', 'rascunho',
          'Semeado a partir de src/lib/quote/catalog.ts. Valores de exemplo — calibrar antes de uso comercial.')
  returning id into v_id;


  -- Processos de corte
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'laser-fibra', 'Laser de fibra', 240, 0.15,
    8, 3, 3000, 1500, 'Metais em geral. Melhor relação custo-precisão para chapa fina.'
  );
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'laser-co2', 'Laser CO₂', 160, 0.25,
    6, 3, 1300, 900, 'Acrílico, madeira e polímeros. Borda polida em acrílico.'
  );
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'jato-dagua', 'Jato d’água abrasivo', 380, 0.9,
    20, 6, 2000, 1500, 'Sem zona termicamente afetada. Compósitos, titânio e chapa grossa.'
  );
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'router-cnc', 'Router CNC', 130, 3.175,
    12, 4, 2440, 1220, 'Madeira, MDF e plásticos espessos. Fresa de 1/8".'
  );

  -- Acabamentos
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'nenhum', 'Sem acabamento', 0, 0,
    0, 0, 'Peça sai como cortada, com rebarba e óxido de corte.', 0
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'rebarbado', 'Rebarbação', 0, 35,
    2.4, 1, 'Remove a aresta viva e o respingo de corte.', 1
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'escovado', 'Escovado (grão 240)', 95, 60,
    3.2, 2, 'Acabamento direcional em inox e latão.', 2
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'polido', 'Polido espelhado', 210, 90,
    6, 3, 'Polimento mecânico progressivo.', 3
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'jateado', 'Jateamento', 78, 70,
    2.8, 2, 'Textura fosca uniforme; boa base para pintura.', 4
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'zincado', 'Zincagem eletrolítica', 120, 140,
    3.5, 4, 'Proteção contra corrosão em aço carbono.', 5
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'pintura-po', 'Pintura a pó', 165, 180,
    5.5, 5, 'Camada epóxi-poliéster curada em estufa.', 6
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'anodizado', 'Anodização', 195, 210,
    5, 6, 'Camada de óxido dura, só para alumínio.', 7
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'eletropolido', 'Eletropolimento', 260, 240,
    7, 6, 'Passivação e brilho para inox de grau sanitário/médico.', 8
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'lixado', 'Lixado', 45, 25,
    1.8, 1, 'Remove a fibra levantada no corte de madeira.', 9
  );

  -- Faixas de quantidade
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 1, 1);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 5, 0.94);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 10, 0.89);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 25, 0.84);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 50, 0.79);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 100, 0.74);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 250, 0.7);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 500, 0.66);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 1000, 0.62);

  -- Parâmetros de pedido e serviços
  insert into public.catalog_settings (
    version_id, currency, locale, minimum_order_value, margin_rate,
    order_handling_fee, max_instant_lead_days, cut_setup_cost, services
  ) values (
    v_id, 'BRL', 'pt-BR', 180, 0.42,
    28, 20, 65,
    '{"bending":{"setupPerBendLine":85,"secondsPerBend":14,"ratePerHour":190,"leadDays":2,"maxBendLength":2500},"tapping":{"setupCost":45,"secondsPerHole":22,"ratePerHour":120,"leadDays":1},"hardware":{"setupCost":60,"secondsPerInsert":18,"ratePerHour":130,"pricePerInsert":3.8,"leadDays":1},"etching":{"setupCost":25,"speedMPerMin":20,"leadDays":0}}'::jsonb
  );

  -- Materiais, espessuras e acabamentos compatíveis

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'aco-1020', 'Aço carbono SAE 1020', 'Aço carbono', 'laser-fibra', 7.85,
    9.5, 0.18, true, 'Oxida sem acabamento. Especifique zincagem ou pintura para uso externo.', 0
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.9, '0,90 mm (20 ga)', 14, 0.3, 1,
    1, true, 4, 0.9, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.2, '1,20 mm (18 ga)', 12, 0.35, 1,
    1, true, 4, 1.2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.5, '1,50 mm (16 ga)', 10, 0.4, 1,
    1, true, 4, 1.5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm (14 ga)', 7.5, 0.5, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm (11 ga)', 4.5, 0.8, 1,
    1, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4.75, '4,75 mm (3/16")', 2.4, 1.4, 1,
    1, true, 4, 4.75, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6.35, '6,35 mm (1/4")', 1.5, 2.2, 1,
    1, false, 4, 6.35, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 9.525, '9,53 mm (3/8")', 0.9, 4, 1,
    1, false, 4, 9.525, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 12.7, '12,70 mm (1/2")', 0.6, 6.5, 1,
    1, false, 4, 12.7, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'zincado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'pintura-po', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'inox-304', 'Aço inox 304', 'Aço inox', 'laser-fibra', 8,
    42, 0.2, true, 'Padrão para contato com alimentos e ambientes corrosivos.', 1
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 11, 0.4, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.2, '1,20 mm', 9, 0.5, 1,
    1, true, 4, 1.2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.5, '1,50 mm', 7.5, 0.6, 1,
    1, true, 4, 1.5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 5.5, 0.8, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 3.2, 1.3, 1,
    1, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4, '4,00 mm', 2, 2, 1,
    1, true, 4, 4, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 1.1, 3.4, 1,
    1, true, 4, 6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 8, '8,00 mm', 0.7, 5.5, 1,
    1, false, 4, 8, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'escovado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'eletropolido', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'inox-316l', 'Aço inox 316L', 'Aço inox', 'laser-fibra', 8,
    68, 0.2, true, 'Grau cirúrgico/implantável. Exigido em ambientes com cloretos.', 2
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 10, 0.45, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.2, '1,20 mm', 8.5, 0.55, 1,
    1, true, 4, 1.2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.5, '1,50 mm', 7, 0.65, 1,
    1, true, 4, 1.5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 5, 0.9, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 3, 1.4, 1,
    1, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4, '4,00 mm', 1.8, 2.2, 1,
    1, true, 4, 4, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'escovado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'eletropolido', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'aluminio-5052', 'Alumínio 5052-H32', 'Alumínio', 'laser-fibra', 2.68,
    48, 0.18, true, 'Melhor liga para dobra. Padrão para gabinetes e chassis.', 3
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 16, 0.3, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1, '1,00 mm', 15, 0.3, 1,
    1, true, 4, 1, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm (1/16")', 12, 0.4, 1,
    1, true, 4, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 10, 0.5, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm (1/8")', 6, 0.9, 1,
    1, true, 4, 3.175, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4.76, '4,76 mm (3/16")', 3.5, 1.5, 1,
    1, true, 4, 4.76, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6.35, '6,35 mm (1/4")', 2.2, 2.4, 1,
    1, false, 4, 6.35, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'anodizado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'pintura-po', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'aluminio-6061', 'Alumínio 6061-T6', 'Alumínio', 'laser-fibra', 2.7,
    55, 0.18, true, 'Mais resistente que o 5052, porém trinca em dobras fechadas.', 4
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm (1/16")', 12, 0.4, 1,
    1, true, 5, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm (1/8")', 6, 0.9, 1,
    1, true, 5, 3.175, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6.35, '6,35 mm (1/4")', 2.2, 2.4, 1,
    1, false, 5, 6.35, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 9.525, '9,53 mm (3/8")', 1.2, 4.2, 1,
    1, false, 5, 9.525, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 12.7, '12,70 mm (1/2")', 0.7, 7, 1,
    1, false, 5, 12.7, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'anodizado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 3);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'latao-260', 'Latão C260', 'Latão e cobre', 'laser-fibra', 8.53,
    78, 0.22, true, null, 5
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 8, 0.5, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm', 5.5, 0.8, 1,
    1, true, 4, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm', 2.8, 1.6, 1,
    1, true, 4, 3.175, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'escovado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'polido', 3);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'cobre-110', 'Cobre C110', 'Latão e cobre', 'laser-fibra', 8.94,
    96, 0.22, false, 'Alta refletividade: corte mais lento e sujeito a análise prévia.', 6
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 6, 0.7, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm', 4, 1.1, 1,
    1, true, 4, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm', 2, 2.2, 1,
    1, true, 4, 3.175, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'polido', 2);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'titanio-gr2', 'Titânio Grau 2', 'Titânio', 'jato-dagua', 4.51,
    420, 0.28, true, 'Cortado em jato d’água para evitar zona termicamente afetada.', 7
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1, '1,00 mm', 1.4, 6, 1.5,
    1.5, true, 4, 1, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 0.8, 9, 1.5,
    1.5, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 0.5, 12, 1.5,
    1.5, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 0.25, 20, 1.5,
    1.5, false, 4, 6, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 2);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'acrilico', 'Acrílico (PMMA)', 'Plásticos', 'laser-co2', 1.19,
    62, 0.2, false, 'Borda sai polida no laser CO₂. Não dobra a frio.', 8
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 6, 0.4, 1.2,
    1.5, false, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 4.5, 0.5, 1.2,
    1.5, false, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 5, '5,00 mm', 2.5, 0.8, 1.2,
    1.5, false, 4, 5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 8, '8,00 mm', 1.2, 1.4, 1.2,
    1.5, false, 4, 8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 10, '10,00 mm', 0.8, 2, 1.2,
    1.5, false, 4, 10, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'policarbonato', 'Policarbonato', 'Plásticos', 'router-cnc', 1.2,
    74, 0.2, false, 'Queima no laser: usinado em router para manter transparência.', 9
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 3.5, 1.5, 1.5,
    2, false, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 3, 1.8, 1.5,
    2, false, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 1.8, 2.5, 1.5,
    2, false, 4, 6, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'mdf', 'MDF', 'Madeira', 'router-cnc', 0.75,
    12, 0.22, false, null, 10
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 5, 1.2, 1.2,
    2, false, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 4, 1.5, 1.2,
    2, false, 4, 6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 9, '9,00 mm', 3, 2, 1.2,
    2, false, 4, 9, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 15, '15,00 mm', 1.8, 3, 1.2,
    2, false, 4, 15, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'lixado', 1);

  -- Publica a versão recém-criada.
  update public.catalog_versions set status = 'arquivado' where status = 'publicado';
  update public.catalog_versions set status = 'publicado', published_at = now() where id = v_id;

  raise notice 'Catálogo semeado e publicado: %', v_id;
end;
$$;

-- =============================================================================
-- Promover seu usuário a administrador
-- =============================================================================
-- Rode DEPOIS de criar a conta pela tela de cadastro do app.
-- Troque o e-mail e execute:
--
--   update public.profiles
--      set role = 'admin'
--    where id = (select id from auth.users where email = 'voce@empresa.com.br');
--
-- Sem isso ninguém consegue editar o catálogo pela interface — o que é o
-- comportamento correto: admin não é o padrão.
-- =============================================================================
