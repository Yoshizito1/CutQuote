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
 * O 3D vale mesmo sem dobra: mostra a chapa na espessura real. E linhas de
 * construção podem ser promovidas a eixo de dobra, porque convenção de layer
 * não é universal — quem desenhou o eixo num layer qualquer ainda consegue ver
 * a peça dobrada, sem ter que voltar ao CAD só para renomear uma camada.
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
  const [promoted, setPromoted] = useState<number[]>([]);

  // Trocar de peça zera as promoções: elas se referem a índices deste desenho.
  useEffect(() => {
    setPromoted([]);
  }, [geometry]);

  const extraction = useMemo(() => {
    const outer = geometry.loops.filter((loop) => loop.depth % 2 === 0);
    const candidates = [
      ...geometry.bendLines,
      ...promoted
        .map((index) => geometry.constructionLines[index])
        .filter((line) => line !== undefined)
        .map((line) => ({ points: line.points, layer: line.layer, length: 0 })),
    ];
    return extractAxes(candidates, outer);
  }, [geometry, promoted]);

  const usableCount = extraction.axes.filter((axis) => axis.problem === null).length;

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
  const canRender3d = geometry.loops.some((loop) => loop.depth === 0);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(['2d', '3d'] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === '3d' && !canRender3d}
              onClick={() => setMode(option)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === option
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
                option === '3d' && !canRender3d && 'cursor-not-allowed opacity-40',
              )}
            >
              {option === '2d' ? 'Plano' : '3D'}
            </button>
          ))}
        </div>

        {usableCount > 0 ? (
          <Badge tone="accent">{usableCount} dobra(s)</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {geometry.constructionLines.length > 0
              ? 'Sem dobra — no 3D dá para promover uma linha de construção a eixo.'
              : 'Sem linha de dobra: o 3D mostra a chapa plana na espessura.'}
          </span>
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
          <div className="max-h-[520px] overflow-y-auto border-t border-border lg:border-l lg:border-t-0">
            <FoldPanel
              axes={extraction.axes}
              configs={configs}
              warnings={[...extraction.warnings, ...model.warnings]}
              thickness={thickness}
              defaultRadius={defaultRadius}
              constructionLines={geometry.constructionLines}
              promoted={promoted}
              onTogglePromoted={(index) =>
                setPromoted((current) =>
                  current.includes(index)
                    ? current.filter((value) => value !== index)
                    : [...current, index],
                )
              }
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
