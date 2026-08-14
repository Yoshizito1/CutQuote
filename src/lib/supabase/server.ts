import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigured } from './config';
import type { Database } from './database.types';

/**
 * Cliente para Server Components, Route Handlers e Server Actions.
 *
 * No Next 16 `cookies()` é assíncrono — acesso síncrono foi removido de vez na
 * versão 16, então esta função precisa ser await-ada.
 *
 * O `setAll` é envolvido em try/catch porque Server Components não podem
 * escrever cookies. Nesses casos a renovação de sessão fica a cargo do proxy,
 * que roda antes e tem permissão de escrita.
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient<Database> | null> {
  if (!supabaseConfigured) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component: escrita de cookie não é permitida aqui.
          // O proxy já renovou a sessão nesta requisição.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string | null;
  fullName: string | null;
  company: string | null;
  isAdmin: boolean;
}

/**
 * Usuário da requisição atual, com o papel resolvido.
 *
 * Usa `getUser()` e não `getSession()`: getSession lê o JWT do cookie sem
 * validar contra o servidor de auth, então não serve para decidir permissão.
 * O papel vem da tabela profiles, nunca de metadado do token — metadado é
 * editável pelo próprio usuário em algumas configurações.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, company, role')
    .eq('id', user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? null,
    company: profile?.company ?? null,
    isAdmin: profile?.role === 'admin',
  };
}
