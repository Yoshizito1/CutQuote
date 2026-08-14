'use client';

import { useState } from 'react';

import { findMaterial } from '@/lib/quote/catalog';
import { formatCurrency, formatNumber } from '@/lib/quote/pricing';
import { setQuoteShared, type SavedQuote } from '@/lib/quote/persistence';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { PartCanvas } from './part-canvas';
import { DfmPanel } from './dfm-panel';
import { Badge, Card, CardHeader, Stat } from '@/components/ui/primitives';

/**
 * Visualização de um orçamento salvo.
 *
 * Todos os valores vêm do registro, e a formatação usa o catálogo CONGELADO no
 * orçamento — não o catálogo ativo. É isso que faz uma proposta antiga
 * continuar exibindo os preços com que foi enviada.
 */
export function SavedQuoteView({ quote }: { quote: SavedQuote }) {
  const catalog = quote.catalog;
  const money = (value: number): string => formatCurrency(value, catalog);

  const [shared, setShared] = useState(quote.shared);
  const [shareUrl, setShareUrl] = useState<string | null>(
    quote.shared && quote.shareToken ? buildShareUrl(quote.shareToken) : null,
  );
  const [busy, setBusy] = useState(false);

  const toggleShare = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusy(true);
    try {
      const token = await setQuoteShared(supabase, quote.id, !shared);
      setShared(!shared);
      setShareUrl(token ? buildShareUrl(token) : null);
    } finally {
      setBusy(false);
    }
  };

  const expired = new Date(quote.expiresAt) < new Date();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="tabular text-2xl font-semibold tracking-tight">{quote.reference}</h1>
            <Badge tone={expired ? 'warning' : 'neutral'}>{quote.status}</Badge>
            {expired && <Badge tone="warning">vencido</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {quote.title ?? 'Sem título'} · salvo em{' '}
            {new Date(quote.createdAt).toLocaleDateString('pt-BR')} · válido até{' '}
            {new Date(quote.expiresAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <a
          href="/orcamentos"
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          ← Todos
        </a>
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Resumo"
          hint={`Preços do catálogo "${catalog.label}", congelados neste orçamento`}
          action={<span className="tabular text-xl font-semibold">{money(quote.total)}</span>}
        />
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Itens" value={quote.items.length} />
          <Stat
            label="Peças"
            value={quote.items.reduce((sum, item) => sum + item.config.quantity, 0)}
          />
          <Stat label="Prazo" value={`${quote.leadDays} dias úteis`} />
          <Stat label="Moeda" value={quote.currency} />
        </dl>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Compartilhar"
          hint="Gera um link público de leitura, sem exigir conta de quem recebe"
          action={
            <button
              type="button"
              onClick={toggleShare}
              disabled={busy}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy ? '…' : shared ? 'Desativar link' : 'Gerar link'}
            </button>
          }
        />
        {shared && shareUrl && (
          <div className="p-4">
            <input
              readOnly
              value={shareUrl}
              onFocus={(event) => event.target.select()}
              className="w-full rounded-lg border border-input bg-muted/40 px-3 py-2 font-mono text-xs"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Qualquer pessoa com o link enxerga este orçamento até{' '}
              {new Date(quote.expiresAt).toLocaleDateString('pt-BR')}. Desativar invalida o link
              imediatamente.
            </p>
          </div>
        )}
      </Card>

      <ul className="space-y-4">
        {quote.items.map((item) => {
          const material = findMaterial(item.config.materialId, catalog);
          return (
            <li key={item.id}>
              <Card className="overflow-hidden">
                <CardHeader
                  title={item.filename}
                  hint={`${material?.name ?? item.config.materialId} · ${item.config.thicknessMm} mm · ${item.config.quantity} pç`}
                  action={
                    <div className="text-right">
                      <p className="tabular text-base font-semibold">{money(item.totalPrice)}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {money(item.unitPrice)}/pç
                      </p>
                    </div>
                  }
                />

                <div className="grid gap-4 p-4 md:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="aspect-square rounded-lg border border-border bg-background p-3">
                    {item.geometry ? (
                      <PartCanvas geometry={item.geometry} showDimensions={false} />
                    ) : (
                      <div className="flex h-full items-center justify-center px-2 text-center">
                        <p className="text-xs text-muted-foreground">
                          Desenho não armazenado (grande demais). Os valores e as medidas seguem
                          registrados.
                        </p>
                      </div>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Stat
                      label="Dimensões"
                      value={`${formatNumber(item.summary.bbox.width, 1, catalog)} × ${formatNumber(item.summary.bbox.height, 1, catalog)} mm`}
                    />
                    <Stat
                      label="Corte"
                      value={`${formatNumber(item.summary.cutLength / 1000, 3, catalog)} m`}
                    />
                    <Stat label="Perfurações" value={item.summary.pierces} />
                    <Stat label="Recortes" value={item.summary.holeCount} />
                    <Stat label="Dobras" value={item.summary.bendCount} />
                    <Stat label="Prazo" value={`${item.leadDays} dias`} />
                  </dl>
                </div>

                {item.priceLines.length > 0 && (
                  <div className="border-t border-border">
                    <table className="w-full text-sm">
                      <tbody>
                        {item.priceLines.map((line) => {
                          const setupPerUnit = line.setupAmount / item.config.quantity;
                          const total = line.unitAmount + setupPerUnit;
                          if (total < 0.005) return null;
                          return (
                            <tr key={line.id} className="border-b border-border/60 last:border-0">
                              <td className="px-4 py-2">{line.label}</td>
                              <td className="tabular px-4 py-2 text-right text-muted-foreground">
                                {money(total)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {item.issues.length > 0 && (
                  <div className="border-t border-border">
                    <DfmPanel issues={item.issues} />
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function buildShareUrl(token: string): string {
  if (typeof window === 'undefined') return `/orcamento/${token}`;
  return `${window.location.origin}/orcamento/${token}`;
}
