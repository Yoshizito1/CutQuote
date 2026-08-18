/**
 * Particionamento do flat pattern em faces rígidas.
 *
 * Cada eixo de dobra corta a peça em dois. Com N eixos que não se cruzam,
 * sobram N+1 faces, cada uma identificada pelo lado em que está de cada eixo —
 * é essa assinatura que depois define quem é vizinho de quem.
 */

import { signedArea, type Point } from '../types';
import { signedDistance } from './axis';
import type { BendAxis, FoldWarning } from './types';

/** Região intermediária do particionamento. */
export interface Region {
  outline: Point[];
  holes: Point[][];
  signature: Record<string, 1 | -1>;
}

/**
 * Recorte de polígono por semiplano (Sutherland–Hodgman).
 *
 * O semiplano é convexo, então o algoritmo é exato para contornos convexos.
 * Em contornos côncavos ele pode gerar arestas coincidentes ligando partes
 * separadas — visualmente correto depois de triangulado, mas é o motivo de
 * `extractAxes` recusar eixos que atravessam a peça mais de uma vez.
 */
export function clipHalfPlane(
  polygon: readonly Point[],
  axis: Pick<BendAxis, 'origin' | 'direction'>,
  keep: 1 | -1,
  offset = 0,
): Point[] {
  if (polygon.length < 3) return [];

  const inside = (p: Point): boolean => {
    const d = signedDistance(p, axis.origin, axis.direction) * keep;
    return d >= offset;
  };
  const value = (p: Point): number =>
    signedDistance(p, axis.origin, axis.direction) * keep - offset;

  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const currentIn = inside(current);
    const nextIn = inside(next);

    if (currentIn) out.push(current);

    if (currentIn !== nextIn) {
      const dc = value(current);
      const dn = value(next);
      const denominator = dc - dn;
      if (Math.abs(denominator) > 1e-12) {
        const t = dc / denominator;
        out.push({
          x: current.x + (next.x - current.x) * t,
          y: current.y + (next.y - current.y) * t,
        });
      }
    }
  }

  // Remove pontos coincidentes gerados no corte.
  const cleaned: Point[] = [];
  for (const point of out) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1e-9) cleaned.push(point);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) cleaned.pop();
  }

  return cleaned.length >= 3 ? cleaned : [];
}

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Um contorno cruza a reta quando tem vértices dos dois lados. */
function straddles(points: readonly Point[], axis: BendAxis, epsilon = 1e-9): boolean {
  let positive = false;
  let negative = false;
  for (const point of points) {
    const d = signedDistance(point, axis.origin, axis.direction);
    if (d > epsilon) positive = true;
    else if (d < -epsilon) negative = true;
    if (positive && negative) return true;
  }
  return false;
}

export interface PartitionResult {
  regions: Region[];
  warnings: FoldWarning[];
}

/**
 * Divide a peça pelos eixos informados.
 *
 * Furos são atribuídos à face que contém o centro deles. Um furo que atravessa
 * a linha de dobra é um problema de projeto antes de ser um problema de
 * modelagem — ele deforma na prensa — e já é reportado pelo DFM; aqui gera aviso
 * e fica com a face de maior parte.
 */
export function partitionPart(
  outline: readonly Point[],
  holes: readonly Point[][],
  axes: readonly BendAxis[],
): PartitionResult {
  const warnings: FoldWarning[] = [];

  let regions: Region[] = [
    { outline: [...outline], holes: holes.map((hole) => [...hole]), signature: {} },
  ];

  for (const axis of axes) {
    const next: Region[] = [];

    for (const region of regions) {
      if (!straddles(region.outline, axis)) {
        // Região inteira de um lado: só recebe a assinatura.
        const reference = centroid(region.outline);
        const side: 1 | -1 =
          signedDistance(reference, axis.origin, axis.direction) >= 0 ? 1 : -1;
        next.push({ ...region, signature: { ...region.signature, [axis.id]: side } });
        continue;
      }

      for (const side of [1, -1] as const) {
        const clipped = clipHalfPlane(region.outline, axis, side);
        if (clipped.length < 3) continue;

        // Furos vão inteiros para o lado do próprio centro — inclusive os que
        // cruzam o eixo. Recortá-los inventaria um rasgo que não existe no
        // desenho; deixá-los inteiros mostra o que o cliente realmente enviou.
        const kept = region.holes.filter((hole) => {
          const reference = centroid(hole);
          const holeSide = signedDistance(reference, axis.origin, axis.direction) >= 0 ? 1 : -1;
          return holeSide === side;
        });

        next.push({
          outline: clipped,
          holes: kept,
          signature: { ...region.signature, [axis.id]: side },
        });
      }
    }

    regions = next;
  }

  // Avisa uma única vez por furo que cruza qualquer eixo.
  for (const hole of holes) {
    if (axes.some((axis) => straddles(hole, axis))) {
      warnings.push({
        severity: 'atencao',
        title: 'Furo sobre a linha de dobra',
        detail:
          'Há furo atravessado por um eixo de dobra. Na prensa ele deforma; no ' +
          'preview aparece inteiro de um lado só.',
      });
      break;
    }
  }

  // Descarta lascas: recorte por semiplano gera fatias sem área em tangências.
  const meaningful = regions.filter((region) => Math.abs(signedArea(region.outline)) > 1e-6);

  return { regions: meaningful, warnings };
}

export function regionArea(region: Region): number {
  const outer = Math.abs(signedArea(region.outline));
  const inner = region.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
  return Math.max(0, outer - inner);
}
