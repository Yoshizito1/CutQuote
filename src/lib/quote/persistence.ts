/**
 * Persistência de orçamentos.
 *
 * Duas decisões que definem o comportamento:
 *
 * 1. O catálogo é CONGELADO junto do orçamento. Reabrir uma proposta antiga
 *    mostra os preços da época, não os de hoje.
 *
 * 2. A geometria completa só é guardada quando cabe. Um painel com 3.000 furos
 *    gera megabytes de pontos; acima do limite guardamos apenas o resumo
 *    numérico e marcamos `geometryTruncated`. O orçamento continua íntegro —
 *    perde-se a pré-visualização e o recálculo, não o valor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PartGeometry } from '../geometry';
import type { Database, Json, QuoteItemRow, QuoteRow } from '../supabase/database.types';
import { STATIC_CATALOG, cloneCatalog, type Catalog } from './catalog';
import type { DfmIssue, PartConfig, PartQuote, PriceLine } from './types';

type Client = SupabaseClient<Database>;

/** Acima disso a geometria não é guardada — ver nota no topo do arquivo. */
const MAX_GEOMETRY_BYTES = 400_000;

export interface PersistedItemInput {
  filename: string;
  origin: 'arquivo' | 'template';
  templateId?: string | null;
  templateParams?: Record<string, number> | null;
  geometry: PartGeometry;
  config: PartConfig;
  quote: PartQuote;
}

export interface SaveQuoteInput {
  title: string | null;
  status?: QuoteRow['status'];
  notes?: string | null;
  catalog: Catalog;
  items: PersistedItemInput[];
}

/** Números que bastam para reexibir o orçamento sem a geometria completa. */
export interface GeometrySummary {
  cutLength: number;
  etchLength: number;
  pierces: number;
  netArea: number;
  bboxArea: number;
  bodyCount: number;
  holeCount: number;
  density: number;
  bendCount: number;
  openChainCount: number;
  bbox: { width: number; height: number };
  sourceFormat: string;
  sourceUnit: string;
}

export function summarizeGeometry(geometry: PartGeometry): GeometrySummary {
  return {
    cutLength: geometry.cutLength,
    etchLength: geometry.etchLength,
    pierces: geometry.pierces,
    netArea: geometry.netArea,
    bboxArea: geometry.bboxArea,
    bodyCount: geometry.bodyCount,
    holeCount: geometry.holeCount,
    density: geometry.density,
    bendCount: geometry.bendLines.length,
    openChainCount: geometry.openChains.length,
    bbox: { width: geometry.bbox.width, height: geometry.bbox.height },
    sourceFormat: geometry.source.format,
    sourceUnit: geometry.source.sourceUnit,
  };
}

/**
 * Reduz a geometria ao que é serializável e útil.
 *
 * `source.polylines` é descartado: é a maior parte do volume e já está
 * representado em `loops`, `bendLines` e `etchLines`.
 */
function packGeometry(geometry: PartGeometry): { data: Json | null; truncated: boolean } {
  const compact = {
    loops: geometry.loops,
    openChains: geometry.openChains,
    bendLines: geometry.bendLines,
    etchLines: geometry.etchLines,
    bbox: geometry.bbox,
    cutLength: geometry.cutLength,
    etchLength: geometry.etchLength,
    pierces: geometry.pierces,
    netArea: geometry.netArea,
    bboxArea: geometry.bboxArea,
    bodyCount: geometry.bodyCount,
    holeCount: geometry.holeCount,
    density: geometry.density,
    source: {
      polylines: [],
      sourceUnit: geometry.source.sourceUnit,
      unitScale: geometry.source.unitScale,
      layers: geometry.source.layers,
      ignoredEntities: geometry.source.ignoredEntities,
      format: geometry.source.format,
    },
  };

  const serialized = JSON.stringify(compact);
  if (serialized.length > MAX_GEOMETRY_BYTES) {
    return { data: null, truncated: true };
  }
  return { data: JSON.parse(serialized) as Json, truncated: false };
}

/** Reconstrói uma geometria salva. Devolve null quando foi truncada. */
export function unpackGeometry(data: Json | null): PartGeometry | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as unknown as PartGeometry;
}

export interface SavedQuoteItem {
  id: string;
  position: number;
  filename: string;
  origin: 'arquivo' | 'template';
  templateId: string | null;
  templateParams: Record<string, number> | null;
  geometry: PartGeometry | null;
  geometryTruncated: boolean;
  summary: GeometrySummary;
  config: PartConfig;
  unitPrice: number;
  totalPrice: number;
  leadDays: number;
  priceLines: PriceLine[];
  issues: DfmIssue[];
}

export interface SavedQuote {
  id: string;
  reference: string;
  title: string | null;
  status: QuoteRow['status'];
  total: number;
  leadDays: number;
  currency: string;
  notes: string | null;
  shared: boolean;
  shareToken: string | null;
  catalog: Catalog;
  catalogVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  items: SavedQuoteItem[];
}

/** Salva (ou atualiza) um orçamento inteiro em uma transação, via RPC. */
export async function saveQuote(
  client: Client,
  input: SaveQuoteInput,
  quoteId?: string,
): Promise<{ id: string; reference: string }> {
  const total = input.items.reduce((sum, item) => sum + item.quote.totalPrice, 0);
  const leadDays = input.items.reduce((max, item) => Math.max(max, item.quote.leadDays), 0);

  const payload = {
    title: input.title,
    status: input.status ?? 'rascunho',
    notes: input.notes ?? null,
    // Congela o catálogo: esta é a garantia de que o preço não muda sozinho.
    catalog_version_id: input.catalog.versionId === 'static' ? null : input.catalog.versionId,
    catalog_snapshot: cloneCatalog(input.catalog),
    currency: input.catalog.orderConfig.currency,
    total,
    lead_days: leadDays,
    items: input.items.map((item) => {
      const packed = packGeometry(item.geometry);
      return {
        filename: item.filename,
        origin: item.origin,
        template_id: item.templateId ?? null,
        template_params: item.templateParams ?? null,
        geometry: packed.data,
        geometry_truncated: packed.truncated,
        geometry_summary: summarizeGeometry(item.geometry),
        config: item.config,
        unit_price: item.quote.unitPrice,
        total_price: item.quote.totalPrice,
        lead_days: item.quote.leadDays,
        price_breakdown: { lines: item.quote.lines, issues: item.quote.issues },
      };
    }),
  };

  const { data, error } = await client.rpc('save_quote', {
    payload: payload as unknown as Json,
    quote_id: quoteId ?? null,
  });

  if (error) throw new Error(`Não foi possível salvar o orçamento: ${error.message}`);

  const saved = data as unknown as QuoteRow;
  return { id: saved.id, reference: saved.reference };
}

function mapItem(row: QuoteItemRow): SavedQuoteItem {
  const breakdown = (row.price_breakdown ?? {}) as { lines?: PriceLine[]; issues?: DfmIssue[] };
  return {
    id: row.id,
    position: row.position,
    filename: row.filename,
    origin: row.origin,
    templateId: row.template_id,
    templateParams: (row.template_params as Record<string, number> | null) ?? null,
    geometry: unpackGeometry(row.geometry),
    geometryTruncated: row.geometry_truncated,
    summary: row.geometry_summary as unknown as GeometrySummary,
    config: row.config as unknown as PartConfig,
    unitPrice: Number(row.unit_price),
    totalPrice: Number(row.total_price),
    leadDays: row.lead_days,
    priceLines: breakdown.lines ?? [],
    issues: breakdown.issues ?? [],
  };
}

function mapQuote(row: QuoteRow, items: QuoteItemRow[]): SavedQuote {
  // Um snapshot corrompido não pode derrubar a tela; cai no estático e o
  // orçamento ainda mostra os valores gravados.
  const snapshot = (row.catalog_snapshot as unknown as Catalog | null) ?? STATIC_CATALOG;

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    total: Number(row.total),
    leadDays: row.lead_days,
    currency: row.currency,
    notes: row.notes,
    shared: row.shared,
    shareToken: row.share_token,
    catalog: snapshot,
    catalogVersionId: row.catalog_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    items: items.map(mapItem).sort((a, b) => a.position - b.position),
  };
}

export async function loadQuote(client: Client, id: string): Promise<SavedQuote | null> {
  const { data: quote, error } = await client.from('quotes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!quote) return null;

  const { data: items, error: itemsError } = await client
    .from('quote_items')
    .select('*')
    .eq('quote_id', id)
    .order('position');

  if (itemsError) throw new Error(itemsError.message);
  return mapQuote(quote, items ?? []);
}

export interface QuoteListRow {
  id: string;
  reference: string;
  title: string | null;
  status: QuoteRow['status'];
  total: number;
  currency: string;
  itemCount: number;
  createdAt: string;
  expiresAt: string;
}

export async function listQuotes(client: Client): Promise<QuoteListRow[]> {
  const { data, error } = await client
    .from('quotes')
    .select('id, reference, title, status, total, currency, created_at, expires_at, quote_items(count)')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const counted = row as typeof row & { quote_items?: { count: number }[] };
    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      status: row.status,
      total: Number(row.total),
      currency: row.currency,
      itemCount: counted.quote_items?.[0]?.count ?? 0,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });
}

export async function deleteQuote(client: Client, id: string): Promise<void> {
  const { error } = await client.from('quotes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Liga ou desliga o link público. Desligar invalida o link na hora. */
export async function setQuoteShared(
  client: Client,
  id: string,
  shared: boolean,
): Promise<string | null> {
  const { data, error } = await client
    .from('quotes')
    .update({ shared })
    .eq('id', id)
    .select('share_token')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return shared ? (data?.share_token ?? null) : null;
}

/** Lê um orçamento compartilhado sem exigir login. */
export async function loadSharedQuote(
  client: Client,
  token: string,
): Promise<SavedQuote | null> {
  const { data, error } = await client.rpc('get_shared_quote', { token });
  if (error) throw new Error(error.message);
  if (!data) return null;

  const payload = data as unknown as { quote: QuoteRow; items: QuoteItemRow[] };
  return mapQuote(payload.quote, payload.items ?? []);
}
