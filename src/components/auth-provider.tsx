'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { SessionUser } from '@/lib/supabase/server';

export interface AuthContextValue {
  user: SessionUser | null;
  /** false quando o Supabase não está configurado — a app roda em modo local. */
  enabled: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  enabled: false,
  loading: false,
  signOut: async () => {},
});

/**
 * Estado de sessão no cliente.
 *
 * O usuário inicial vem resolvido do servidor (`initialUser`), então não há
 * salto visual entre "deslogado" e "logado" no primeiro render. O listener
 * existe para reagir a logout em outra aba e à expiração do token.
 */
export function AuthProvider({
  initialUser,
  enabled,
  children,
}: {
  initialUser: SessionUser | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // Só o logout é tratado localmente. Login e refresh disparam navegação,
      // e o servidor devolve o perfil completo (inclusive o papel de admin),
      // que não dá para deduzir só do evento de auth.
      if (event === 'SIGNED_OUT') setUser(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setLoading(false);
    // Recarrega para o servidor reavaliar sessão, catálogo e rotas protegidas.
    window.location.assign('/');
  }, []);

  const value = useMemo(
    () => ({ user, enabled, loading, signOut }),
    [user, enabled, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
