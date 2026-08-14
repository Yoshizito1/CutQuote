'use client';

import { useMemo, useState } from 'react';

import { useCatalog } from '@/components/catalog-provider';
import type { PartGeometry } from '@/lib/geometry';
import { findMaterial } from '@/lib/quote/catalog';
import { formatCurrency, formatNumber, quotePart } from '@/lib/quote/pricing';
import type { PartConfig } from '@/lib/quote/types';
import {
  buildTemplateGeometry,
  clampParam,
  defaultValues,
  downloadDxf,
  suggestFilename,
  type ParamValues,
  type PartTemplate,
  type TemplateParam,
} from '@/lib/templates';
import { CanvasLegend, PartCanvas } from './part-canvas';
import { Badge, Card, CardHeader, Field, NumberInput, Select, Stat } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface TemplateConfiguratorProps {
  template: PartTemplate;
  /** Configuração de material herdada do orçamento em andamento. */
  baseConfig: PartConfig;
  onBack: () => void;
  onAdd: (payload: {
    geometry: PartGeometry;
    filename: string;
    suggestedThicknessMm?: number;
  }) => void;
}

/**
 * Configurador de template.
 *
 * O preço aparece ao lado dos campos e recalcula a cada alteração: o objetivo
 * é o usuário enxergar imediatamente qual medida está custando caro (quase
 * sempre é o número de furos, não o tamanho da peça).
 */
export function TemplateConfigurator({
  template,
  baseConfig,
  onBack,
  onAdd,
}: TemplateConfiguratorProps) {
  const { catalog } = useCatalog();
  const [values, setValues] = useState<ParamValues>(() => defaultValues(template));

  const built = useMemo(() => buildTemplateGeometry(template, values), [template, values]);

  const config: PartConfig = useMemo(
    () => ({
      ...baseConfig,
      thicknessMm: built.suggestedThicknessMm ?? baseConfig.thicknessMm,
    }),
    [baseConfig, built.suggestedThicknessMm],
  );

  const quote = useMemo(
    () => (built.geometry ? quotePart(built.geometry, config, catalog) : null),
    [built.geometry, config, catalog],
  );

  const material = findMaterial(config.materialId, catalog);

  const setValue = (param: TemplateParam, raw: number): void => {
    setValues((current) => ({ ...current, [param.id]: clampParam(param, raw) }));
  };

  // Agrupa os campos nas seções declaradas no template.
  const groups = useMemo(() => {
    const map = new Map<string, TemplateParam[]>();
    for (const param of template.params) {
      const key = param.group ?? 'Medidas';
      const bucket = map.get(key);
      if (bucket) bucket.push(param);
      else map.set(key, [param]);
    }
    return [...map.entries()];
  }, [template]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          ← Templates
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{template.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{template.description}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Parâmetros */}
        <Card className="h-fit">
          <CardHeader title="Medidas" hint="Os limites impedem geometria impossível" />
          <div className="space-y-5 p-4">
            {groups.map(([group, params]) => (
              <fieldset key={group}>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </legend>
                <div className="space-y-3">
                  {params
                    .filter((param) => !param.visibleWhen || param.visibleWhen(values))
                    .map((param) => (
                      <ParamField
                        key={param.id}
                        param={param}
                        value={values[param.id]}
                        onChange={(next) => setValue(param, next)}
                      />
                    ))}
                </div>
              </fieldset>
            ))}

            <button
              type="button"
              onClick={() => setValues(defaultValues(template))}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              Restaurar valores padrão
            </button>
          </div>
        </Card>

        {/* Preview + preço */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader
              title="Pré-visualização"
              hint={
                built.geometry
                  ? `${formatNumber(built.geometry.bbox.width)} × ${formatNumber(built.geometry.bbox.height)} mm`
                  : 'Ajuste as medidas para gerar a peça'
              }
              action={
                built.geometry ? (
                  <Badge tone="success">Geometria válida</Badge>
                ) : (
                  <Badge tone="danger">Inviável</Badge>
                )
              }
            />

            <div className="aspect-[16/9] w-full bg-background p-4">
              {built.geometry ? (
                <PartCanvas geometry={built.geometry} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="max-w-sm text-center text-sm text-muted-foreground">
                    As medidas atuais não produzem uma peça fabricável.
                  </p>
                </div>
              )}
            </div>

            {built.geometry && (
              <div className="border-t border-border px-4 py-3">
                <CanvasLegend geometry={built.geometry} />
              </div>
            )}
          </Card>

          {built.errors.length > 0 && (
            <ul className="space-y-2">
              {built.errors.map((error) => (
                <li
                  key={error}
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
                >
                  {error}
                </li>
              ))}
            </ul>
          )}

          {built.notes.length > 0 && (
            <ul className="space-y-1.5">
              {built.notes.map((note) => (
                <li
                  key={note}
                  className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
                >
                  {note}
                </li>
              ))}
            </ul>
          )}

          {built.geometry && quote && (
            <Card>
              <CardHeader
                title="Prévia de preço"
                hint={`${material?.name} · ${config.thicknessMm} mm · ${config.quantity} pç`}
                action={
                  quote.ok ? (
                    <span className="tabular text-lg font-semibold">
                      {formatCurrency(quote.unitPrice, catalog)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">/pç</span>
                    </span>
                  ) : (
                    <Badge tone="danger">Bloqueado</Badge>
                  )
                }
              />

              <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                <Stat
                  label="Corte"
                  value={`${formatNumber(built.geometry.cutLength / 1000, 3)} m`}
                />
                <Stat label="Perfurações" value={built.geometry.pierces} />
                <Stat
                  label="Área"
                  value={`${formatNumber(built.geometry.netArea / 100, 1)} cm²`}
                />
                <Stat label="Massa un." value={`${formatNumber(quote.unitMassKg, 3)} kg`} />
              </dl>

              {!quote.ok && (
                <ul className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  {quote.issues
                    .filter((issue) => issue.severity === 'bloqueio')
                    .map((issue) => (
                      <li key={issue.id}>
                        <span className="font-medium text-destructive">{issue.title}</span> —{' '}
                        {issue.fix ?? issue.detail}
                      </li>
                    ))}
                </ul>
              )}

              <div className="flex flex-wrap gap-2 border-t border-border p-4">
                <button
                  type="button"
                  disabled={!quote.ok}
                  onClick={() =>
                    built.geometry &&
                    onAdd({
                      geometry: built.geometry,
                      filename: suggestFilename(template, built.geometry),
                      suggestedThicknessMm: built.suggestedThicknessMm,
                    })
                  }
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Adicionar ao orçamento
                </button>
                <button
                  type="button"
                  onClick={() =>
                    built.geometry &&
                    downloadDxf(built.polylines, suggestFilename(template, built.geometry))
                  }
                  className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Baixar DXF
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: TemplateParam;
  value: number;
  onChange: (value: number) => void;
}) {
  if (param.type === 'boolean') {
    return (
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={value === 1}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="min-w-0">
          <span className="block text-sm">{param.label}</span>
          {param.hint && (
            <span className="block text-xs text-muted-foreground">{param.hint}</span>
          )}
        </span>
      </label>
    );
  }

  if (param.type === 'select' && param.options) {
    return (
      <Field label={param.label} hint={param.hint}>
        <Select value={value} onChange={(event) => onChange(Number(event.target.value))}>
          {param.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <Field
      label={param.unit ? `${param.label} (${param.unit})` : param.label}
      hint={param.hint}
    >
      <div className="flex items-center gap-2">
        <NumberInput
          value={value}
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          onChange={(event) => onChange(Number(event.target.value))}
          className="flex-1"
        />
        {param.min !== undefined && param.max !== undefined && (
          <input
            type="range"
            value={value}
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-label={`${param.label} (deslizante)`}
            className={cn('h-1.5 flex-1 cursor-pointer accent-[var(--primary)]')}
          />
        )}
      </div>
    </Field>
  );
}
