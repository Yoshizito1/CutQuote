'use client';

import { useCatalog } from '@/components/catalog-provider';
import { estimateDeliveryDate, formatCurrency } from '@/lib/quote/pricing';
import type { PartQuote } from '@/lib/quote/types';
import { Badge } from '@/components/ui/primitives';

/**
 * Memória de cálculo aberta.
 *
 * Cada linha mostra a parcela variável (por peça) e a parcela de setup já
 * rateada pela quantidade — é isso que explica, sem mágica, por que o unitário
 * cai quando o lote cresce.
 */
export function PriceBreakdown({ quote }: { quote: PartQuote }) {
  const { catalog } = useCatalog();
  const order = catalog.orderConfig;
  const money = (value: number): string => formatCurrency(value, catalog);

  if (!quote.ok) return null;

  const quantity = quote.config.quantity;
  const delivery = estimateDeliveryDate(quote.leadDays);

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Componente</th>
            <th className="pb-2 text-right font-medium">Variável</th>
            <th className="pb-2 text-right font-medium">Setup / {quantity}</th>
            <th className="pb-2 text-right font-medium">Total un.</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => {
            const setupPerUnit = line.setupAmount / quantity;
            const total = line.unitAmount * quote.volumeFactor + setupPerUnit;
            if (total < 0.005) return null;

            return (
              <tr key={line.id} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium">{line.label}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {line.detail}
                  </div>
                </td>
                <td className="tabular py-2 text-right text-muted-foreground">
                  {line.unitAmount > 0 ? money(line.unitAmount * quote.volumeFactor) : '—'}
                </td>
                <td className="tabular py-2 text-right text-muted-foreground">
                  {setupPerUnit > 0 ? money(setupPerUnit) : '—'}
                </td>
                <td className="tabular py-2 pl-3 text-right font-medium">{money(total)}</td>
              </tr>
            );
          })}

          <tr className="border-b border-border/60">
            <td className="py-2 pr-3">
              <div className="font-medium">Taxa de pedido</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Embalagem, emissão e expedição, rateados
              </div>
            </td>
            <td className="py-2 text-right text-muted-foreground">—</td>
            <td className="tabular py-2 text-right text-muted-foreground">
              {money(order.orderHandlingFee / quantity)}
            </td>
            <td className="tabular py-2 pl-3 text-right font-medium">
              {money(order.orderHandlingFee / quantity)}
            </td>
          </tr>
        </tbody>

        <tfoot>
          <tr className="border-b border-border/60 text-muted-foreground">
            <td className="py-2" colSpan={3}>
              Custo direto por peça
            </td>
            <td className="tabular py-2 text-right">{money(quote.unitCost)}</td>
          </tr>
          <tr className="border-b border-border/60 text-muted-foreground">
            <td className="py-2" colSpan={3}>
              Margem ({(order.marginRate * 100).toFixed(0)}%)
            </td>
            <td className="tabular py-2 text-right">
              {money(quote.unitCost * order.marginRate)}
            </td>
          </tr>

          {quote.minimumAdjustment > 0 && (
            <tr className="border-b border-border/60 text-warning">
              <td className="py-2" colSpan={3}>
                Complemento de pedido mínimo ({money(order.minimumOrderValue)})
              </td>
              <td className="tabular py-2 text-right">
                {money(quote.minimumAdjustment / quantity)}
              </td>
            </tr>
          )}

          <tr className="text-base font-semibold">
            <td className="pt-3" colSpan={3}>
              Preço unitário
            </td>
            <td className="tabular pt-3 text-right">{money(quote.unitPrice)}</td>
          </tr>
          <tr>
            <td className="pt-1 text-sm text-muted-foreground" colSpan={3}>
              Total de {quantity} peça(s)
            </td>
            <td className="tabular pt-1 text-right text-sm font-medium">
              {money(quote.totalPrice)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Badge tone={quote.leadDays <= order.maxInstantLeadDays ? 'success' : 'warning'}>
          {quote.leadDays} dias úteis
        </Badge>
        <span className="text-xs text-muted-foreground">
          Entrega estimada em{' '}
          {delivery.toLocaleDateString(order.locale, { day: '2-digit', month: 'long' })}
        </span>
        {quote.volumeFactor < 1 && (
          <Badge tone="accent">
            Eficiência de lote: −{((1 - quote.volumeFactor) * 100).toFixed(0)}% no variável
          </Badge>
        )}
      </div>
    </div>
  );
}
