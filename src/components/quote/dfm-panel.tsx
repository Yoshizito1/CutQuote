'use client';

import type { DfmIssue, IssueSeverity } from '@/lib/quote/types';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const SEVERITY_STYLE: Record<
  IssueSeverity,
  { tone: 'danger' | 'warning' | 'neutral'; label: string; border: string; icon: string }
> = {
  bloqueio: {
    tone: 'danger',
    label: 'Bloqueio',
    border: 'border-l-destructive',
    icon: 'M12 8v5m0 3h.01M10.3 3.9 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  },
  atencao: {
    tone: 'warning',
    label: 'Atenção',
    border: 'border-l-warning',
    icon: 'M12 8v5m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  },
  info: {
    tone: 'neutral',
    label: 'Nota',
    border: 'border-l-border',
    icon: 'M12 16v-5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  },
};

/**
 * Painel de manufaturabilidade.
 *
 * A ordem importa: bloqueios primeiro, porque são os únicos que impedem o
 * pedido de seguir. Cada item traz a ação corretiva — apontar o problema sem
 * dizer o que fazer só transfere o trabalho para o cliente.
 */
export function DfmPanel({ issues }: { issues: readonly DfmIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm">
        <Badge tone="success">Aprovado</Badge>
        <span className="text-muted-foreground">
          Nenhuma restrição de fabricação encontrada para esta configuração.
        </span>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {issues.map((issue) => {
        const style = SEVERITY_STYLE[issue.severity];
        return (
          <li key={issue.id} className={cn('border-l-2 px-4 py-3', style.border)}>
            <div className="flex items-start gap-2.5">
              <svg
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  issue.severity === 'bloqueio' && 'text-destructive',
                  issue.severity === 'atencao' && 'text-warning',
                  issue.severity === 'info' && 'text-muted-foreground',
                )}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={style.icon} />
              </svg>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-medium">{issue.title}</h4>
                  <Badge tone={style.tone}>{style.label}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{issue.detail}</p>
                {issue.fix && (
                  <p className="mt-1.5 text-xs leading-relaxed">
                    <span className="font-medium">Como resolver: </span>
                    <span className="text-muted-foreground">{issue.fix}</span>
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
