'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { STATIC_CATALOG, type Catalog } from '@/lib/quote/catalog';

export interface CatalogContextValue {
  catalog: Catalog;
  /** false quando a aplicação está usando o catálogo embutido no código. */
  fromDatabase: boolean;
  /** Motivo do fallback, quando houver. Exibido ao admin. */
  reason?: string;
}

const CatalogContext = createContext<CatalogContextValue>({
  catalog: STATIC_CATALOG,
  fromDatabase: false,
});

/**
 * Disponibiliza o catálogo ativo para toda a árvore.
 *
 * O catálogo é resolvido no servidor e desce como valor inicial, para que a
 * primeira renderização já saia com os preços certos — sem piscar valores do
 * catálogo estático antes de trocar pelos do banco.
 */
export function CatalogProvider({
  value,
  children,
}: {
  value: CatalogContextValue;
  children: ReactNode;
}) {
  const memo = useMemo(() => value, [value]);
  return <CatalogContext.Provider value={memo}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  return useContext(CatalogContext);
}
