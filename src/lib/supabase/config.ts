/**
 * Configuração de acesso ao Supabase.
 *
 * A chave publicável é feita para ir no bundle do cliente — quem protege os
 * dados é o RLS, não o segredo da chave. Por isso todo acesso do navegador
 * passa por policies, e nenhuma rota confia em dado vindo do cliente para
 * decidir permissão.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

/**
 * Quando não há credenciais, a aplicação continua funcionando por completo em
 * modo local: catálogo estático, orçamento em memória. Só o que depende de
 * conta e histórico fica indisponível. Isso mantém o app utilizável em
 * desenvolvimento e evita tela branca por variável de ambiente faltando.
 */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
