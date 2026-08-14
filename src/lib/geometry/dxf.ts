/**
 * Parser DXF ASCII.
 *
 * Cobre o subconjunto que aparece de fato em peças 2D de corte:
 * LINE, CIRCLE, ARC, LWPOLYLINE (com bulge), POLYLINE/VERTEX, ELLIPSE,
 * SPLINE (de Boor real) e INSERT com expansão recursiva de BLOCK.
 *
 * Entidades de anotação (TEXT, MTEXT, DIMENSION, HATCH...) são contadas e
 * ignoradas — elas não viram trajetória de corte, mas o usuário precisa saber
 * que estavam lá.
 */

import {
  DEFAULT_CHORD_TOLERANCE,
  flattenArc,
  flattenBSpline,
  flattenBulge,
  flattenCircle,
  flattenEllipse,
} from './curves';
import { UNIT_TO_MM, type ParsedDrawing, type Point, type Polyline, type SourceUnit } from './types';

interface Pair {
  code: number;
  value: string;
}

interface Transform {
  scaleX: number;
  scaleY: number;
  rotation: number;
  translateX: number;
  translateY: number;
}

const IDENTITY: Transform = {
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  translateX: 0,
  translateY: 0,
};

/** Códigos $INSUNITS do header DXF. */
const INSUNITS: Record<number, SourceUnit> = {
  0: 'unknown',
  1: 'in',
  2: 'ft',
  4: 'mm',
  5: 'cm',
  6: 'm',
};

const ANNOTATION_ENTITIES = new Set([
  'TEXT',
  'MTEXT',
  'DIMENSION',
  'LEADER',
  'MLEADER',
  'HATCH',
  'ATTDEF',
  'ATTRIB',
  'SOLID',
  'IMAGE',
  'VIEWPORT',
  '3DFACE',
  'REGION',
  'BODY',
]);

export interface DxfParseOptions {
  /** Tolerância de corda em mm (afeta a precisão do comprimento de corte). */
  chordTolerance?: number;
  /**
   * Unidade a assumir quando o arquivo não declara $INSUNITS (código 0).
   * A maior parte dos DXF exportados por CAD 3D vem sem unidade.
   */
  assumeUnit?: Exclude<SourceUnit, 'unknown'>;
}

/** Quebra o arquivo em pares (código, valor). Aceita CRLF e espaços de indentação. */
function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[i + 1].trim() });
  }
  return pairs;
}

/** Agrupa os pares de uma entidade: tudo até o próximo código 0. */
interface RawEntity {
  type: string;
  pairs: Pair[];
}

function num(entity: RawEntity, code: number, fallback = 0): number {
  for (const pair of entity.pairs) {
    if (pair.code === code) {
      const value = Number.parseFloat(pair.value);
      return Number.isFinite(value) ? value : fallback;
    }
  }
  return fallback;
}

function str(entity: RawEntity, code: number, fallback = ''): string {
  for (const pair of entity.pairs) {
    if (pair.code === code) return pair.value;
  }
  return fallback;
}

function allNums(entity: RawEntity, code: number): number[] {
  const values: number[] = [];
  for (const pair of entity.pairs) {
    if (pair.code === code) {
      const value = Number.parseFloat(pair.value);
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

/** Reconstrói pares (x, y) a partir de dois códigos que se alternam. */
function pointList(entity: RawEntity, codeX: number, codeY: number): Point[] {
  const points: Point[] = [];
  for (const pair of entity.pairs) {
    if (pair.code === codeX) {
      points.push({ x: Number.parseFloat(pair.value) || 0, y: 0 });
    } else if (pair.code === codeY && points.length > 0) {
      points[points.length - 1].y = Number.parseFloat(pair.value) || 0;
    }
  }
  return points;
}

function applyTransform(point: Point, t: Transform): Point {
  const sx = point.x * t.scaleX;
  const sy = point.y * t.scaleY;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    x: sx * cos - sy * sin + t.translateX,
    y: sx * sin + sy * cos + t.translateY,
  };
}

function composeTransform(parent: Transform, child: Transform): Transform {
  const origin = applyTransform({ x: child.translateX, y: child.translateY }, parent);
  return {
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
    rotation: parent.rotation + child.rotation,
    translateX: origin.x,
    translateY: origin.y,
  };
}

export function parseDxf(text: string, options: DxfParseOptions = {}): ParsedDrawing {
  const tol = options.chordTolerance ?? DEFAULT_CHORD_TOLERANCE;
  const pairs = tokenize(text);

  const sourceUnit = readUnits(pairs, options.assumeUnit ?? 'mm');
  const blocks = readBlocks(pairs);
  const entities = readSection(pairs, 'ENTITIES');

  const context: EmitContext = {
    polylines: [],
    ignored: {},
    layers: new Set<string>(),
    blocks,
    tol,
    depth: 0,
  };

  for (const entity of entities) {
    emitEntity(entity, IDENTITY, context);
  }

  // Escala para mm só no final: a tolerância de corda foi aplicada nas unidades
  // do arquivo, então é convertida junto.
  const unitScale = sourceUnit === 'unknown' ? UNIT_TO_MM.mm : UNIT_TO_MM[sourceUnit];
  const scaled: Polyline[] =
    unitScale === 1
      ? context.polylines
      : context.polylines.map((polyline) => ({
          ...polyline,
          points: polyline.points.map((p) => ({ x: p.x * unitScale, y: p.y * unitScale })),
        }));

  return {
    polylines: scaled,
    sourceUnit,
    unitScale,
    layers: [...context.layers],
    ignoredEntities: context.ignored,
    format: 'dxf',
  };
}

function readUnits(pairs: Pair[], assume: Exclude<SourceUnit, 'unknown'>): SourceUnit {
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === 9 && pairs[i].value === '$INSUNITS') {
      const raw = Number.parseInt(pairs[i + 1].value, 10);
      const unit = INSUNITS[raw];
      if (unit && unit !== 'unknown') return unit;
      return assume;
    }
  }
  return assume;
}

/** Extrai as entidades de uma seção nomeada (ENTITIES, BLOCKS...). */
function readSection(pairs: Pair[], name: string): RawEntity[] {
  const entities: RawEntity[] = [];
  let inside = false;
  let current: RawEntity | null = null;

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];

    if (pair.code === 0 && pair.value === 'SECTION') {
      const next = pairs[i + 1];
      inside = next?.code === 2 && next.value === name;
      continue;
    }
    if (pair.code === 0 && pair.value === 'ENDSEC') {
      if (current) entities.push(current);
      current = null;
      inside = false;
      continue;
    }
    if (!inside) continue;

    if (pair.code === 0) {
      if (current) entities.push(current);
      current = { type: pair.value, pairs: [] };
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  if (current) entities.push(current);
  return entities;
}

/** Mapa nome-do-bloco -> entidades, já com o ponto-base subtraído. */
function readBlocks(pairs: Pair[]): Map<string, { base: Point; entities: RawEntity[] }> {
  const flat = readSection(pairs, 'BLOCKS');
  const blocks = new Map<string, { base: Point; entities: RawEntity[] }>();

  let name: string | null = null;
  let base: Point = { x: 0, y: 0 };
  let bucket: RawEntity[] = [];

  for (const entity of flat) {
    if (entity.type === 'BLOCK') {
      name = str(entity, 2);
      base = { x: num(entity, 10), y: num(entity, 20) };
      bucket = [];
      continue;
    }
    if (entity.type === 'ENDBLK') {
      if (name) blocks.set(name, { base, entities: bucket });
      name = null;
      bucket = [];
      continue;
    }
    if (name) bucket.push(entity);
  }
  return blocks;
}

interface EmitContext {
  polylines: Polyline[];
  ignored: Record<string, number>;
  layers: Set<string>;
  blocks: Map<string, { base: Point; entities: RawEntity[] }>;
  tol: number;
  depth: number;
}

function push(context: EmitContext, points: Point[], closed: boolean, layer: string): void {
  if (points.length < 2) return;
  context.layers.add(layer);
  context.polylines.push({ points, closed, layer });
}

function emitEntity(entity: RawEntity, transform: Transform, context: EmitContext): void {
  const layer = str(entity, 8, '0');
  const map = (points: Point[]): Point[] => points.map((p) => applyTransform(p, transform));
  // A tolerância vale no espaço do bloco; ao inserir escalado, compensa.
  const localTol = context.tol / Math.max(1e-6, Math.abs(transform.scaleX));

  switch (entity.type) {
    case 'LINE': {
      const a: Point = { x: num(entity, 10), y: num(entity, 20) };
      const b: Point = { x: num(entity, 11), y: num(entity, 21) };
      push(context, map([a, b]), false, layer);
      break;
    }

    case 'CIRCLE': {
      const center: Point = { x: num(entity, 10), y: num(entity, 20) };
      const radius = num(entity, 40);
      if (radius > 0) push(context, map(flattenCircle(center, radius, localTol)), true, layer);
      break;
    }

    case 'ARC': {
      const center: Point = { x: num(entity, 10), y: num(entity, 20) };
      const radius = num(entity, 40);
      const start = (num(entity, 50) * Math.PI) / 180;
      const end = (num(entity, 51) * Math.PI) / 180;
      if (radius > 0) push(context, map(flattenArc(center, radius, start, end, localTol)), false, layer);
      break;
    }

    case 'LWPOLYLINE': {
      const result = buildPolylineWithBulges(collectLwVertices(entity), num(entity, 70) & 1, localTol);
      push(context, map(result.points), result.closed, layer);
      break;
    }

    case 'POLYLINE': {
      // POLYLINE clássica: os vértices vêm como entidades VERTEX separadas,
      // já agrupadas em `entity.pairs` pelo pré-processamento de SEQEND.
      const flags = num(entity, 70);
      // 8 = polilinha 3D, 16 = malha 3D, 64 = polyface — nada disso é corte 2D.
      if (flags & (8 | 16 | 64)) {
        count(context, 'POLYLINE (3D)');
        break;
      }
      break;
    }

    case 'ELLIPSE': {
      const center: Point = { x: num(entity, 10), y: num(entity, 20) };
      const majorAxis: Point = { x: num(entity, 11), y: num(entity, 21) };
      const ratio = num(entity, 40, 1);
      const startParam = num(entity, 41, 0);
      const endParam = num(entity, 42, Math.PI * 2);
      const result = flattenEllipse(center, majorAxis, ratio, startParam, endParam, localTol);
      push(context, map(result.points), result.closed, layer);
      break;
    }

    case 'SPLINE': {
      const flags = num(entity, 70);
      const closed = (flags & 1) === 1;
      const degree = Math.max(1, num(entity, 71, 3));
      const controlPoints = pointList(entity, 10, 20);
      const fitPoints = pointList(entity, 11, 21);
      const knots = allNums(entity, 40);
      const weights = allNums(entity, 41);

      if (controlPoints.length >= 2) {
        const points = flattenBSpline(
          controlPoints,
          knots,
          degree,
          weights.length === controlPoints.length ? weights : undefined,
          localTol,
          closed,
        );
        push(context, map(points), closed, layer);
      } else if (fitPoints.length >= 2) {
        // Sem pontos de controle, os pontos de ajuste são a melhor aproximação.
        push(context, map(fitPoints), closed, layer);
      }
      break;
    }

    case 'INSERT': {
      if (context.depth > 8) {
        count(context, 'INSERT (aninhamento excessivo)');
        break;
      }
      const blockName = str(entity, 2);
      const block = context.blocks.get(blockName);
      if (!block) {
        count(context, `INSERT (bloco "${blockName}" ausente)`);
        break;
      }

      const local: Transform = {
        scaleX: num(entity, 41, 1) || 1,
        scaleY: num(entity, 42, 1) || 1,
        rotation: (num(entity, 50, 0) * Math.PI) / 180,
        translateX: num(entity, 10),
        translateY: num(entity, 20),
      };
      const columns = Math.max(1, Math.round(num(entity, 70, 1)));
      const rows = Math.max(1, Math.round(num(entity, 71, 1)));
      const columnSpacing = num(entity, 44, 0);
      const rowSpacing = num(entity, 45, 0);

      context.depth += 1;
      for (let c = 0; c < columns; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const instance: Transform = {
            ...local,
            translateX: local.translateX + c * columnSpacing,
            translateY: local.translateY + r * rowSpacing,
          };
          // O ponto-base do bloco é a origem local das entidades internas.
          const withBase: Transform = {
            ...instance,
            translateX: instance.translateX - block.base.x * instance.scaleX,
            translateY: instance.translateY - block.base.y * instance.scaleY,
          };
          const combined = composeTransform(transform, withBase);
          for (const child of block.entities) {
            emitEntity(child, combined, context);
          }
        }
      }
      context.depth -= 1;
      break;
    }

    case 'POINT':
    case 'SEQEND':
    case 'VERTEX':
      break;

    default:
      if (ANNOTATION_ENTITIES.has(entity.type)) count(context, entity.type);
      else if (entity.type) count(context, entity.type);
      break;
  }
}

function count(context: EmitContext, key: string): void {
  context.ignored[key] = (context.ignored[key] ?? 0) + 1;
}

interface BulgeVertex {
  point: Point;
  bulge: number;
}

/** Lê vértices de LWPOLYLINE preservando a associação vértice -> bulge. */
function collectLwVertices(entity: RawEntity): BulgeVertex[] {
  const vertices: BulgeVertex[] = [];
  for (const pair of entity.pairs) {
    const value = Number.parseFloat(pair.value);
    if (pair.code === 10) {
      vertices.push({ point: { x: Number.isFinite(value) ? value : 0, y: 0 }, bulge: 0 });
    } else if (pair.code === 20 && vertices.length > 0) {
      vertices[vertices.length - 1].point.y = Number.isFinite(value) ? value : 0;
    } else if (pair.code === 42 && vertices.length > 0) {
      vertices[vertices.length - 1].bulge = Number.isFinite(value) ? value : 0;
    }
  }
  return vertices;
}

function buildPolylineWithBulges(
  vertices: BulgeVertex[],
  closedFlag: number,
  tol: number,
): { points: Point[]; closed: boolean } {
  const closed = closedFlag === 1;
  if (vertices.length === 0) return { points: [], closed };

  const points: Point[] = [vertices[0].point];
  const last = closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < last; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    const segment = flattenBulge(current.point, next.point, current.bulge, tol);
    points.push(...segment);
  }

  // Numa polilinha fechada, o último ponto gerado coincide com o primeiro.
  if (closed && points.length > 1) {
    const first = points[0];
    const tail = points[points.length - 1];
    if (Math.hypot(tail.x - first.x, tail.y - first.y) < 1e-9) points.pop();
  }
  return { points, closed };
}

/**
 * Ponto de entrada recomendado: soma ao parse principal as POLYLINE/VERTEX
 * legadas, cujos vértices são entidades irmãs (e não filhas) — formato que o
 * DXF R12 e vários exportadores antigos ainda produzem.
 */
export function parseDxfFile(text: string, options: DxfParseOptions = {}): ParsedDrawing {
  const tol = options.chordTolerance ?? DEFAULT_CHORD_TOLERANCE;
  const base = parseDxf(text, options);
  const legacy = parseLegacyPolylines(text, tol, base.unitScale);

  if (legacy.length === 0) return base;

  const layers = new Set(base.layers);
  for (const polyline of legacy) layers.add(polyline.layer);

  // POLYLINE 3D já foi contabilizada como ignorada; ao recuperar as 2D, remove
  // a contagem para não reportar erro que não existe.
  const ignored = { ...base.ignoredEntities };
  delete ignored['POLYLINE (3D)'];

  return {
    ...base,
    polylines: [...base.polylines, ...legacy],
    layers: [...layers],
    ignoredEntities: ignored,
  };
}

function parseLegacyPolylines(text: string, tol: number, unitScale: number): Polyline[] {
  const pairs = tokenize(text);
  const results: Polyline[] = [];

  let active: { flags: number; layer: string; vertices: BulgeVertex[] } | null = null;
  let currentEntity: RawEntity | null = null;

  const flush = (): void => {
    if (!active) return;
    const is3d = (active.flags & (8 | 16 | 64)) !== 0;
    if (!is3d && active.vertices.length >= 2) {
      const built = buildPolylineWithBulges(active.vertices, active.flags & 1, tol);
      results.push({
        points: built.points.map((p) => ({ x: p.x * unitScale, y: p.y * unitScale })),
        closed: built.closed,
        layer: active.layer,
      });
    }
    active = null;
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (pair.code !== 0) {
      if (currentEntity) currentEntity.pairs.push(pair);
      continue;
    }

    // Fecha a entidade anterior antes de abrir a próxima.
    if (currentEntity?.type === 'POLYLINE') {
      active = {
        flags: num(currentEntity, 70),
        layer: str(currentEntity, 8, '0'),
        vertices: [],
      };
    } else if (currentEntity?.type === 'VERTEX' && active) {
      active.vertices.push({
        point: { x: num(currentEntity, 10), y: num(currentEntity, 20) },
        bulge: num(currentEntity, 42, 0),
      });
    } else if (currentEntity?.type === 'SEQEND') {
      flush();
    }

    currentEntity = { type: pair.value, pairs: [] };
  }

  if (currentEntity?.type === 'VERTEX' && active) {
    active.vertices.push({
      point: { x: num(currentEntity, 10), y: num(currentEntity, 20) },
      bulge: num(currentEntity, 42, 0),
    });
  }
  flush();

  return results;
}
