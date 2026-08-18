/**
 * Extração e validação de eixos de dobra.
 *
 * A pergunta que este arquivo responde é uma só: esta linha de dobra pode
 * virar uma dobra de verdade? Um eixo que morre dentro do material, que não
 * atravessa a peça ou que cruza outro eixo não é dobrável a partir do plano —
 * e é melhor recusar com um motivo claro do que gerar um preview mentiroso.
 */

import { distance, type Loop, type Point } from '../types';
import type { BendAxis, FoldWarning } from './types';

/** Folga para o eixo desenhado alcançar a borda da peça, em mm. */
const REACH_TOLERANCE = 0.5;

/** Desvio máximo de um vértice em relação à reta, para a linha ser reta. */
const STRAIGHTNESS_TOLERANCE = 0.05;

/** Distância com sinal de um ponto à reta suporte do eixo. */
export function signedDistance(point: Point, origin: Point, direction: Point): number {
  // Normal à esquerda da direção.
  return (point.x - origin.x) * -direction.y + (point.y - origin.y) * direction.x;
}

/** Parâmetro de um ponto ao longo da reta, medido a partir de `origin`. */
function parameterAlong(point: Point, origin: Point, direction: Point): number {
  return (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;
}

/**
 * Onde a reta suporte atravessa um contorno fechado.
 *
 * Devolve os parâmetros ao longo da reta, ordenados. Um contorno convexo dá
 * exatamente dois; mais que isso significa que a reta entra e sai várias vezes,
 * o que acontece em peças côncavas e não é dobrável no MVP.
 */
export function findCrossings(loop: readonly Point[], origin: Point, direction: Point): number[] {
  const crossings: number[] = [];
  const n = loop.length;

  for (let i = 0; i < n; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const da = signedDistance(a, origin, direction);
    const db = signedDistance(b, origin, direction);

    // Aresta inteiramente de um lado não cruza.
    if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue;
    if (da === 0 && db === 0) continue; // Aresta sobre a reta: ignora.

    const denominator = da - db;
    if (Math.abs(denominator) < 1e-12) continue;

    const t = da / denominator;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    crossings.push(parameterAlong(point, origin, direction));
  }

  crossings.sort((x, y) => x - y);

  // Vértice exatamente sobre a reta aparece nas duas arestas vizinhas.
  const unique: number[] = [];
  for (const value of crossings) {
    if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]) > 1e-6) {
      unique.push(value);
    }
  }
  return unique;
}

/** Verifica se a polilinha é reta o bastante para virar um eixo. */
function isStraight(points: readonly Point[]): boolean {
  if (points.length <= 2) return true;

  const start = points[0];
  const end = points[points.length - 1];
  const span = distance(start, end);
  if (span < 1e-9) return false;

  const dx = (end.x - start.x) / span;
  const dy = (end.y - start.y) / span;

  for (let i = 1; i < points.length - 1; i += 1) {
    const deviation = Math.abs(signedDistance(points[i], start, { x: dx, y: dy }));
    if (deviation > STRAIGHTNESS_TOLERANCE) return false;
  }
  return true;
}

export interface AxisExtraction {
  axes: BendAxis[];
  warnings: FoldWarning[];
}

/**
 * Converte as linhas de dobra em eixos validados.
 *
 * `outerLoops` são os contornos externos da peça (profundidade par). Um eixo só
 * é dobrável se atravessar um deles de borda a borda.
 */
export function extractAxes(
  bendLines: readonly { points: Point[]; layer: string; length: number }[],
  outerLoops: readonly Loop[],
): AxisExtraction {
  const axes: BendAxis[] = [];
  const warnings: FoldWarning[] = [];

  const outline = outerLoops.find((loop) => loop.depth === 0);

  bendLines.forEach((bend, index) => {
    const id = `dobra-${index + 1}`;
    const points = bend.points;

    if (points.length < 2) return;

    const start = points[0];
    const end = points[points.length - 1];
    const span = distance(start, end);

    if (span < 1e-6) {
      warnings.push({
        severity: 'atencao',
        title: `${id}: linha de dobra degenerada`,
        detail: 'A linha tem comprimento zero e foi ignorada.',
      });
      return;
    }

    if (!isStraight(points)) {
      warnings.push({
        severity: 'bloqueio',
        title: `${id}: linha de dobra curva`,
        detail:
          'A prensa dobra em torno de um eixo reto. Uma linha curva no layer DOBRA ' +
          'não descreve uma dobra executável.',
      });
      return;
    }

    const direction = { x: (end.x - start.x) / span, y: (end.y - start.y) / span };
    const origin = start;

    const crossings = outline ? findCrossings(outline.points, origin, direction) : [];
    let problem: string | null = null;
    let spansPart = false;

    if (!outline) {
      problem = 'A peça não tem contorno externo fechado.';
    } else if (crossings.length === 0) {
      problem = 'O eixo não cruza a peça.';
    } else if (crossings.length > 2) {
      problem =
        `O eixo entra e sai da peça ${crossings.length / 2} vezes. ` +
        'Dobra em peça côncava não é suportada nesta versão.';
    } else {
      // O segmento desenhado precisa cobrir toda a travessia; se ficar curto, é
      // dobra parcial (jog), que não se resolve girando uma face inteira.
      const segmentStart = 0;
      const segmentEnd = parameterAlong(end, origin, direction);
      const low = Math.min(segmentStart, segmentEnd);
      const high = Math.max(segmentStart, segmentEnd);

      const reachesStart = low <= crossings[0] + REACH_TOLERANCE;
      const reachesEnd = high >= crossings[1] - REACH_TOLERANCE;

      if (reachesStart && reachesEnd) {
        spansPart = true;
      } else {
        // Quanto falta para o traço alcançar cada borda da travessia.
        const missing = Math.max(crossings[0] - low, 0) + Math.max(high - crossings[1], 0);
        const shortfall = Math.max(
          Math.max(low - crossings[0], 0) + Math.max(crossings[1] - high, 0),
          missing,
        );
        problem =
          `O traço para ${shortfall.toFixed(1)} mm antes de atravessar a peça. ` +
          'Dobra parcial (jog) não é suportada nesta versão — estenda a linha de ' +
          'dobra até as duas bordas.';
      }
    }

    if (problem) {
      warnings.push({
        severity: 'bloqueio',
        title: `${id}: não dobrável`,
        detail: problem,
      });
    }

    axes.push({
      id,
      origin,
      direction,
      start,
      end,
      length: bend.length,
      layer: bend.layer,
      crossings,
      spansPart,
      problem,
    });
  });

  // Eixos que se cruzam dentro da peça deixam a dobra sobredeterminada: não há
  // ordem de prensa que produza as duas a partir do plano.
  for (let i = 0; i < axes.length; i += 1) {
    for (let j = i + 1; j < axes.length; j += 1) {
      if (!axes[i].spansPart || !axes[j].spansPart) continue;
      if (axesIntersect(axes[i], axes[j])) {
        warnings.push({
          severity: 'bloqueio',
          title: `${axes[i].id} e ${axes[j].id} se cruzam`,
          detail:
            'Dois eixos que se cruzam dentro da peça não podem ser dobrados a ' +
            'partir do plano: a região comum teria de girar em torno dos dois ao ' +
            'mesmo tempo.',
        });
        axes[i].problem = axes[i].problem ?? 'Cruza outro eixo.';
        axes[j].problem = axes[j].problem ?? 'Cruza outro eixo.';
        axes[i].spansPart = false;
        axes[j].spansPart = false;
      }
    }
  }

  return { axes, warnings };
}

/** Interseção própria entre os segmentos desenhados de dois eixos. */
export function axesIntersect(a: BendAxis, b: BendAxis): boolean {
  const d1 = signedDistance(b.start, a.origin, a.direction);
  const d2 = signedDistance(b.end, a.origin, a.direction);
  const d3 = signedDistance(a.start, b.origin, b.direction);
  const d4 = signedDistance(a.end, b.origin, b.direction);

  const epsilon = 1e-9;
  return (
    ((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon)) &&
    ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon))
  );
}

/** Eixos efetivamente dobráveis. */
export function usableAxes(axes: readonly BendAxis[]): BendAxis[] {
  return axes.filter((axis) => axis.spansPart && axis.problem === null);
}
