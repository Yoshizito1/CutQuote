'use client';

import { useCatalog } from '@/components/catalog-provider';
import { findMaterial } from '@/lib/quote/catalog';
import { formatCurrency } from '@/lib/quote/pricing';
import type { PartQuote } from '@/lib/quote/types';
import { PartCanvas } from '@/components/quote/part-canvas';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export interface PartListEntry {
  id: string;
  filename: string;
  quote: PartQuote;
  origin: 'arquivo' | 'template';
}

export function PartList({
  entries,
  selectedId,
  onSelect,
  onRemove,
}: {
  entries: readonly PartListEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { catalog } = useCatalog();
  const money = (value: number): string => formatCurrency(value, catalog);

  return (
    <ul className="divide-y divide-border">
      {entries.map(({ id, filename, quote, origin }) => {
        const material = findMaterial(quote.config.materialId, catalog);
        const blocked = !quote.ok;
        const selected = id === selectedId;

        return (
          <li key={id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(id);
                }
              }}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition-colors',
                selected ? 'bg-primary/10' : 'hover:bg-muted/60',
              )}
            >
              <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border bg-background">
                <PartCanvas geometry={quote.geometry} showDimensions={false} />
              </div>

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate" title={filename}>
                    {filename}
                  </span>
                  {origin === 'template' && (
                    <span
                      className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                      title="Peça gerada por template paramétrico"
                    >
                      tpl
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {material?.name} · {quote.config.thicknessMm} mm · {quote.config.quantity} pç
                </p>
              </div>

              <div className="shrink-0 text-right">
                {blocked ? (
                  <Badge tone="danger">Bloqueado</Badge>
                ) : (
                  <>
                    <p className="tabular text-sm font-semibold">{money(quote.totalPrice)}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {money(quote.unitPrice)}/pç
                    </p>
                  </>
                )}
              </div>

              <button
                type="button"
                aria-label={`Remover ${filename}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(id);
                }}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
