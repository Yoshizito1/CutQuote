/**
 * Tipos do banco, mantidos em sincronia com `supabase/migrations/`.
 *
 * Para regenerar a partir do banco real (exige login no Supabase CLI):
 *   npx supabase gen types typescript --project-id iklgnuqyhvkziagloqok \
 *     > src/lib/supabase/database.types.ts
 *
 * ATENÇÃO — as linhas são declaradas como `type`, não `interface`, de propósito.
 * O `GenericTable` do postgrest-js exige `Row extends Record<string, unknown>`,
 * e apenas type aliases recebem index signature implícito no TypeScript.
 * Trocar para `interface` faz toda a inferência do query builder colapsar em
 * `never`, com erros que não apontam para a causa.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ProfileRow = {
  id: string;
  full_name: string | null;
  company: string | null;
  role: 'cliente' | 'admin';
  created_at: string;
  updated_at: string;
};

export type CatalogVersionRow = {
  id: string;
  label: string;
  status: 'rascunho' | 'publicado' | 'arquivado';
  notes: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
};

export type ProcessRow = {
  id: string;
  version_id: string;
  code: string;
  name: string;
  machine_rate_per_hour: number;
  kerf: number;
  handling_seconds_per_part: number;
  base_lead_days: number;
  sheet_width: number;
  sheet_height: number;
  description: string | null;
};

export type MaterialRow = {
  id: string;
  version_id: string;
  code: string;
  name: string;
  family: string;
  process_code: string;
  density: number;
  price_per_kg: number;
  scrap_factor: number;
  tappable: boolean;
  notes: string | null;
  sort_order: number;
};

export type MaterialThicknessRow = {
  id: string;
  material_id: string;
  mm: number;
  label: string;
  cut_speed_m_per_min: number;
  pierce_seconds: number;
  min_hole_ratio: number;
  min_web_ratio: number;
  bendable: boolean;
  min_flange_ratio: number;
  bend_radius: number;
  available: boolean;
};

export type FinishRow = {
  id: string;
  version_id: string;
  code: string;
  name: string;
  price_per_m2: number;
  setup_cost: number;
  price_per_part: number;
  lead_days: number;
  description: string | null;
  sort_order: number;
};

export type MaterialFinishRow = {
  material_id: string;
  finish_code: string;
  sort_order: number;
};

export type QuantityBreakRow = {
  id: string;
  version_id: string;
  min_qty: number;
  variable_factor: number;
};

export type CatalogSettingsRow = {
  version_id: string;
  currency: string;
  locale: string;
  minimum_order_value: number;
  margin_rate: number;
  order_handling_fee: number;
  max_instant_lead_days: number;
  cut_setup_cost: number;
  services: Json;
};

export type QuoteRow = {
  id: string;
  user_id: string;
  reference: string;
  title: string | null;
  status: 'rascunho' | 'enviado' | 'aceito' | 'recusado' | 'expirado';
  catalog_version_id: string | null;
  catalog_snapshot: Json;
  currency: string;
  total: number;
  lead_days: number;
  notes: string | null;
  share_token: string | null;
  shared: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type QuoteItemRow = {
  id: string;
  quote_id: string;
  position: number;
  filename: string;
  origin: 'arquivo' | 'template';
  template_id: string | null;
  template_params: Json;
  geometry: Json;
  geometry_truncated: boolean;
  geometry_summary: Json;
  config: Json;
  unit_price: number;
  total_price: number;
  lead_days: number;
  price_breakdown: Json;
  created_at: string;
};

/** Insert/Update permissivos: as colunas com default são preenchidas pelo banco. */
type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      catalog_versions: Table<CatalogVersionRow>;
      processes: Table<ProcessRow>;
      materials: Table<MaterialRow>;
      material_thicknesses: Table<MaterialThicknessRow>;
      finishes: Table<FinishRow>;
      material_finishes: Table<MaterialFinishRow>;
      quantity_breaks: Table<QuantityBreakRow>;
      catalog_settings: Table<CatalogSettingsRow>;
      quotes: Table<QuoteRow>;
      quote_items: Table<QuoteItemRow>;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      publish_catalog_version: { Args: { target: string }; Returns: CatalogVersionRow };
      clone_catalog_version: { Args: { source: string; new_label: string }; Returns: string };
      get_shared_quote: { Args: { token: string }; Returns: Json };
      save_quote: { Args: { payload: Json; quote_id?: string | null }; Returns: QuoteRow };
      next_quote_reference: { Args: Record<string, never>; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
