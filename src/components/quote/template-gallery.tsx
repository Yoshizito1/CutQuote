'use client';

import { useMemo, useState } from 'react';

import { TEMPLATES, buildTemplateGeometry, defaultValues, templateCategories } from '@/lib/templates';
import type { PartTemplate } from '@/lib/templates';
import { PartCanvas } from './part-canvas';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Galeria de templates.
 *
 * As miniaturas são a geometria real gerada nos valores padrão, renderizada
 * pelo mesmo componente do orçamento — não há imagem estática que possa
 * divergir do que o template produz de fato.
 */
export function TemplateGallery({ onPick }: { onPick: (template: PartTemplate) => void }) {
  const [category, setCategory] = useState<string | null>(null);
  const categories = templateCategories();

  const previews = useMemo(
    () =>
      TEMPLATES.map((template) => ({
        template,
        built: buildTemplateGeometry(template, defaultValues(template)),
      })),
    [],
  );

  const visible = category
    ? previews.filter((item) => item.template.category === category)
    : previews;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <CategoryChip active={category === null} onClick={() => setCategory(null)}>
          Todos
        </CategoryChip>
        {categories.map((item) => (
          <CategoryChip key={item} active={category === item} onClick={() => setCategory(item)}>
            {item}
          </CategoryChip>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ template, built }) => (
          <li key={template.id}>
            <button
              type="button"
              onClick={() => onPick(template)}
              className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/60"
            >
              <div className="aspect-[4/3] w-full border-b border-border bg-background p-3">
                {built.geometry && (
                  <PartCanvas geometry={built.geometry} showDimensions={false} />
                )}
              </div>

              <div className="flex flex-1 flex-col p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{template.name}</h3>
                  <Badge>{template.category}</Badge>
                </div>
                <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                  {template.description}
                </p>

                {built.geometry && (
                  <p className="tabular mt-2 text-xs text-muted-foreground">
                    {built.geometry.bbox.width.toFixed(0)} × {built.geometry.bbox.height.toFixed(0)} mm ·{' '}
                    {built.geometry.holeCount} recorte(s)
                    {built.geometry.bendLines.length > 0 &&
                      ` · ${built.geometry.bendLines.length} dobra(s)`}
                  </p>
                )}

                <span className="mt-2 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Configurar medidas →
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
