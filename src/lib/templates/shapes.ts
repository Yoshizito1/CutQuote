/**
 * Primitivas de forma para os templates paramétricos.
 *
 * Todas devolvem anéis fechados no sentido anti-horário, em milímetros, já
 * achatados com a mesma tolerância de corda usada pelos parsers — assim uma
 * peça gerada por template e a mesma peça vinda de um DXF são cobradas igual.
 */

import { DEFAULT_CHORD_TOLERANCE } from '../geometry/curves';
import type { Point } from '../geometry/types';

const TAU = Math.PI * 2;

function arcPoints(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  tol: number,
): Point[] {
  const sweep = to - from;
  const ratio = 1 - tol / Math.max(radius, 1e-6);
  const maxStep = ratio <= -1 ? Math.PI : 2 * Math.acos(Math.min(1, Math.max(-1, ratio)));
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(maxStep, 1e-4)));

  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + (sweep * i) / steps;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/** Círculo fechado (o último ponto não repete o primeiro). */
export function circleRing(
  cx: number,
  cy: number,
  radius: number,
  tol = DEFAULT_CHORD_TOLERANCE,
): Point[] {
  const ratio = 1 - tol / Math.max(radius, 1e-6);
  const maxStep = ratio <= -1 ? Math.PI : 2 * Math.acos(Math.min(1, Math.max(-1, ratio)));
  const steps = Math.max(12, Math.ceil(TAU / Math.max(maxStep, 1e-4)));

  const points: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (TAU * i) / steps;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/**
 * Retângulo com cantos arredondados, canto inferior esquerdo em (x, y).
 * Raio 0 produz cantos vivos.
 */
export function roundedRectRing(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  tol = DEFAULT_CHORD_TOLERANCE,
): Point[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));

  if (r < 1e-6) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }

  return [
    ...arcPoints(x + width - r, y + r, r, -Math.PI / 2, 0, tol),
    ...arcPoints(x + width - r, y + height - r, r, 0, Math.PI / 2, tol),
    ...arcPoints(x + r, y + height - r, r, Math.PI / 2, Math.PI, tol),
    ...arcPoints(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2, tol),
  ];
}

/**
 * Rasgo oblongo (obround): dois semicírculos ligados por retas.
 * `length` é a distância entre centros; a largura total é `length + width`.
 */
export function slotRing(
  cx: number,
  cy: number,
  centerDistance: number,
  width: number,
  angleRad = 0,
  tol = DEFAULT_CHORD_TOLERANCE,
): Point[] {
  const r = width / 2;
  const half = centerDistance / 2;

  const local = [
    ...arcPoints(half, 0, r, -Math.PI / 2, Math.PI / 2, tol),
    ...arcPoints(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2, tol),
  ];

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return local.map((point) => ({
    x: cx + point.x * cos - point.y * sin,
    y: cy + point.x * sin + point.y * cos,
  }));
}

/** Polígono regular de `sides` lados inscrito num círculo de raio `radius`. */
export function regularPolygonRing(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotationRad = 0,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotationRad + (TAU * i) / sides;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/** Furos distribuídos em círculo de furação (bolt circle). */
export function boltCircle(
  cx: number,
  cy: number,
  boltCircleDiameter: number,
  count: number,
  holeDiameter: number,
  startAngleRad = 0,
  tol = DEFAULT_CHORD_TOLERANCE,
): Point[][] {
  const radius = boltCircleDiameter / 2;
  const rings: Point[][] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = startAngleRad + (TAU * i) / count;
    rings.push(
      circleRing(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), holeDiameter / 2, tol),
    );
  }
  return rings;
}

/**
 * Malha de furos dentro de uma área, com passo fixo.
 *
 * `staggered` alterna as linhas em meio passo — é o padrão de painel perfurado,
 * que aproveita melhor a área e distribui melhor a tensão na chapa.
 */
export function holeGrid(
  area: { x: number; y: number; width: number; height: number },
  pitchX: number,
  pitchY: number,
  holeDiameter: number,
  staggered: boolean,
  tol = DEFAULT_CHORD_TOLERANCE,
): Point[][] {
  const rings: Point[][] = [];
  const radius = holeDiameter / 2;
  if (pitchX <= 0 || pitchY <= 0 || radius <= 0) return rings;

  const rows = Math.floor(area.height / pitchY) + 1;
  const columns = Math.floor(area.width / pitchX) + 1;

  // Centraliza a malha na área disponível.
  const usedWidth = (columns - 1) * pitchX;
  const usedHeight = (rows - 1) * pitchY;
  const originX = area.x + (area.width - usedWidth) / 2;
  const originY = area.y + (area.height - usedHeight) / 2;

  for (let row = 0; row < rows; row += 1) {
    const offset = staggered && row % 2 === 1 ? pitchX / 2 : 0;
    for (let column = 0; column < columns; column += 1) {
      const cx = originX + column * pitchX + offset;
      const cy = originY + row * pitchY;
      // A linha deslocada estoura a área pela direita; descarta o furo que sai.
      if (cx + radius > area.x + area.width) continue;
      rings.push(circleRing(cx, cy, radius, tol));
    }
  }
  return rings;
}

/** Furos igualmente espaçados ao longo de uma linha. */
export function linearHoles(
  from: Point,
  to: Point,
  count: number,
  holeDiameter: number,
  tol = DEFAULT_CHORD_TOLERANCE,
): Point[][] {
  if (count < 1) return [];
  const rings: Point[][] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    rings.push(
      circleRing(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, holeDiameter / 2, tol),
    );
  }
  return rings;
}

/**
 * Desenvolvimento de dobra (bend allowance).
 *
 * Comprimento planificado = A + B − dedução de dobra, onde a dedução vem do
 * fator K, que descreve onde fica a linha neutra dentro da espessura. Sem isso
 * a peça sai maior que o projeto depois de dobrada.
 */
export function bendDeduction(
  thickness: number,
  innerRadius: number,
  angleDeg: number,
  kFactor: number,
): { allowance: number; deduction: number; setback: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  const allowance = angleRad * (innerRadius + kFactor * thickness);
  const setback = (innerRadius + thickness) * Math.tan(angleRad / 2);
  return { allowance, deduction: 2 * setback - allowance, setback };
}

/** Move um anel. */
export function translateRing(ring: readonly Point[], dx: number, dy: number): Point[] {
  return ring.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}
