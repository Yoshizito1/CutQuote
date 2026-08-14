import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { AuthProvider } from '@/components/auth-provider';
import { CatalogProvider } from '@/components/catalog-provider';
import { SiteHeader } from '@/components/site-header';
import { loadPublishedCatalog } from '@/lib/quote/catalog-repository';
import { supabaseConfigured } from '@/lib/supabase/config';
import { getSessionUser, getSupabaseServerClient } from '@/lib/supabase/server';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CutQuote — Orçamento instantâneo de corte a laser',
  description:
    'Envie um DXF ou SVG e receba na hora o preço de corte a laser, jato d’água e router CNC, com a memória de cálculo aberta e as restrições de fabricação verificadas.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Catálogo e sessão são resolvidos no servidor para que a primeira
  // renderização já saia com os preços certos e o usuário correto.
  const supabase = await getSupabaseServerClient();
  const [catalogResult, user] = await Promise.all([
    loadPublishedCatalog(supabase),
    getSessionUser(),
  ]);

  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background">
        <AuthProvider initialUser={user} enabled={supabaseConfigured}>
          <CatalogProvider value={catalogResult}>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-border px-4 py-6">
              <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <p>
                  Os valores do catálogo são parâmetros de exemplo e precisam ser calibrados com os
                  custos reais da operação antes de qualquer uso comercial.
                </p>
                <p className="tabular">
                  Catálogo: {catalogResult.catalog.label}
                  {!catalogResult.fromDatabase && ' (embutido no código)'}
                </p>
              </div>
            </footer>
          </CatalogProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
