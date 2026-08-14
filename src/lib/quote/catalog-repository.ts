/**
 * Tradução entre as linhas do banco e o objeto `Catalog` que o motor consome.
 *
 * O motor de preço não sabe que existe Supabase — recebe um `Catalog` e pronto.
 * Toda a conversão fica isolada aqui, o que mantém `pricing.ts` testável sem
 * banco e permite trocar a origem dos dados sem tocar na regra de negócio.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';
import {
  STATIC_CATALOG,
  type Catalog,
  type CutProcess,
  type CutProcessId,
  type Finish,
  type Material,
  type OrderConfig,
  type ServiceParams,
  type ThicknessOption,
} from './catalog';

export interface CatalogLoadResult {
  catalog: Catalog;
  /** false quando caiu no fallback estático. */
  fromDatabase: boolean;
  /** Motivo do fallback, quando houver. */
  reason?: string;
}

type Client = SupabaseClient<Database>;

/**
 * Carrega a versão publicada do catálogo.
 *
 * Falha nunca derruba a aplicação: se o banco estiver fora, sem versão
 * publicada ou com dado incompleto, volta o catálogo estático e informa o
 * motivo. Um orçamentista que não abre é pior que um que abre com a tabela
 * padrão — desde que a origem fique visível, e ela fica.
 */
export async function loadPublishedCatalog(client: Client | null): Promise<CatalogLoadResult> {
  if (!client) {
    return { catalog: STATIC_CATALOG, fromDatabase: false, reason: 'Supabase não configurado.' };
  }

  try {
    const { data: version, error: versionError } = await client
      .from('catalog_versions')
      .select('id, label, status, published_at')
      .eq('status', 'publicado')
      .maybeSingle();

    if (versionError) {
      return {
        catalog: STATIC_CATALOG,
        fromDatabase: false,
        reason: `Erro ao ler versões: ${versionError.message}`,
      };
    }
    if (!version) {
      return {
        catalog: STATIC_CATALOG,
        fromDatabase: false,
        reason: 'Nenhuma versão de catálogo publicada. Rode o seed ou publique uma versão.',
      };
    }

    return await loadCatalogVersion(client, version.id, version.label);
  } catch (error) {
    return {
      catalog: STATIC_CATALOG,
      fromDatabase: false,
      reason: error instanceof Error ? error.message : 'Falha ao carregar o catálogo.',
    };
  }
}

/** Carrega uma versão específica — usada pela tela de admin para editar rascunhos. */
export async function loadCatalogVersion(
  client: Client,
  versionId: string,
  label = 'Versão do banco',
): Promise<CatalogLoadResult> {
  const [processesResult, materialsResult, finishesResult, breaksResult, settingsResult] =
    await Promise.all([
      client.from('processes').select('*').eq('version_id', versionId),
      client.from('materials').select('*').eq('version_id', versionId).order('sort_order'),
      client.from('finishes').select('*').eq('version_id', versionId).order('sort_order'),
      client.from('quantity_breaks').select('*').eq('version_id', versionId).order('min_qty'),
      client.from('catalog_settings').select('*').eq('version_id', versionId).maybeSingle(),
    ]);

  const failure =
    processesResult.error ??
    materialsResult.error ??
    finishesResult.error ??
    breaksResult.error ??
    settingsResult.error;

  if (failure) {
    return { catalog: STATIC_CATALOG, fromDatabase: false, reason: failure.message };
  }
  if (!settingsResult.data || (materialsResult.data?.length ?? 0) === 0) {
    return {
      catalog: STATIC_CATALOG,
      fromDatabase: false,
      reason: 'Versão do catálogo incompleta (sem materiais ou sem parâmetros de pedido).',
    };
  }

  const materialIds = (materialsResult.data ?? []).map((material) => material.id);

  const [thicknessResult, materialFinishResult] = await Promise.all([
    client.from('material_thicknesses').select('*').in('material_id', materialIds).order('mm'),
    client.from('material_finishes').select('*').in('material_id', materialIds).order('sort_order'),
  ]);

  if (thicknessResult.error || materialFinishResult.error) {
    return {
      catalog: STATIC_CATALOG,
      fromDatabase: false,
      reason: (thicknessResult.error ?? materialFinishResult.error)?.message,
    };
  }

  // Agrupa filhos por material antes de montar, para não varrer as listas
  // dentro do laço.
  const thicknessByMaterial = new Map<string, ThicknessOption[]>();
  for (const row of thicknessResult.data ?? []) {
    const option: ThicknessOption = {
      mm: Number(row.mm),
      label: row.label,
      cutSpeedMPerMin: Number(row.cut_speed_m_per_min),
      pierceSeconds: Number(row.pierce_seconds),
      minHoleRatio: Number(row.min_hole_ratio),
      minWebRatio: Number(row.min_web_ratio),
      bendable: row.bendable,
      minFlangeRatio: Number(row.min_flange_ratio),
      bendRadius: Number(row.bend_radius),
      available: row.available,
    };
    const bucket = thicknessByMaterial.get(row.material_id);
    if (bucket) bucket.push(option);
    else thicknessByMaterial.set(row.material_id, [option]);
  }

  const finishesByMaterial = new Map<string, string[]>();
  for (const row of materialFinishResult.data ?? []) {
    const bucket = finishesByMaterial.get(row.material_id);
    if (bucket) bucket.push(row.finish_code);
    else finishesByMaterial.set(row.material_id, [row.finish_code]);
  }

  const processes = {} as Record<CutProcessId, CutProcess>;
  for (const row of processesResult.data ?? []) {
    processes[row.code as CutProcessId] = {
      id: row.code as CutProcessId,
      name: row.name,
      machineRatePerHour: Number(row.machine_rate_per_hour),
      kerf: Number(row.kerf),
      handlingSecondsPerPart: Number(row.handling_seconds_per_part),
      baseLeadDays: row.base_lead_days,
      sheet: { width: Number(row.sheet_width), height: Number(row.sheet_height) },
      description: row.description ?? '',
    };
  }

  const finishes: Record<string, Finish> = {};
  for (const row of finishesResult.data ?? []) {
    finishes[row.code] = {
      id: row.code,
      name: row.name,
      pricePerM2: Number(row.price_per_m2),
      setupCost: Number(row.setup_cost),
      pricePerPart: Number(row.price_per_part),
      leadDays: row.lead_days,
      description: row.description ?? '',
    };
  }

  const materials: Material[] = (materialsResult.data ?? []).map((row) => ({
    id: row.code,
    name: row.name,
    family: row.family,
    process: row.process_code as CutProcessId,
    density: Number(row.density),
    pricePerKg: Number(row.price_per_kg),
    scrapFactor: Number(row.scrap_factor),
    tappable: row.tappable,
    notes: row.notes ?? undefined,
    finishes: finishesByMaterial.get(row.id) ?? ['nenhum'],
    thicknesses: (thicknessByMaterial.get(row.id) ?? []).sort((a, b) => a.mm - b.mm),
  }));

  const settings = settingsResult.data;
  const orderConfig: OrderConfig = {
    currency: settings.currency,
    locale: settings.locale,
    minimumOrderValue: Number(settings.minimum_order_value),
    marginRate: Number(settings.margin_rate),
    orderHandlingFee: Number(settings.order_handling_fee),
    maxInstantLeadDays: settings.max_instant_lead_days,
    cutSetupCost: Number(settings.cut_setup_cost),
  };

  const catalog: Catalog = {
    versionId,
    label,
    processes,
    materials,
    finishes,
    services: settings.services as unknown as ServiceParams,
    quantityBreaks: (breaksResult.data ?? []).map((row) => ({
      minQty: row.min_qty,
      variableFactor: Number(row.variable_factor),
    })),
    orderConfig,
  };

  const problem = validateCatalog(catalog);
  if (problem) {
    return { catalog: STATIC_CATALOG, fromDatabase: false, reason: problem };
  }

  return { catalog, fromDatabase: true };
}

/**
 * Checagem de integridade antes de deixar um catálogo do banco entrar em uso.
 *
 * Um catálogo quebrado (material apontando para processo inexistente, nenhuma
 * espessura disponível) produziria preço errado em vez de erro visível. É
 * melhor recusar e cair no estático.
 */
export function validateCatalog(catalog: Catalog): string | null {
  if (catalog.materials.length === 0) return 'Catálogo sem materiais.';
  if (Object.keys(catalog.processes).length === 0) return 'Catálogo sem processos de corte.';
  if (!catalog.finishes.nenhum) return 'Catálogo sem o acabamento padrão "nenhum".';
  if (catalog.quantityBreaks.length === 0) return 'Catálogo sem faixas de quantidade.';

  for (const material of catalog.materials) {
    if (!catalog.processes[material.process]) {
      return `Material "${material.id}" aponta para o processo inexistente "${material.process}".`;
    }
    if (material.thicknesses.filter((thickness) => thickness.available).length === 0) {
      return `Material "${material.id}" não tem nenhuma espessura disponível.`;
    }
    for (const finishId of material.finishes) {
      if (!catalog.finishes[finishId]) {
        return `Material "${material.id}" aceita o acabamento inexistente "${finishId}".`;
      }
    }
  }

  const services = catalog.services;
  if (!services?.bending || !services.tapping || !services.hardware || !services.etching) {
    return 'Parâmetros de serviço incompletos (dobra, rosca, insertos, gravação).';
  }
  return null;
}

/** Lista de versões para a tela de admin. */
export async function listCatalogVersions(client: Client) {
  const { data, error } = await client
    .from('catalog_versions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
