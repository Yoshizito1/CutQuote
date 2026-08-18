/**
 * Verificações de qualidade da geometria.
 *
 * Separado de `analyze.ts` de propósito: aquele arquivo mede a peça, este julga
 * se a peça é desenhável. São perguntas diferentes e falham por motivos
 * diferentes.
 *
 * Todas as buscas por pares usam particionamento espacial. Um painel perfurado
 * passa fácil de dezenas de milhares de segmentos depois do achatamento, e uma
 * varredura O(n²) travaria o navegador do cliente no meio do orçamento.
 */

import { distance, type Loop, type Point, type Polyline } from './types';

/** Resolução da grade espacial, em múltiplos da tolerância. */
const GRID_FACTOR = 4;

interface Segment {
  a: Point;
  b: Point;
  /** Índice da polilinha de origem, para reportar de volta. */
  owner: number;
  /** Posição do segmento dentro da polilinha. */
  index: number;
}

function segmentsOf(polylines: readonly Polyline[]): Segment[] {
  const segments: Segment[] = [];
  polylines.forEach((polyline, owner) => {
    const points = polyline.points;
    const last = polyline.closed ? points.length : points.length - 1;
    for (let i = 0; i < last; i += 1) {
      segments.push({ a: points[i], b: points[(i + 1) % points.length], owner, index: i });
    }
  });
  return segments;
}

/** Chave estável de um segmento, independente do sentido em que foi desenhado. */
function segmentKey(a: Point, b: Point, tolerance: number): string {
  const q = (v: number): number => Math.round(v / tolerance);
  const ka = `${q(a.x)},${q(a.y)}`;
  const kb = `${q(b.x)},${q(b.y)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

export interface DuplicateReport {
  /** Quantos segmentos apareceram mais de uma vez. */
  count: number;
  /** Comprimento total repetido, em mm — é o que estaria sendo cobrado a mais. */
  length: number;
  /** Índices das polilinhas que são cópia integral de outra. */
  redundantPolylines: number[];
}

/**
 * Encontra geometria desenhada em duplicidade.
 *
 * O caso clássico é DXF gerado a partir de PDF, ou o resultado de explodir um
 * bloco duas vezes: cada traço vira duas entidades sobrepostas. A máquina corta
 * uma vez, mas o motor mediria duas — inflando comprimento de corte e número de
 * perfurações, e portanto o preço.
 */
export function findDuplicates(
  polylines: readonly Polyline[],
  tolerance: number,
): DuplicateReport {
  const seen = new Map<string, number>();
  let count = 0;
  let length = 0;

  for (const segment of segmentsOf(polylines)) {
    const key = segmentKey(segment.a, segment.b, tolerance);
    const previous = seen.get(key) ?? 0;
    if (previous > 0) {
      count += 1;
      length += distance(segment.a, segment.b);
    }
    seen.set(key, previous + 1);
  }

  // Uma polilinha só é considerada redundante quando TODOS os seus segmentos já
  // apareceram numa polilinha anterior. Descartar a polilinha inteira é seguro;
  // remover segmento a segmento poderia abrir um contorno válido.
  const redundantPolylines: number[] = [];
  const consumed = new Map<string, number>();

  polylines.forEach((polyline, index) => {
    const points = polyline.points;
    const last = polyline.closed ? points.length : points.length - 1;
    if (last < 1) return;

    let allSeen = true;
    const keys: string[] = [];
    for (let i = 0; i < last; i += 1) {
      const key = segmentKey(points[i], points[(i + 1) % points.length], tolerance);
      keys.push(key);
      if ((consumed.get(key) ?? 0) === 0) allSeen = false;
    }

    if (allSeen) redundantPolylines.push(index);
    else for (const key of keys) consumed.set(key, (consumed.get(key) ?? 0) + 1);
  });

  return { count, length, redundantPolylines };
}

/** Remove as polilinhas apontadas como cópia integral de outra. */
export function dropRedundant(
  polylines: readonly Polyline[],
  redundant: readonly number[],
): Polyline[] {
  if (redundant.length === 0) return [...polylines];
  const drop = new Set(redundant);
  return polylines.filter((_, index) => !drop.has(index));
}

/** Produto vetorial: > 0 anti-horário, < 0 horário, 0 colinear. */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Point, q: Point, r: Point, epsilon: number): boolean {
  return (
    Math.abs(cross(p, q, r)) <= epsilon &&
    Math.min(p.x, r.x) - epsilon <= q.x &&
    q.x <= Math.max(p.x, r.x) + epsilon &&
    Math.min(p.y, r.y) - epsilon <= q.y &&
    q.y <= Math.max(p.y, r.y) + epsilon
  );
}

/** Interseção própria: encostar pela ponta não conta. */
function segmentsIntersect(s1: Segment, s2: Segment, epsilon: number): boolean {
  if (
    distance(s1.a, s2.a) <= epsilon ||
    distance(s1.a, s2.b) <= epsilon ||
    distance(s1.b, s2.a) <= epsilon ||
    distance(s1.b, s2.b) <= epsilon
  ) {
    return false;
  }

  const d1 = cross(s2.a, s2.b, s1.a);
  const d2 = cross(s2.a, s2.b, s1.b);
  const d3 = cross(s1.a, s1.b, s2.a);
  const d4 = cross(s1.a, s1.b, s2.b);

  const straddles =
    ((d1 > epsilon && d2 < -epsilon) || (d1 < -epsilon && d2 > epsilon)) &&
    ((d3 > epsilon && d4 < -epsilon) || (d3 < -epsilon && d4 > epsilon));
  if (straddles) return true;

  // Sobreposição colinear.
  if (onSegment(s2.a, s1.a, s2.b, epsilon)) return true;
  if (onSegment(s2.a, s1.b, s2.b, epsilon)) return true;
  if (onSegment(s1.a, s2.a, s1.b, epsilon)) return true;
  if (onSegment(s1.a, s2.b, s1.b, epsilon)) return true;
  return false;
}

export interface IntersectionReport {
  count: number;
  /** Amostra de onde os cruzamentos acontecem, para destacar no desenho. */
  samples: Point[];
}

/**
 * Contornos que cruzam a si mesmos ou uns aos outros.
 *
 * Um perfil em oito não tem dentro e fora definidos: a área calculada sai
 * errada e a máquina não sabe de que lado deixar o material. É bloqueio, não
 * aviso.
 */
export function findSelfIntersections(
  polylines: readonly Polyline[],
  tolerance: number,
  maxSamples = 8,
): IntersectionReport {
  const segments = segmentsOf(polylines);
  if (segments.length < 4) return { count: 0, samples: [] };

  const cell = Math.max(tolerance * GRID_FACTOR, 1e-6);
  const buckets = new Map<string, number[]>();
  const oversized: number[] = [];

  // Fase ampla: cada segmento entra nas células que sua caixa envolvente toca.
  segments.forEach((segment, index) => {
    const minX = Math.floor(Math.min(segment.a.x, segment.b.x) / cell);
    const maxX = Math.floor(Math.max(segment.a.x, segment.b.x) / cell);
    const minY = Math.floor(Math.min(segment.a.y, segment.b.y) / cell);
    const maxY = Math.floor(Math.max(segment.a.y, segment.b.y) / cell);

    // Segmento muito maior que a célula degradaria a grade inteira; vai para
    // uma lista à parte, testada contra todos os demais.
    if ((maxX - minX + 1) * (maxY - minY + 1) > 256) {
      oversized.push(index);
      return;
    }

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x}:${y}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    }
  });

  const found = new Set<string>();
  const samples: Point[] = [];

  const test = (i: number, j: number): void => {
    const a = segments[i];
    const b = segments[j];
    // Segmentos vizinhos na mesma polilinha compartilham ponta por construção.
    if (a.owner === b.owner && Math.abs(a.index - b.index) <= 1) return;

    const pairKey = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (found.has(pairKey)) return;

    if (segmentsIntersect(a, b, tolerance)) {
      found.add(pairKey);
      if (samples.length < maxSamples) {
        samples.push({ x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 });
      }
    }
  };

  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) test(bucket[i], bucket[j]);
    }
  }
  for (const index of oversized) {
    for (let j = 0; j < segments.length; j += 1) {
      if (index !== j) test(index, j);
    }
  }

  return { count: found.size, samples };
}

export interface SharpCornerReport {
  count: number;
  /** Menor ângulo encontrado, em graus. */
  smallestAngle: number;
  samples: Point[];
}

/**
 * Cantos agudos demais para o feixe.
 *
 * O feixe tem largura: abaixo de certo ângulo o canto sai arredondado e o
 * acúmulo de calor queima a região. Vértices de curva achatada são ignorados
 * pelo comprimento mínimo de aresta — eles não são canto, são discretização.
 */
export function findSharpCorners(
  loops: readonly Loop[],
  minAngleDeg: number,
  minEdgeLength: number,
  maxSamples = 8,
): SharpCornerReport {
  let count = 0;
  let smallestAngle = 180;
  const samples: Point[] = [];

  for (const loop of loops) {
    const points = loop.points;
    const n = points.length;
    if (n < 3) continue;

    for (let i = 0; i < n; i += 1) {
      const previous = points[(i - 1 + n) % n];
      const current = points[i];
      const next = points[(i + 1) % n];

      const inLength = distance(previous, current);
      const outLength = distance(current, next);
      if (inLength < minEdgeLength || outLength < minEdgeLength) continue;

      const v1x = (previous.x - current.x) / inLength;
      const v1y = (previous.y - current.y) / inLength;
      const v2x = (next.x - current.x) / outLength;
      const v2y = (next.y - current.y) / outLength;

      const dot = Math.max(-1, Math.min(1, v1x * v2x + v1y * v2y));
      const angle = (Math.acos(dot) * 180) / Math.PI;

      if (angle < minAngleDeg) {
        count += 1;
        if (angle < smallestAngle) smallestAngle = angle;
        if (samples.length < maxSamples) samples.push(current);
      }
    }
  }

  return { count, smallestAngle: count > 0 ? smallestAngle : 180, samples };
}

function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return distance(p, a);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function sampleEvenly(points: readonly Point[], budget: number): Point[] {
  if (points.length <= budget) return [...points];
  const step = points.length / budget;
  const out: Point[] = [];
  for (let i = 0; i < budget; i += 1) out.push(points[Math.floor(i * step)]);
  return out;
}

/**
 * Menor distância entre um furo e uma linha de dobra.
 *
 * Furo perto demais da dobra deforma: o material escoa para dentro dele e o
 * furo sai oval. A régua usual é o raio de dobra somado a algumas espessuras.
 */
export function minimumHoleToBendDistance(
  loops: readonly Loop[],
  bendLines: readonly { points: Point[] }[],
): number {
  const holes = loops.filter((loop) => loop.depth % 2 === 1);
  if (holes.length === 0 || bendLines.length === 0) return Infinity;

  let minimum = Infinity;
  for (const hole of holes) {
    const probes = sampleEvenly(hole.points, 120);
    for (const bend of bendLines) {
      for (let i = 0; i < bend.points.length - 1; i += 1) {
        const a = bend.points[i];
        const b = bend.points[i + 1];
        for (const point of probes) {
          const d = pointToSegmentDistance(point, a, b);
          if (d < minimum) minimum = d;
        }
      }
    }
  }
  return minimum;
}

/** Recortes internos pequenos demais para o feixe abrir. */
export function findUncuttableLoops(loops: readonly Loop[], minDimension: number): Loop[] {
  return loops.filter(
    (loop) => loop.depth % 2 === 1 && Math.min(loop.bbox.width, loop.bbox.height) < minDimension,
  );
}

/**
 * Área do fecho convexo.
 *
 * Serve como indicador de aproveitamento: uma peça triangular ocupa metade da
 * própria caixa envolvente. Não é usada para precificar — trocar a base de
 * cálculo mudaria todo o histórico de preços — mas mostra ao cliente onde ele
 * está perdendo chapa.
 */
export function convexHullArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const build = (input: readonly Point[]): Point[] => {
    const stack: Point[] = [];
    for (const point of input) {
      while (
        stack.length >= 2 &&
        cross(stack[stack.length - 2], stack[stack.length - 1], point) <= 0
      ) {
        stack.pop();
      }
      stack.push(point);
    }
    return stack;
  };

  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}
