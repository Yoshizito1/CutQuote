import { redirect } from 'next/navigation';

import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { listQuotes } from '@/lib/quote/persistence';
import { getSessionUser, getSupabaseServerClient } from '@/lib/supabase/server';

export const metadata = { title: 'Meus orçamentos — BELLARI' };

const STATUS_TONE = {
  rascunho: 'neutral',
  enviado: 'accent',
  aceito: 'success',
  recusado: 'danger',
  expirado: 'warning',
} as const;

export default async function OrcamentosPage() {
  const user = await getSessionUser();
  if (!user) redirect('/entrar');

  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect('/');

  const quotes = await listQuotes(supabase);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meus orçamentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada orçamento guarda os preços da data em que foi salvo.
          </p>
        </div>
        <a
          href="/"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Novo orçamento
        </a>
      </div>

      {quotes.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum orçamento salvo ainda. Monte um na tela inicial e clique em{' '}
            <strong className="font-medium text-foreground">Salvar orçamento</strong>.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader title={`${quotes.length} orçamento(s)`} />
          <ul className="divide-y divide-border">
            {quotes.map((quote) => {
              const expired = new Date(quote.expiresAt) < new Date();
              return (
                <li key={quote.id}>
                  <a
                    href={`/orcamentos/${quote.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="tabular">{quote.reference}</span>
                        <Badge tone={STATUS_TONE[quote.status]}>{quote.status}</Badge>
                        {expired && <Badge tone="warning">vencido</Badge>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {quote.title ?? 'Sem título'} · {quote.itemCount} item(ns) ·{' '}
                        {new Date(quote.createdAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-semibold">
                      {new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: quote.currency,
                      }).format(quote.total)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
