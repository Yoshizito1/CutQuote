'use client';

/**
 * Visualização da peça em SVG.
 *
 * Renderiza exatamente a geometria que o motor cobrou — não uma miniatura
 * decorativa. Cada cor corresponde a uma linha do orçamento, então o cliente
 * consegue ver por que está pagando o que está pagando.
 */

import { useMemo, useState } from 'react';

import type { BendLine, Loop, OpenChain, PartGeometry, Point } from '@/lib/geometry';
import { cn } from '@/lib/utils';

interface PartCanvasProps {
  geometry: PartGeometry;
  className?: string;
  /** Mostra as cotas da caixa envolvente. */
  showDimensions?: boolean;
}

/** Converte para o espaço do SVG, onde Y cresce para baixo. */
function toPath(points: readonly Point[], close: boolean): string {
  if (points.length === 0) return '';
  const commands = points.map(
    (point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(3)} ${(-point.y).toFixed(3)}`,
  );
  return commands.join(' ') + (close ? ' Z' : '');
}

export function PartCanvas({ geometry, className, showDimensions = true }: PartCanvasProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const view = useMemo(() => {
    const { bbox } = geometry;
    const span = Math.max(bbox.width, bbox.height, 1);
    const padding = span * 0.12;

    return {
      // Y é espelhado, então o topo do SVG é -maxY.
      viewBox: [
        bbox.minX - padding,
        -bbox.maxY - padding,
        bbox.width + padding * 2,
        bbox.height + padding * 2,
      ].join(' '),
      padding,
      span,
    };
  }, [geometry]);

  const outerLoops = geometry.loops.filter((loop) => loop.depth % 2 === 0);
  const holeLoops = geometry.loops.filter((loop) => loop.depth % 2 === 1);

  // Uma única trajetória com evenodd resolve furos e ilhas de qualquer
  // profundidade: a paridade do aninhamento é exatamente a regra do evenodd.
  const fillPath = geometry.loops.map((loop) => toPath(loop.points, true)).join(' ');

  const fontSize = view.span * 0.035;
  const strokeHint = view.span * 0.004;

  return (
    <div className={cn('relative h-full w-full', className)}>
      <svg
        viewBox={view.viewBox}
        className="h-full w-full"
        role="img"
        aria-label={`Peça de ${geometry.bbox.width.toFixed(1)} por ${geometry.bbox.height.toFixed(1)} milímetros`}
      >
        <defs>
          <pattern
            id="grade"
            width={10}
            height={10}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 10 0 L 0 0 0 10"
              fill="none"
              stroke="var(--geo-grid)"
              strokeWidth={strokeHint}
            />
          </pattern>
        </defs>

        <rect
          x={geometry.bbox.minX - view.padding}
          y={-geometry.bbox.maxY - view.padding}
          width={geometry.bbox.width + view.padding * 2}
          height={geometry.bbox.height + view.padding * 2}
          fill="url(#grade)"
        />

        {/* Corpo da peça */}
        {fillPath && <path d={fillPath} fill="var(--geo-fill)" fillRule="evenodd" />}

        {/* Contornos externos */}
        {outerLoops.map((loop, index) => (
          <LoopPath
            key={`out-${index}`}
            loop={loop}
            color="var(--geo-outline)"
            width={1.6}
            active={hovered === `out-${index}`}
            onHover={() => setHovered(`out-${index}`)}
            onLeave={() => setHovered(null)}
          />
        ))}

        {/* Furos e recortes internos */}
        {holeLoops.map((loop, index) => (
          <LoopPath
            key={`hole-${index}`}
            loop={loop}
            color="var(--geo-hole)"
            width={1.3}
            active={hovered === `hole-${index}`}
            onHover={() => setHovered(`hole-${index}`)}
            onLeave={() => setHovered(null)}
          />
        ))}

        {/* Gravação: traço fino contínuo */}
        {geometry.etchLines.map((polyline, index) => (
          <path
            key={`etch-${index}`}
            d={toPath(polyline.points, polyline.closed)}
            fill="none"
            stroke="var(--geo-etch)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Linhas de dobra: traço-ponto, como na norma de desenho técnico */}
        {geometry.bendLines.map((bend: BendLine, index) => (
          <path
            key={`bend-${index}`}
            d={toPath(bend.points, false)}
            fill="none"
            stroke="var(--geo-bend)"
            strokeWidth={1.5}
            strokeDasharray="8 3 2 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Contornos abertos: erro, destacado em vermelho com as pontas visíveis */}
        {geometry.openChains.map((chain: OpenChain, index) => (
          <g key={`open-${index}`}>
            <path
              d={toPath(chain.points, false)}
              fill="none"
              stroke="var(--geo-open)"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
            <EndpointMarker point={chain.points[0]} radius={view.span * 0.012} />
            <EndpointMarker
              point={chain.points[chain.points.length - 1]}
              radius={view.span * 0.012}
            />
          </g>
        ))}

        {showDimensions && geometry.bbox.width > 0 && (
          <Dimensions
            geometry={geometry}
            fontSize={fontSize}
            offset={view.padding * 0.55}
            stroke={strokeHint}
          />
        )}
      </svg>
    </div>
  );
}

function LoopPath({
  loop,
  color,
  width,
  active,
  onHover,
  onLeave,
}: {
  loop: Loop;
  color: string;
  width: number;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  return (
    <path
      d={toPath(loop.points, true)}
      fill="none"
      stroke={color}
      strokeWidth={active ? width * 2 : width}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="transition-[stroke-width]"
    >
      <title>
        {loop.depth === 0 ? 'Contorno externo' : `Recorte interno (nível ${loop.depth})`} ·{' '}
        {loop.length.toFixed(1)} mm de corte · {(loop.area / 100).toFixed(2)} cm²
      </title>
    </path>
  );
}

/** Marca a ponta solta de um contorno aberto. */
function EndpointMarker({ point, radius }: { point: Point; radius: number }) {
  return (
    <circle
      cx={point.x}
      cy={-point.y}
      r={radius}
      fill="none"
      stroke="var(--geo-open)"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function Dimensions({
  geometry,
  fontSize,
  offset,
  stroke,
}: {
  geometry: PartGeometry;
  fontSize: number;
  offset: number;
  stroke: number;
}) {
  const { bbox } = geometry;
  const bottom = -bbox.minY + offset;
  const left = bbox.minX - offset;

  return (
    <g className="fill-muted-foreground" style={{ stroke: 'var(--muted-foreground)' }}>
      {/* Cota horizontal */}
      <line x1={bbox.minX} y1={bottom} x2={bbox.maxX} y2={bottom} strokeWidth={stroke} />
      <line x1={bbox.minX} y1={bottom - offset * 0.25} x2={bbox.minX} y2={bottom + offset * 0.25} strokeWidth={stroke} />
      <line x1={bbox.maxX} y1={bottom - offset * 0.25} x2={bbox.maxX} y2={bottom + offset * 0.25} strokeWidth={stroke} />
      <text
        x={(bbox.minX + bbox.maxX) / 2}
        y={bottom + fontSize * 1.1}
        fontSize={fontSize}
        textAnchor="middle"
        stroke="none"
      >
        {bbox.width.toFixed(1)} mm
      </text>

      {/* Cota vertical */}
      <line x1={left} y1={-bbox.minY} x2={left} y2={-bbox.maxY} strokeWidth={stroke} />
      <line x1={left - offset * 0.25} y1={-bbox.minY} x2={left + offset * 0.25} y2={-bbox.minY} strokeWidth={stroke} />
      <line x1={left - offset * 0.25} y1={-bbox.maxY} x2={left + offset * 0.25} y2={-bbox.maxY} strokeWidth={stroke} />
      <text
        x={left - fontSize * 0.5}
        y={-(bbox.minY + bbox.maxY) / 2}
        fontSize={fontSize}
        textAnchor="middle"
        dominantBaseline="middle"
        stroke="none"
        transform={`rotate(-90 ${left - fontSize * 0.5} ${-(bbox.minY + bbox.maxY) / 2})`}
      >
        {bbox.height.toFixed(1)} mm
      </text>
    </g>
  );
}

/** Legenda das cores, para o usuário decodificar o desenho. */
export function CanvasLegend({ geometry }: { geometry: PartGeometry }) {
  const items = [
    { color: 'var(--geo-outline)', label: 'Contorno', show: geometry.bodyCount > 0 },
    { color: 'var(--geo-hole)', label: 'Recorte interno', show: geometry.holeCount > 0 },
    { color: 'var(--geo-bend)', label: 'Dobra', show: geometry.bendLines.length > 0 },
    { color: 'var(--geo-etch)', label: 'Gravação', show: geometry.etchLength > 0 },
    { color: 'var(--geo-open)', label: 'Contorno aberto', show: geometry.openChains.length > 0 },
  ].filter((item) => item.show);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
