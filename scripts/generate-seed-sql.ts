/**
 * Gera a migration de seed do catálogo a partir do STATIC_CATALOG.
 *
 * Assim o catálogo do código e o do banco nascem idênticos, e não existe uma
 * segunda cópia dos preços para sair de sincronia. Regenere depois de mexer em
 * `src/lib/quote/catalog.ts`.
 *
 * O SQL roda como dono das tabelas (tanto no SQL Editor quanto via `db push`),
 * então ignora RLS — o seed não precisa de conta de admin nem de service_role.
 *
 * O nome do arquivo segue o formato de timestamp exigido pelo Supabase CLI;
 * arquivos fora desse padrão são ignorados pelo `supabase db push`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STATIC_CATALOG } from '../src/lib/quote/catalog';

/** Escapa um literal de texto para SQL. */
function q(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'null';
  return `'${value.replace(/'/g, "''")}'`;
}

function n(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function b(value: boolean): string {
  return value ? 'true' : 'false';
}

const catalog = STATIC_CATALOG;
const lines: string[] = [];

lines.push(`-- =============================================================================
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
`);

// --- Processos ---------------------------------------------------------------
lines.push('\n  -- Processos de corte');
for (const process of Object.values(catalog.processes)) {
  lines.push(`  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, ${q(process.id)}, ${q(process.name)}, ${n(process.machineRatePerHour)}, ${n(process.kerf)},
    ${n(process.handlingSecondsPerPart)}, ${n(process.baseLeadDays)}, ${n(process.sheet.width)}, ${n(process.sheet.height)}, ${q(process.description)}
  );`);
}

// --- Acabamentos -------------------------------------------------------------
lines.push('\n  -- Acabamentos');
Object.values(catalog.finishes).forEach((finish, index) => {
  lines.push(`  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, ${q(finish.id)}, ${q(finish.name)}, ${n(finish.pricePerM2)}, ${n(finish.setupCost)},
    ${n(finish.pricePerPart)}, ${n(finish.leadDays)}, ${q(finish.description)}, ${index}
  );`);
});

// --- Faixas de quantidade ----------------------------------------------------
lines.push('\n  -- Faixas de quantidade');
for (const tier of catalog.quantityBreaks) {
  lines.push(
    `  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, ${n(tier.minQty)}, ${n(tier.variableFactor)});`,
  );
}

// --- Parâmetros gerais -------------------------------------------------------
const order = catalog.orderConfig;
lines.push(`
  -- Parâmetros de pedido e serviços
  insert into public.catalog_settings (
    version_id, currency, locale, minimum_order_value, margin_rate,
    order_handling_fee, max_instant_lead_days, cut_setup_cost, services
  ) values (
    v_id, ${q(order.currency)}, ${q(order.locale)}, ${n(order.minimumOrderValue)}, ${n(order.marginRate)},
    ${n(order.orderHandlingFee)}, ${n(order.maxInstantLeadDays)}, ${n(order.cutSetupCost)},
    ${q(JSON.stringify(catalog.services))}::jsonb
  );`);

// --- Materiais ---------------------------------------------------------------
lines.push('\n  -- Materiais, espessuras e acabamentos compatíveis');
catalog.materials.forEach((material, index) => {
  lines.push(`
  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, ${q(material.id)}, ${q(material.name)}, ${q(material.family)}, ${q(material.process)}, ${n(material.density)},
    ${n(material.pricePerKg)}, ${n(material.scrapFactor)}, ${b(material.tappable)}, ${q(material.notes)}, ${index}
  ) returning id into m_id;`);

  for (const thickness of material.thicknesses) {
    lines.push(`  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, ${n(thickness.mm)}, ${q(thickness.label)}, ${n(thickness.cutSpeedMPerMin)}, ${n(thickness.pierceSeconds)}, ${n(thickness.minHoleRatio)},
    ${n(thickness.minWebRatio)}, ${b(thickness.bendable)}, ${n(thickness.minFlangeRatio)}, ${n(thickness.bendRadius)}, ${b(thickness.available)}
  );`);
  }

  material.finishes.forEach((finishId, finishIndex) => {
    lines.push(
      `  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, ${q(finishId)}, ${finishIndex});`,
    );
  });
});

lines.push(`
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
`);

const outPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260814120300_seed_catalogo.sql',
);
writeFileSync(outPath, lines.join('\n'), 'utf8');

const materialCount = catalog.materials.length;
const thicknessCount = catalog.materials.reduce((sum, m) => sum + m.thicknesses.length, 0);

console.log('Seed SQL gerado em supabase/migrations/0004_seed_catalogo.sql');
console.log(
  `  ${Object.keys(catalog.processes).length} processos · ${materialCount} materiais · ` +
    `${thicknessCount} espessuras · ${Object.keys(catalog.finishes).length} acabamentos · ` +
    `${catalog.quantityBreaks.length} faixas`,
);
