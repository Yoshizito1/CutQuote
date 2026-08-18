'use client';

import type { BendAxis, BendConfig, FoldWarning } from '@/lib/geometry/fold';
import { Badge, Field, NumberInput, Select } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** Fatores K usuais por família de material. */
const K_PRESETS = [
  { value: 0.44, label: '0,44 — aço' },
  { value: 0.41, label: '0,41 — alumínio' },
  { value: 0.45, label: '0,45 — inox' },
  { value: 0.33, label: '0,33 — dobra fechada' },
];

const ANGLE_PRESETS = [30, 45, 60, 90, 120, 135];

export function FoldPanel({
  axes,
  configs,
  warnings,
  thickness,
  defaultRadius,
  onChange,
  onFlatten,
  flattened,
}: {
  axes: readonly BendAxis[];
  configs: readonly BendConfig[];
  warnings: readonly FoldWarning[];
  thickness: number;
  defaultRadius: number;
  onChange: (configs: BendConfig[]) => void;
  onFlatten: () => void;
  flattened: boolean;
}) {
  const patch = (axisId: string, partial: Partial<BendConfig>): void => {
    onChange(
      configs.map((config) => (config.axisId === axisId ? { ...config, ...partial } : config)),
    );
  };

  const usable = axes.filter((axis) => axis.problem === null);

  return (
    <div className="space-y-4 p-4">
      {axes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma linha de dobra encontrada. Desenhe os eixos num layer chamado{' '}
          <code className="rounded bg-muted px-1 py-0.5">DOBRA</code> e reenvie o arquivo.
        </p>
      )}

      {usable.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Espessura {thickness} mm · raio interno padrão {defaultRadius} mm
          </span>
          <button
            type="button"
            onClick={onFlatten}
            className={cn(
              'shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors',
              flattened ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {flattened ? 'Dobrar' : 'Planificar'}
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {axes.map((axis) => {
          const config = configs.find((candidate) => candidate.axisId === axis.id);
          const blocked = axis.problem !== null;

          return (
            <li
              key={axis.id}
              className={cn(
                'rounded-lg border p-3',
                blocked ? 'border-destructive/30 bg-destructive/5' : 'border-border',
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium capitalize">{axis.id.replace('-', ' ')}</span>
                {blocked ? (
                  <Badge tone="danger">Não dobrável</Badge>
                ) : (
                  <span className="tabular text-xs text-muted-foreground">
                    {axis.length.toFixed(0)} mm
                  </span>
                )}
              </div>

              {blocked ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{axis.problem}</p>
              ) : (
                config && (
                  <div className="space-y-3">
                    <Field label="Ângulo (°)">
                      <div className="flex items-center gap-2">
                        <NumberInput
                          min={0}
                          max={170}
                          step={1}
                          value={config.angleDeg}
                          onChange={(event) =>
                            patch(axis.id, {
                              angleDeg: Math.max(0, Math.min(170, Number(event.target.value) || 0)),
                            })
                          }
                          className="w-20"
                        />
                        <input
                          type="range"
                          min={0}
                          max={170}
                          step={1}
                          value={config.angleDeg}
                          onChange={(event) =>
                            patch(axis.id, { angleDeg: Number(event.target.value) })
                          }
                          aria-label={`Ângulo de ${axis.id}`}
                          className="h-1.5 flex-1 cursor-pointer accent-[var(--primary)]"
                        />
                      </div>
                    </Field>

                    <div className="flex flex-wrap gap-1">
                      {ANGLE_PRESETS.map((angle) => (
                        <button
                          key={angle}
                          type="button"
                          onClick={() => patch(axis.id, { angleDeg: angle })}
                          className={cn(
                            'rounded-md border px-2 py-0.5 text-xs transition-colors',
                            config.angleDeg === angle
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {angle}°
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Sentido">
                        <Select
                          value={config.direction}
                          onChange={(event) =>
                            patch(axis.id, { direction: event.target.value as 'up' | 'down' })
                          }
                        >
                          <option value="up">Para cima</option>
                          <option value="down">Para baixo</option>
                        </Select>
                      </Field>
                      <Field label="Raio interno (mm)">
                        <NumberInput
                          min={0.2}
                          step={0.1}
                          value={config.innerRadius}
                          onChange={(event) =>
                            patch(axis.id, {
                              innerRadius: Math.max(0.2, Number(event.target.value) || 0.2),
                            })
                          }
                        />
                      </Field>
                    </div>

                    <Field
                      label="Fator K"
                      hint="Define onde fica a linha neutra dentro da espessura."
                    >
                      <Select
                        value={config.kFactor}
                        onChange={(event) =>
                          patch(axis.id, { kFactor: Number(event.target.value) })
                        }
                      >
                        {K_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>

      {warnings.length > 0 && (
        <ul className="space-y-2">
          {warnings.map((warning, index) => (
            <li
              key={`${warning.title}-${index}`}
              className={cn(
                'rounded-lg border px-3 py-2 text-xs leading-relaxed',
                warning.severity === 'bloqueio'
                  ? 'border-destructive/30 bg-destructive/5'
                  : 'border-warning/30 bg-warning/5',
              )}
            >
              <span className="font-medium">{warning.title}</span>
              <span className="block text-muted-foreground">{warning.detail}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Pré-visualização, não validação.</span> O
        ângulo aqui é uma leitura do desenho: o arquivo enviado já foi planificado pelo seu CAD com
        algum fator K assumido. Esta versão também não detecta colisão entre abas.
      </p>
    </div>
  );
}
