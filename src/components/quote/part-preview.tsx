'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PartGeometry } from '@/lib/geometry';
import { extractAxes, solveFold, type BendConfig } from '@/lib/geometry/fold';
import { CanvasLegend, PartCanvas } from './part-canvas';
import { FoldPanel } from './fold-panel';
import { FoldViewer } from './fold-viewer';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type Mode = '2d' | '3d';

/**
 * Pré-visualização da peça, plana ou dobrada.
 *
 * O modo 3D só aparece quando existe linha de dobra: sem eixo, um viewer 3D de
 * chapa plana não acrescenta nada e custa 600 KB de download.
 */
export function PartPreview({
  geometry,
  thickness,
  defaultRadius,
  className,
}: {
  geometry: PartGeometry;
  thickness: number;
  defaultRadius: number;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>('2d');
  const [flattened, setFlattened] = useState(false);
  const [configs, setConfigs] = useState<BendConfig[]>([]);

  // Eixos derivam só do desenho, então recalculam apenas quando ele muda.
  const extraction = useMemo(() => {
    const outer = geometry.loops.filter((loop) => loop.depth % 2 === 0);
    return extractAxes(geometry.bendLines, outer);
  }, [geometry]);

  const hasBends = extraction.axes.some((axis) => axis.problem === null);

  // Configuração inicial: 90° para cima, raio da espessura selecionada.
  useEffect(() => {
    setConfigs(
      extraction.axes
        .filter((axis) => axis.problem === null)
        .map((axis) => ({
          axisId: axis.id,
          angleDeg: 90,
          direction: 'up' as const,
          innerRadius: defaultRadius,
          kFactor: 0.44,
        })),
    );
  }, [extraction, defaultRadius]);

  const model = useMemo(() => {
    const outline = geometry.loops.find((loop) => loop.depth === 0)?.points ?? [];
    const holes = geometry.loops.filter((loop) => loop.depth % 2 === 1).map((loop) => loop.points);

    return solveFold({
      thickness,
      outline,
      holes,
      axes: extraction.axes,
      // Planificar é dobrar a zero: mesmo caminho de cálculo, sem ramo especial.
      configs: flattened ? configs.map((config) => ({ ...config, angleDeg: 0 })) : configs,
    });
  }, [geometry, thickness, extraction, configs, flattened]);

  const kFactor = configs[0]?.kFactor ?? 0.44;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(['2d', '3d'] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === '3d' && !hasBends}
              onClick={() => setMode(option)}
              title={
                option === '3d' && !hasBends
                  ? 'Requer ao menos uma linha de dobra válida no layer DOBRA'
                  : undefined
              }
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === option
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
                option === '3d' && !hasBends && 'cursor-not-allowed opacity-40',
              )}
            >
              {option === '2d' ? 'Plano' : 'Dobrado 3D'}
            </button>
          ))}
        </div>

        {hasBends && (
          <Badge tone="accent">
            {extraction.axes.filter((axis) => axis.problem === null).length} dobra(s)
          </Badge>
        )}
        {extraction.axes.some((axis) => axis.problem !== null) && (
          <Badge tone="warning">
            {extraction.axes.filter((axis) => axis.problem !== null).length} não dobrável(is)
          </Badge>
        )}
      </div>

      {mode === '2d' ? (
        <>
          <div className="aspect-[4/3] w-full bg-background p-4">
            <PartCanvas geometry={geometry} />
          </div>
          <div className="border-t border-border px-4 py-3">
            <CanvasLegend geometry={geometry} />
          </div>
        </>
      ) : (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="aspect-[4/3] w-full overflow-hidden bg-[#0f1419]">
            <FoldViewer model={model} kFactor={kFactor} />
          </div>
          <div className="border-t border-border lg:border-l lg:border-t-0">
            <FoldPanel
              axes={extraction.axes}
              configs={configs}
              warnings={[...extraction.warnings, ...model.warnings]}
              thickness={thickness}
              defaultRadius={defaultRadius}
              onChange={setConfigs}
              onFlatten={() => setFlattened((current) => !current)}
              flattened={flattened}
            />
          </div>
        </div>
      )}
    </div>
  );
}
