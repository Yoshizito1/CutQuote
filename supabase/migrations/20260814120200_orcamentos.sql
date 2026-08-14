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
