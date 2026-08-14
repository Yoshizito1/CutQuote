/**
 * Parser SVG.
 *
 * Existe para quem não tem CAD: Illustrator, Inkscape e Figma exportam SVG
 * limpo. Cobre `path` (todos os comandos), `rect`, `circle`, `ellipse`,
 * `line`, `polyline` e `polygon`, com `transform` acumulado.
 *
 * Diferença crítica em relação ao DXF: o eixo Y do SVG aponta para BAIXO.
 * O parser inverte Y para manter a convenção CAD do resto do sistema.
 */

import {
  DEFAULT_CHORD_TOLERANCE,
  flattenCubicBezier,
  flattenQuadraticBezier,
  flattenSvgArc,
} from './curves';
import type { ParsedDrawing, Point, Polyline } from './types';

/** Matriz afim [a b c d e f], igual à do SVG. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function parseTransform(value: string): Matrix {
  let matrix = IDENTITY;
  const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match = pattern.exec(value);

  while (match !== null) {
    const args = match[2]
      .split(/[\s,]+/)
      .map((n) => Number.parseFloat(n))
      .filter((n) => Number.isFinite(n));

    switch (match[1]) {
      case 'matrix':
        if (args.length >= 6) {
          matrix = multiply(matrix, [args[0], args[1], args[2], args[3], args[4], args[5]]);
        }
        break;
      case 'translate':
        matrix = multiply(matrix, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0]);
        break;
      case 'scale':
        matrix = multiply(matrix, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]);
        break;
      case 'rotate': {
        const angle = ((args[0] ?? 0) * Math.PI) / 180;
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        matrix = multiply(matrix, [1, 0, 0, 1, cx, cy]);
        matrix = multiply(matrix, [cos, sin, -sin, cos, 0, 0]);
        matrix = multiply(matrix, [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        matrix = multiply(matrix, [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0]);
        break;
      case 'skewY':
        matrix = multiply(matrix, [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]);
        break;
    }
    match = pattern.exec(value);
  }
  return matrix;
}

/** Converte um comprimento SVG com unidade para px (base do viewport). */
function lengthToPx(raw: string | null): number | null {
  if (!raw) return null;
  const match = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*(px|pt|pc|mm|cm|in|%)?\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  switch ((match[2] ?? 'px').toLowerCase()) {
    case 'mm':
      return (value * 96) / 25.4;
    case 'cm':
      return (value * 96) / 2.54;
    case 'in':
      return value * 96;
    case 'pt':
      return (value * 96) / 72;
    case 'pc':
      return value * 16;
    case '%':
      return null; // Percentual sem contexto não define escala física.
    default:
      return value;
  }
}

export interface SvgParseOptions {
  chordTolerance?: number;
}

export function parseSvg(text: string, options: SvgParseOptions = {}): ParsedDrawing {
  const tol = options.chordTolerance ?? DEFAULT_CHORD_TOLERANCE;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('SVG inválido: não foi possível interpretar o XML.');

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    throw new Error('SVG inválido: elemento <svg> não encontrado.');
  }

  // Escala de usuário -> mm. Se houver width/height físicos + viewBox, o SVG
  // declara um tamanho real; senão assume-se 96 dpi (padrão CSS).
  const scale = resolveUserUnitToMm(root);

  const collected: Polyline[] = [];
  const layers = new Set<string>();
  const ignored: Record<string, number> = {};

  const walk = (element: Element, inherited: Matrix, layer: string): void => {
    const transformAttr = element.getAttribute('transform');
    const matrix = transformAttr ? multiply(inherited, parseTransform(transformAttr)) : inherited;

    const tag = element.nodeName.toLowerCase();
    const currentLayer =
      tag === 'g' ? element.getAttribute('inkscape:label') ?? element.getAttribute('id') ?? layer : layer;

    const emit = (points: Point[], closed: boolean): void => {
      if (points.length < 2) return;
      layers.add(currentLayer);
      collected.push({
        // Y invertido: SVG cresce para baixo, geometria de corte cresce para cima.
        points: points.map((p) => {
          const t = apply(matrix, p);
          return { x: t.x * scale, y: -t.y * scale };
        }),
        closed,
        layer: currentLayer,
      });
    };

    switch (tag) {
      case 'path': {
        const d = element.getAttribute('d');
        if (d) for (const sub of parsePathData(d, tol / scale)) emit(sub.points, sub.closed);
        break;
      }
      case 'rect': {
        const x = Number.parseFloat(element.getAttribute('x') ?? '0') || 0;
        const y = Number.parseFloat(element.getAttribute('y') ?? '0') || 0;
        const w = Number.parseFloat(element.getAttribute('width') ?? '0') || 0;
        const h = Number.parseFloat(element.getAttribute('height') ?? '0') || 0;
        const rx = Number.parseFloat(element.getAttribute('rx') ?? '0') || 0;
        const ry = Number.parseFloat(element.getAttribute('ry') ?? String(rx)) || rx;
        if (w > 0 && h > 0) emit(buildRect(x, y, w, h, rx, ry, tol / scale), true);
        break;
      }
      case 'circle': {
        const cx = Number.parseFloat(element.getAttribute('cx') ?? '0') || 0;
        const cy = Number.parseFloat(element.getAttribute('cy') ?? '0') || 0;
        const r = Number.parseFloat(element.getAttribute('r') ?? '0') || 0;
        if (r > 0) emit(buildEllipse(cx, cy, r, r, tol / scale), true);
        break;
      }
      case 'ellipse': {
        const cx = Number.parseFloat(element.getAttribute('cx') ?? '0') || 0;
        const cy = Number.parseFloat(element.getAttribute('cy') ?? '0') || 0;
        const rx = Number.parseFloat(element.getAttribute('rx') ?? '0') || 0;
        const ry = Number.parseFloat(element.getAttribute('ry') ?? '0') || 0;
        if (rx > 0 && ry > 0) emit(buildEllipse(cx, cy, rx, ry, tol / scale), true);
        break;
      }
      case 'line': {
        const x1 = Number.parseFloat(element.getAttribute('x1') ?? '0') || 0;
        const y1 = Number.parseFloat(element.getAttribute('y1') ?? '0') || 0;
        const x2 = Number.parseFloat(element.getAttribute('x2') ?? '0') || 0;
        const y2 = Number.parseFloat(element.getAttribute('y2') ?? '0') || 0;
        emit([{ x: x1, y: y1 }, { x: x2, y: y2 }], false);
        break;
      }
      case 'polyline':
      case 'polygon': {
        const points = parseNumberList(element.getAttribute('points') ?? '');
        const parsed: Point[] = [];
        for (let i = 0; i + 1 < points.length; i += 2) {
          parsed.push({ x: points[i], y: points[i + 1] });
        }
        emit(parsed, tag === 'polygon');
        break;
      }
      case 'text':
      case 'image':
      case 'use':
        ignored[tag] = (ignored[tag] ?? 0) + 1;
        break;
    }

    for (const child of Array.from(element.children)) walk(child, matrix, currentLayer);
  };

  walk(root, IDENTITY, 'default');

  return {
    polylines: collected,
    sourceUnit: 'mm',
    unitScale: scale,
    layers: [...layers],
    ignoredEntities: ignored,
    format: 'svg',
  };
}

/** Fator que converte uma unidade de usuário do SVG em milímetros. */
function resolveUserUnitToMm(root: Element): number {
  const pxPerMm = 96 / 25.4;
  const widthPx = lengthToPx(root.getAttribute('width'));
  const viewBox = parseNumberList(root.getAttribute('viewBox') ?? '');

  if (widthPx !== null && viewBox.length === 4 && viewBox[2] > 0) {
    // width física / largura do viewBox = px por unidade de usuário.
    return widthPx / viewBox[2] / pxPerMm;
  }
  return 1 / pxPerMm;
}

function parseNumberList(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .map((n) => Number.parseFloat(n))
    .filter((n) => Number.isFinite(n));
}

function buildRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
  tol: number,
): Point[] {
  const cornerX = Math.min(rx, w / 2);
  const cornerY = Math.min(ry, h / 2);
  if (cornerX <= 0 || cornerY <= 0) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }

  const steps = Math.max(4, Math.ceil(Math.PI / 2 / Math.max(0.05, Math.sqrt(tol / Math.max(cornerX, 1e-6)))));
  const corner = (cx: number, cy: number, from: number): Point[] => {
    const arc: Point[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const angle = from + (Math.PI / 2) * (i / steps);
      arc.push({ x: cx + cornerX * Math.cos(angle), y: cy + cornerY * Math.sin(angle) });
    }
    return arc;
  };

  return [
    ...corner(x + w - cornerX, y + cornerY, -Math.PI / 2),
    ...corner(x + w - cornerX, y + h - cornerY, 0),
    ...corner(x + cornerX, y + h - cornerY, Math.PI / 2),
    ...corner(x + cornerX, y + cornerY, Math.PI),
  ];
}

function buildEllipse(cx: number, cy: number, rx: number, ry: number, tol: number): Point[] {
  const radius = Math.max(rx, ry);
  const ratio = 1 - tol / radius;
  const maxStep = ratio <= -1 ? Math.PI : 2 * Math.acos(Math.min(1, Math.max(-1, ratio)));
  const steps = Math.max(8, Math.ceil((Math.PI * 2) / Math.max(maxStep, 1e-4)));

  const points: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (Math.PI * 2 * i) / steps;
    points.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return points;
}

interface SubPath {
  points: Point[];
  closed: boolean;
}

/** Interpreta o atributo `d`, incluindo formas compactas e comandos relativos. */
function parsePathData(d: string, tol: number): SubPath[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\.?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? [];

  const subPaths: SubPath[] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let subPathStart: Point = { x: 0, y: 0 };
  let lastCubicControl: Point | null = null;
  let lastQuadControl: Point | null = null;
  let command = '';
  let index = 0;

  const nextNumber = (): number => {
    const value = Number.parseFloat(tokens[index++] ?? '0');
    return Number.isFinite(value) ? value : 0;
  };
  const finish = (closed: boolean): void => {
    if (current.length >= 2) subPaths.push({ points: current, closed });
    current = [];
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(token)) {
      command = token;
      index += 1;
    } else if (command === 'M') {
      command = 'L'; // Coordenadas extras após M são tratadas como L.
    } else if (command === 'm') {
      command = 'l';
    }

    const relative = command === command.toLowerCase();
    const base = relative ? cursor : { x: 0, y: 0 };

    switch (command.toUpperCase()) {
      case 'M': {
        finish(false);
        cursor = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        subPathStart = { ...cursor };
        current = [{ ...cursor }];
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'L': {
        cursor = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        current.push({ ...cursor });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'H': {
        cursor = { x: base.x + nextNumber(), y: cursor.y };
        current.push({ ...cursor });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'V': {
        cursor = { x: cursor.x, y: base.y + nextNumber() };
        current.push({ ...cursor });
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      case 'C': {
        const c1 = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const c2 = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const end = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        current.push(...flattenCubicBezier(cursor, c1, c2, end, tol));
        lastCubicControl = c2;
        lastQuadControl = null;
        cursor = end;
        break;
      }
      case 'S': {
        const reflected = lastCubicControl
          ? { x: 2 * cursor.x - lastCubicControl.x, y: 2 * cursor.y - lastCubicControl.y }
          : { ...cursor };
        const c2 = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const end = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        current.push(...flattenCubicBezier(cursor, reflected, c2, end, tol));
        lastCubicControl = c2;
        lastQuadControl = null;
        cursor = end;
        break;
      }
      case 'Q': {
        const c1 = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const end = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        current.push(...flattenQuadraticBezier(cursor, c1, end, tol));
        lastQuadControl = c1;
        lastCubicControl = null;
        cursor = end;
        break;
      }
      case 'T': {
        // Anotado explicitamente: `lastQuadControl` recebe este valor logo
        // abaixo, e sem o tipo o TS entra em inferência circular.
        const reflected: Point = lastQuadControl
          ? { x: 2 * cursor.x - lastQuadControl.x, y: 2 * cursor.y - lastQuadControl.y }
          : { ...cursor };
        const end = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        current.push(...flattenQuadraticBezier(cursor, reflected, end, tol));
        lastQuadControl = reflected;
        lastCubicControl = null;
        cursor = end;
        break;
      }
      case 'A': {
        const rx = nextNumber();
        const ry = nextNumber();
        const rotation = nextNumber();
        const largeArc = nextNumber() !== 0;
        const sweep = nextNumber() !== 0;
        const end = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        current.push(...flattenSvgArc(cursor, rx, ry, rotation, largeArc, sweep, end, tol));
        lastCubicControl = null;
        lastQuadControl = null;
        cursor = end;
        break;
      }
      case 'Z': {
        finish(true);
        cursor = { ...subPathStart };
        current = [{ ...cursor }];
        lastCubicControl = null;
        lastQuadControl = null;
        break;
      }
      default:
        index += 1;
        break;
    }
  }

  finish(false);
  // Um subcaminho residual de 1 ponto (deixado por um Z final) não é geometria.
  return subPaths.filter((sub) => sub.points.length >= 2);
}
