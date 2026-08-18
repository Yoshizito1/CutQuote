/**
 * Análise topológica: transforma polilinhas soltas em uma peça com contorno
 * externo, furos e ilhas.
 *
 * É aqui que se decide o que o cliente paga: comprimento de corte, número de
 * perfurações e área líquida saem todos desta etapa.
 */

import {
  bboxFromPoints,
  distance,
  mergeBBox,
  pathLength,
  pointInPolygon,
  signedArea,
  type BendLine,
  type BoundingBox,
  type EntityIntent,
  type Loop,
  type OpenChain,
  type ParsedDrawing,
  type PartGeometry,
  type Point,
  type Polyline,
} from './types';
import {
  convexHullArea,
  dropRedundant,
  findDuplicates,
  findSelfIntersections,
} from './quality';

export interface AnalyzeOptions {
  /**
   * Distância máxima entre duas pontas para considerá-las o mesmo nó, em mm.
   * Desenhos de CAD raramente fecham perfeitamente; sem essa folga quase todo
   * arquivo real seria reprovado como "contorno aberto".
   */
  gapTolerance?: number;
  /** Layers tratados como gravação (marcação superficial), não corte passante. */
  etchLayers?: readonly string[];
  /** Layers com linhas de dobra — viram operação de prensa, não corte. */
  bendLayers?: readonly string[];
}

export const DEFAULT_GAP_TOLERANCE = 0.05; // mm

/**
 * Linetypes que, por convenção de desenho técnico, indicam linha auxiliar e
 * não trajetória de corte: eixo/centro, oculta, fantasma e tracejadas em geral.
 *
 * O padrão cobre as variantes numeradas do AutoCAD (CENTER2, CENTERX2,
 * DASHED2, HIDDENX2...) sem precisar listar todas.
 */
const CONSTRUCTION_LINETYPE = /CENTER|CENTRO|DASH|TRACEJAD|HIDDEN|OCULT|PHANTOM|FANTASM|DIVIDE|DOT/i;

/** Continuous (ou vazio) é o único linetype que representa corte real. */
export function isConstructionLinetype(linetype: string): boolean {
  const value = linetype.trim();
  if (value === '') return false;
  if (/^(CONTINUOUS|SOLID|BYLAYER|BYBLOCK)$/i.test(value)) return false;
  return CONSTRUCTION_LINETYPE.test(value);
}

/**
 * Decide a intenção de cada entidade antes de qualquer medição.
 *
 * A ordem importa: o layer manda mais que o linetype. Quem desenha a dobra num
 * layer DOBRA usando traço-ponto (que é a convenção de desenho para linha de
 * dobra) espera que ela seja tratada como dobra, não descartada como eixo.
 */
export function classifyEntity(
  polyline: Polyline,
  roles: { etchLayers: ReadonlySet<string>; bendLayers: ReadonlySet<string> },
): EntityIntent {
  const layer = polyline.layer.toLowerCase();
  if (roles.bendLayers.has(layer)) return 'dobra';
  if (roles.etchLayers.has(layer)) return 'gravacao';
  if (isConstructionLinetype(polyline.linetype)) return 'construcao';
  return 'corte';
}

export function analyzeDrawing(drawing: ParsedDrawing, options: AnalyzeOptions = {}): PartGeometry {
  const tolerance = options.gapTolerance ?? DEFAULT_GAP_TOLERANCE;
  const roles = {
    etchLayers: new Set((options.etchLayers ?? []).map((layer) => layer.toLowerCase())),
    bendLayers: new Set((options.bendLayers ?? []).map((layer) => layer.toLowerCase())),
  };

  // Uma única passada de classificação. Tudo que vem depois — encadeamento,
  // detecção de contorno aberto, preço — opera só sobre o que é corte.
  const cutPolylines: Polyline[] = [];
  const etchPolylines: Polyline[] = [];
  const constructionLines: Polyline[] = [];
  const bendLines: BendLine[] = [];

  for (const polyline of drawing.polylines) {
    switch (classifyEntity(polyline, roles)) {
      case 'dobra':
        bendLines.push({
          points: polyline.points,
          layer: polyline.layer,
          length: pathLength(polyline.points, polyline.closed),
        });
        break;
      case 'gravacao':
        etchPolylines.push(polyline);
        break;
      case 'construcao':
        constructionLines.push(polyline);
        break;
      default:
        cutPolylines.push(polyline);
        break;
    }
  }

  // Duplicidade é resolvida ANTES de medir. Um traço desenhado duas vezes é
  // cortado uma vez pela máquina; cobrar duas seria erro de preço, não estética.
  const duplicates = findDuplicates(cutPolylines, tolerance);
  const deduped = dropRedundant(cutPolylines, duplicates.redundantPolylines);

  const { closedRings, openChains } = chainPolylines(deduped, tolerance);
  const loops = buildLoops(closedRings);
  assignDepths(loops);

  const intersections = findSelfIntersections(deduped, tolerance);

  const etchLength = etchPolylines.reduce(
    (total, polyline) => total + pathLength(polyline.points, polyline.closed),
    0,
  );

  const cutLength =
    loops.reduce((total, loop) => total + loop.length, 0) +
    openChains.reduce((total, chain) => total + chain.length, 0);

  let netArea = 0;
  let holeCount = 0;
  let bodyCount = 0;
  for (const loop of loops) {
    if (loop.depth % 2 === 0) {
      netArea += loop.area;
      if (loop.depth === 0) bodyCount += 1;
    } else {
      netArea -= loop.area;
      holeCount += 1;
    }
  }

  const allBoxes = [
    ...loops.map((loop) => loop.bbox),
    ...openChains.map((chain) => bboxFromPoints(chain.points)),
    ...etchPolylines.map((polyline) => bboxFromPoints(polyline.points)),
    ...bendLines.map((bend) => bboxFromPoints(bend.points)),
    // Linhas de construção NÃO entram aqui de propósito. Por convenção de
    // desenho técnico o eixo ultrapassa o contorno da peça, e esta caixa é o
    // que define a área aninhada em pricing.ts — incluí-las cobraria chapa a
    // mais. A pré-visualização calcula o próprio enquadramento.
  ];
  const bbox =
    allBoxes.length > 0
      ? allBoxes.reduce(mergeBBox)
      : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

  const bboxArea = bbox.width * bbox.height;

  return {
    loops,
    openChains,
    bendLines,
    etchLines: etchPolylines,
    constructionLines,
    bbox,
    cutLength,
    etchLength,
    // Cada contorno fechado exige uma perfuração inicial; trechos abertos também
    // começam com um furo de entrada.
    pierces: loops.length + openChains.length,
    netArea: Math.max(0, netArea),
    bboxArea,
    bodyCount,
    holeCount,
    density: bboxArea > 0 ? cutLength / bboxArea : 0,
    quality: {
      duplicateSegments: duplicates.count,
      duplicateLength: duplicates.length,
      intersections: intersections.count,
      intersectionSamples: intersections.samples,
      hullArea: convexHullArea(loops.flatMap((loop) => loop.points)),
    },
    source: drawing,
  };
}

interface ChainResult {
  closedRings: { points: Point[]; layer: string }[];
  openChains: OpenChain[];
}

/**
 * Encadeia polilinhas soltas pelas pontas. Muitos DXF exportam cada segmento
 * como uma LINE independente — sem este passo, um retângulo simples viraria
 * quatro trechos abertos e quatro perfurações.
 */
function chainPolylines(polylines: readonly Polyline[], tolerance: number): ChainResult {
  const closedRings: { points: Point[]; layer: string }[] = [];
  const segments: Polyline[] = [];

  for (const polyline of polylines) {
    if (polyline.points.length < 2) continue;
    if (polyline.closed) {
      closedRings.push({ points: dedupe(polyline.points, tolerance), layer: polyline.layer });
    } else {
      segments.push(polyline);
    }
  }

  const grid = new SpatialGrid(Math.max(tolerance * 2, 1e-6));
  segments.forEach((segment, index) => {
    grid.insert(segment.points[0], index);
    grid.insert(segment.points[segment.points.length - 1], index);
  });

  const used = new Set<number>();
  const openChains: OpenChain[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    if (used.has(i)) continue;
    used.add(i);

    const layer = segments[i].layer;
    let chain = [...segments[i].points];

    // Estende pela cauda e depois pela cabeça até não achar mais vizinho.
    chain = extend(chain, segments, grid, used, tolerance, 'tail');
    chain = extend(chain, segments, grid, used, tolerance, 'head');

    const head = chain[0];
    const tail = chain[chain.length - 1];
    if (chain.length >= 3 && distance(head, tail) <= tolerance) {
      chain.pop(); // Fecha implicitamente; não repete o ponto inicial.
      closedRings.push({ points: dedupe(chain, tolerance), layer });
    } else {
      const points = dedupe(chain, tolerance);
      if (points.length >= 2) {
        openChains.push({ points, layer, length: pathLength(points, false) });
      }
    }
  }

  return { closedRings, openChains };
}

function extend(
  chain: Point[],
  segments: readonly Polyline[],
  grid: SpatialGrid,
  used: Set<number>,
  tolerance: number,
  end: 'head' | 'tail',
): Point[] {
  let result = chain;

  for (;;) {
    const anchor = end === 'tail' ? result[result.length - 1] : result[0];
    let matchIndex = -1;
    let matchAtStart = false;

    for (const candidate of grid.near(anchor)) {
      if (used.has(candidate)) continue;
      const points = segments[candidate].points;
      if (distance(anchor, points[0]) <= tolerance) {
        matchIndex = candidate;
        matchAtStart = true;
        break;
      }
      if (distance(anchor, points[points.length - 1]) <= tolerance) {
        matchIndex = candidate;
        matchAtStart = false;
        break;
      }
    }

    if (matchIndex === -1) return result;
    used.add(matchIndex);

    const raw = segments[matchIndex].points;
    const oriented = matchAtStart ? raw : [...raw].reverse();
    // Descarta o primeiro ponto do trecho novo: ele é o nó de junção.
    const appended = oriented.slice(1);

    result = end === 'tail' ? [...result, ...appended] : [...appended.reverse(), ...result];
  }
}

/** Remove pontos consecutivos coincidentes, que distorcem área e perímetro. */
function dedupe(points: readonly Point[], tolerance: number): Point[] {
  const epsilon = Math.max(tolerance * 0.1, 1e-9);
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || distance(last, point) > epsilon) result.push(point);
  }
  return result;
}

function buildLoops(rings: readonly { points: Point[]; layer: string }[]): Loop[] {
  const loops: Loop[] = [];
  for (const ring of rings) {
    if (ring.points.length < 3) continue;
    const area = signedArea(ring.points);
    if (Math.abs(area) < 1e-9) continue; // Degenerado (linha dobrada sobre si).
    loops.push({
      points: ring.points,
      layer: ring.layer,
      length: pathLength(ring.points, true),
      signedArea: area,
      area: Math.abs(area),
      depth: 0,
      bbox: bboxFromPoints(ring.points),
    });
  }
  // Do maior para o menor: garante que um contorno nunca é testado como pai de
  // algo maior que ele.
  loops.sort((a, b) => b.area - a.area);
  return loops;
}

/** Profundidade de aninhamento: 0 = peça, 1 = furo, 2 = ilha dentro do furo. */
function assignDepths(loops: Loop[]): void {
  for (let i = 0; i < loops.length; i += 1) {
    const inner = loops[i];
    const probe = inner.points[0];
    let depth = 0;

    for (let j = 0; j < i; j += 1) {
      const outer = loops[j];
      if (!bboxContains(outer.bbox, inner.bbox)) continue;
      if (pointInPolygon(probe, outer.points)) depth += 1;
    }
    inner.depth = depth;
  }
}

function bboxContains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/** Índice espacial simples para achar pontas candidatas sem varrer tudo. */
class SpatialGrid {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly cellSize: number) {}

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }

  insert(point: Point, index: number): void {
    const key = this.key(point.x, point.y);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(index);
    else this.cells.set(key, [index]);
  }

  /** Todos os índices nas 9 células ao redor do ponto. */
  near(point: Point): number[] {
    const cx = Math.floor(point.x / this.cellSize);
    const cy = Math.floor(point.y / this.cellSize);
    const found: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = this.cells.get(`${cx + dx}:${cy + dy}`);
        if (bucket) found.push(...bucket);
      }
    }
    return found;
  }
}

/**
 * Menor distância entre dois contornos distintos — proxy da "teia" mínima
 * (largura de material remanescente entre furos). Amostra os pontos para não
 * explodir em O(n²) em desenhos densos.
 */
export function minimumWebWidth(loops: readonly Loop[], sampleBudget = 400): number {
  if (loops.length < 2) return Infinity;

  const sampled = loops.map((loop) => samplePoints(loop.points, sampleBudget));
  let minimum = Infinity;

  for (let i = 0; i < sampled.length; i += 1) {
    for (let j = i + 1; j < sampled.length; j += 1) {
      // Se as caixas já estão longe, a distância real também está.
      const gap = bboxGap(loops[i].bbox, loops[j].bbox);
      if (gap >= minimum) continue;

      for (const a of sampled[i]) {
        for (const b of sampled[j]) {
          const d = distance(a, b);
          if (d < minimum) minimum = d;
        }
      }
    }
  }
  return minimum;
}

function samplePoints(points: readonly Point[], budget: number): Point[] {
  if (points.length <= budget) return [...points];
  const step = points.length / budget;
  const sampled: Point[] = [];
  for (let i = 0; i < budget; i += 1) sampled.push(points[Math.floor(i * step)]);
  return sampled;
}

function bboxGap(a: BoundingBox, b: BoundingBox): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/**
 * Menor dimensão de um furo — usada para checar diâmetro mínimo em função da
 * espessura. Para furos redondos equivale ao diâmetro; para rasgos, à largura.
 */
export function smallestHoleDimension(loop: Loop): number {
  return Math.min(loop.bbox.width, loop.bbox.height);
}
