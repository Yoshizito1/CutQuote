'use client';

import { useAuth } from '@/components/auth-provider';
import { useCatalog } from '@/components/catalog-provider';
import { Badge } from '@/components/ui/primitives';

/** Barra superior. Sem navegação falsa: só o que a aplicação realmente faz. */
export function SiteHeader() {
  const { user, enabled, loading, signOut } = useAuth();
  const { fromDatabase } = useCatalog();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
        <a href="/" className="flex shrink-0 items-center gap-2.5">
          <span
            className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
            aria-hidden
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 20 20 4" strokeLinecap="round" />
              <circle cx="6.5" cy="17.5" r="2.5" />
              <circle cx="17.5" cy="6.5" r="2.5" />
            </svg>
          </span>
          <span className="text-base font-semibold tracking-tight">CutQuote</span>
        </a>

        <nav className="hidden items-center gap-1 text-sm md:flex">
          <HeaderLink href="/">Orçar</HeaderLink>
          {user && <HeaderLink href="/orcamentos">Meus orçamentos</HeaderLink>}
          {user?.isAdmin && <HeaderLink href="/admin/catalogo">Catálogo</HeaderLink>}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user?.isAdmin && !fromDatabase && (
            <Badge tone="warning" className="hidden sm:inline-flex">
              Catálogo do código
            </Badge>
          )}

          {!enabled ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">Modo local</span>
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-right text-xs leading-tight sm:block">
                <span className="block font-medium">{user.fullName ?? user.email}</span>
                <span className="block text-muted-foreground">
                  {user.isAdmin ? 'Administrador' : (user.company ?? 'Cliente')}
                </span>
              </span>
              <button
                type="button"
                onClick={signOut}
                disabled={loading}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Sair
              </button>
            </div>
          ) : (
            <a
              href="/entrar"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Entrar
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </a>
  );
}
