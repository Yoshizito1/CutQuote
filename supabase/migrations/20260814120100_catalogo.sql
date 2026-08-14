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
