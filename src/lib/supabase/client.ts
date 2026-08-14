'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigured } from './config';
import type { Database } from './database.types';

let cached: SupabaseClient<Database> | null = null;

/**
 * Cliente do navegador, em instância única.
 *
 * `createBrowserClient` guarda a sessão em cookie (e não em localStorage), que
 * é o que permite o servidor enxergar o usuário logado ao renderizar.
 *
 * Devolve null quando não há credenciais — o chamador decide se degrada ou
 * avisa, em vez de estourar no import.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> | null {
  if (!supabaseConfigured) return null;
  if (cached) return cached;

  cached = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return cached;
}
