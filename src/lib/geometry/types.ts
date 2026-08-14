/**
 * Tipos base da camada de geometria.
 *
 * Convenção: TODA geometria interna é armazenada em milímetros, com Y para
 * cima (convenção CAD). A conversão a partir das unidades do arquivo é feita
 * uma única vez, no parser.
 */

export interface Point {
  x: number;
  y: number;
}

/** Polilinha já achatada (curvas convertidas em segmentos retos). */
export interface Polyline {
  points: Point[];
  /** true quando o último ponto conecta de volta no primeiro. */
  closed: boolean;
  /** Layer de origem no CAD — usado para separar corte de gravação. */
  layer: string;
}

/** Contorno fechado após o encadeamento das polilinhas soltas. */
export interface Loop {
  points: Point[];
  layer: string;
  /** Perímetro em mm. */
  length: number;
  /** Área com sinal (shoelace). Positiva = anti-horário. */
  signedArea: number;
  /** Área absoluta em mm². */
  area: number;
  /** 0 = contorno externo, 1 = furo, 2 = ilha dentro do furo, ... */
  depth: number;
  bbox: BoundingBox;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Trecho aberto que não fechou com nenhum outro — geralmente erro de desenho. */
export interface OpenChain {
  points: Point[];
  layer: string;
  length: number;
}

export type SourceUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'unknown';

/** Saída bruta de um parser, antes da análise topológica. */
export interface ParsedDrawing {
  polylines: Polyline[];
  /** Unidade declarada no arquivo (header $INSUNITS no DXF). */
  sourceUnit: SourceUnit;
  /** Fator aplicado para converter o arquivo em mm. */
  unitScale: number;
  /** Nomes de layer encontrados, em ordem de aparição. */
  layers: string[];
  /** Tipos de entidade que o parser reconheceu mas ignorou (texto, cotas...). */
  ignoredEntities: Record<string, number>;
  format: 'dxf' | 'svg';
}

/** Linha de dobra marcada em layer própria — não é trajetória de corte. */
export interface BendLine {
  points: Point[];
  layer: string;
  /** Comprimento da dobra em mm (define se cabe na prensa). */
  length: number;
}

/** Resultado completo da análise de uma peça. */
export interface PartGeometry {
  loops: Loop[];
  openChains: OpenChain[];
  bendLines: BendLine[];
  /** Trajetórias de gravação, já separadas do corte. */
  etchLines: Polyline[];
  bbox: BoundingBox;
  /** Comprimento total a cortar (contornos + furos), em mm. */
  cutLength: number;
  /** Comprimento em layers marcados como gravação, em mm. */
  etchLength: number;
  /** Número de perfurações iniciais (uma por contorno fechado + uma por trecho aberto). */
  pierces: number;
  /** Área líquida de material da peça (externo menos furos), em mm². */
  netArea: number;
  /** Área do retângulo envolvente, em mm². */
  bboxArea: number;
  /** Quantos contornos externos independentes o arquivo tem (>1 = vários corpos). */
  bodyCount: number;
  /** Furos = loops de profundidade ímpar. */
  holeCount: number;
  /** cutLength / bboxArea — proxy de densidade de desenho (mm/mm²). */
  density: number;
  source: ParsedDrawing;
}

export const UNIT_TO_MM: Record<Exclude<SourceUnit, 'unknown'>, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
};

export function emptyBBox(): BoundingBox {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    width: 0,
    height: 0,
  };
}

export function bboxFromPoints(points: readonly Point[]): BoundingBox {
  const box = emptyBBox();
  for (const p of points) {
    if (p.x < box.minX) box.minX = p.x;
    if (p.y < box.minY) box.minY = p.y;
    if (p.x > box.maxX) box.maxX = p.x;
    if (p.y > box.maxY) box.maxY = p.y;
  }
  if (!Number.isFinite(box.minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  box.width = box.maxX - box.minX;
  box.height = box.maxY - box.minY;
  return box;
}

export function mergeBBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  const minX = Math.min(a.minX, b.minX);
  const minY = Math.min(a.minY, b.minY);
  const maxX = Math.max(a.maxX, b.maxX);
  const maxY = Math.max(a.maxY, b.maxY);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Comprimento de uma sequência de pontos. `closed` inclui o segmento de fechamento. */
export function pathLength(points: readonly Point[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  if (closed && points.length > 2) {
    total += distance(points[points.length - 1], points[0]);
  }
  return total;
}

/** Área com sinal pela fórmula do shoelace. Positiva = anti-horário. */
export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Teste ponto-em-polígono por ray casting horizontal. */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const xCross = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xCross) inside = !inside;
  }
  return inside;
}
