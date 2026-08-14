import { notFound } from 'next/navigation';

import { findMaterial } from '@/lib/quote/catalog';
import { loadSharedQuote } from '@/lib/quote/persistence';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { Badge, Card, CardHeader, Stat } from '@/components/ui/primitives';

export const metadata = { title: 'Orçamento compartilhado — CutQuote' };

/**
 * Página pública de um orçamento compartilhado.
 *
 * Não exige conta. O acesso passa pela função `get_shared_quote`, que só
 * devolve o registro se o compartilhamento estiver ligado e dentro da validade
 * — e nunca expõe `user_id` nem o próprio token.
 */
export default async function OrcamentoCompartilhadoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await getSupabaseServerClient();
  if (!supabase) notFound();

  const quote = await loadSharedQuote(supabase, token);
  if (!quote) notFound();

  const catalog = quote.catalog;
  const money = (value: number): string =>
    new Intl.NumberFormat(catalog.orderConfig.locale, {
      style: 'currency',
      currency: quote.currency,
    }).format(value);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="tabular text-2xl font-semibold tracking-tight">{quote.reference}</h1>
          <Badge>{quote.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {quote.title ?? 'Orçamento'} · válido até{' '}
          {new Date(quote.expiresAt).toLocaleDateString('pt-BR')}
        </p>
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Total"
          hint={`${quote.items.length} item(ns) · ${quote.leadDays} dias úteis`}
          action={<span className="tabular text-xl font-semibold">{money(quote.total)}</span>}
        />
      </Card>

      <ul className="space-y-3">
        {quote.items.map((item) => {
          const material = findMaterial(item.config.materialId, catalog);
          return (
            <li key={item.id}>
              <Card>
                <CardHeader
                  title={item.filename}
                  hint={`${material?.name ?? item.config.materialId} · ${item.config.thicknessMm} mm`}
                  action={
                    <div className="text-right">
                      <p className="tabular text-sm font-semibold">{money(item.totalPrice)}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {item.config.quantity} × {money(item.unitPrice)}
                      </p>
                    </div>
                  }
                />
                <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                  <Stat
                    label="Dimensões"
                    value={`${item.summary.bbox.width.toFixed(0)} × ${item.summary.bbox.height.toFixed(0)} mm`}
                  />
                  <Stat label="Corte" value={`${(item.summary.cutLength / 1000).toFixed(2)} m`} />
                  <Stat label="Perfurações" value={item.summary.pierces} />
                  <Stat label="Prazo" value={`${item.leadDays} dias`} />
                </dl>
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Valores congelados na data do orçamento. Impostos e frete não inclusos.
      </p>
    </div>
  );
}
