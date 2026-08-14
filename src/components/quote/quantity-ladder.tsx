'use client';

import { useCatalog } from '@/components/catalog-provider';
import type { PartGeometry } from '@/lib/geometry';
import { QUANTITY_LADDER } from '@/lib/quote/catalog';
import { formatCurrency, quantityLadder } from '@/lib/quote/pricing';
import type { PartConfig } from '@/lib/quote/types';
import { cn } from '@/lib/utils';

/**
 * Tabela de faixas: o mesmo desenho cotado em várias quantidades.
 *
 * Serve para o cliente enxergar onde está o degrau de economia antes de fechar
 * o pedido — quase sempre a maior queda está entre 1 e 10 peças, porque é onde
 * o setup deixa de dominar o preço.
 */
export function QuantityLadder({
  geometry,
  config,
  onSelect,
}: {
  geometry: PartGeometry;
  config: PartConfig;
  onSelect: (quantity: number) => void;
}) {
  const { catalog } = useCatalog();
  const money = (value: number): string => formatCurrency(value, catalog);

  const rows = quantityLadder(geometry, config, QUANTITY_LADDER, catalog);
  if (rows.length === 0) return null;

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Qtd.</th>
            <th className="pb-2 text-right font-medium">Unitário</th>
            <th className="pb-2 text-right font-medium">Total</th>
            <th className="pb-2 text-right font-medium">Economia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const active = row.quantity === config.quantity;
            return (
              <tr
                key={row.quantity}
                onClick={() => onSelect(row.quantity)}
                className={cn(
                  'cursor-pointer border-b border-border/60 transition-colors last:border-0',
                  active ? 'bg-primary/10' : 'hover:bg-muted/60',
                )}
              >
                <td className={cn('tabular py-2', active && 'font-semibold text-primary')}>
                  {row.quantity}
                </td>
                <td className={cn('tabular py-2 text-right', active && 'font-semibold')}>
                  {money(row.unitPrice)}
                </td>
                <td className="tabular py-2 text-right text-muted-foreground">
                  {money(row.totalPrice)}
                </td>
                <td className="tabular py-2 text-right">
                  {row.savingsPercent > 0.5 ? (
                    <span className="text-success">−{row.savingsPercent.toFixed(0)}%</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Clique em uma linha para aplicar a quantidade.
      </p>
    </div>
  );
}
