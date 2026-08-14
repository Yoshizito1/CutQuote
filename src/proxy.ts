import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigured } from '@/lib/supabase/config';

/**
 * Renovação de sessão.
 *
 * No Next 16 o arquivo `middleware` foi renomeado para `proxy`, e a função
 * exportada precisa se chamar `proxy`. O runtime é sempre Node.
 *
 * O papel dele aqui é um só: refazer o cookie de sessão antes de qualquer
 * Server Component rodar. Server Components não conseguem escrever cookies,
 * então sem este passo a sessão expiraria e o usuário seria deslogado sozinho.
 *
 * Autorização NÃO é feita aqui — fica no RLS e nas próprias páginas. Proxy é
 * um lugar frágil para decidir permissão, porque qualquer rota nova que escape
 * do matcher passaria direto.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!supabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() valida o token contra o servidor de auth e dispara a renovação.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Tudo, menos estáticos e imagens — não faz sentido gastar uma validação
     * de sessão para servir um favicon.
     */
    '/((?!_next/static|_next/image|favicon.ico|exemplos|.*\\.(?:svg|png|jpg|jpeg|gif|webp|dxf)$).*)',
  ],
};
