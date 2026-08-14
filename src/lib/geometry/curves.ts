/**
 * Achatamento de curvas em polilinhas.
 *
 * Todas as funções recebem uma tolerância de corda (`tol`, em mm): a distância
 * máxima permitida entre a curva real e o segmento reto que a aproxima. É esse
 * número que define quantos segmentos cada arco vira — e, por consequência, a
 * precisão do comprimento de corte que vai para o preço.
 */

import type { Point } from './types';

export const DEFAULT_CHORD_TOLERANCE = 0.02; // mm

const TAU = Math.PI * 2;

/** Quantos segmentos são necessários para varrer `sweep` rad num raio `radius`. */
function segmentsForArc(radius: number, sweep: number, tol: number): number {
  const absSweep = Math.abs(sweep);
  if (radius <= tol || !Number.isFinite(radius)) return Math.max(2, Math.ceil(absSweep / 0.2));
  // Erro de sagitta: r * (1 - cos(θ/2)) <= tol  =>  θ <= 2 * acos(1 - tol/r)
  const ratio = 1 - tol / radius;
  const maxStep = ratio <= -1 ? Math.PI : 2 * Math.acos(Math.min(1, Math.max(-1, ratio)));
  return Math.max(2, Math.ceil(absSweep / Math.max(maxStep, 1e-4)));
}

/**
 * Arco por centro/raio/ângulos, no sentido anti-horário de `startAngle` até
 * `endAngle` (radianos). `includeStart` permite emendar arcos numa polilinha
 * existente sem duplicar o ponto de junção.
 */
export function flattenArc(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  tol: number,
  includeStart = true,
): Point[] {
  let sweep = endAngle - startAngle;
  // Normaliza para uma varredura anti-horária positiva.
  while (sweep <= 0) sweep += TAU;
  while (sweep > TAU) sweep -= TAU;

  const steps = segmentsForArc(radius, sweep, tol);
  const points: Point[] = [];
  for (let i = includeStart ? 0 : 1; i <= steps; i += 1) {
    const angle = startAngle + (sweep * i) / steps;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

/** Círculo completo, fechado (o ponto final NÃO repete o inicial). */
export function flattenCircle(center: Point, radius: number, tol: number): Point[] {
  const steps = segmentsForArc(radius, TAU, tol);
  const points: Point[] = [];
  for (let i = 0; i < steps; i += 1) {
    const angle = (TAU * i) / steps;
    points.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Segmento com bulge do DXF (LWPOLYLINE/VERTEX).
 *
 * bulge = tan(θ/4), onde θ é o ângulo incluso do arco. Positivo = anti-horário.
 * Retorna os pontos intermediários (exclui `start`, inclui `end`).
 */
export function flattenBulge(start: Point, end: Point, bulge: number, tol: number): Point[] {
  if (!bulge || Math.abs(bulge) < 1e-10) return [end];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return [end];

  const theta = 4 * Math.atan(bulge);
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));

  // Centro do arco a partir do bulge (identidade padrão do formato DXF).
  const k = (1 - bulge * bulge) / (2 * bulge);
  const center: Point = {
    x: (start.x + end.x) / 2 + ((start.y - end.y) / 2) * k,
    y: (start.y + end.y) / 2 + ((end.x - start.x) / 2) * k,
  };

  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(end.y - center.y, end.x - center.x);

  if (bulge > 0) {
    return flattenArc(center, radius, a0, a1, tol, false);
  }
  // Bulge negativo percorre no sentido horário: gera anti-horário e inverte.
  const reversed = flattenArc(center, radius, a1, a0, tol, true);
  reversed.reverse();
  return reversed.slice(1);
}

/**
 * Elipse do DXF: centro + vetor do semieixo maior (relativo ao centro) +
 * razão eixo menor/maior + parâmetros inicial/final (anomalia excêntrica).
 */
export function flattenEllipse(
  center: Point,
  majorAxis: Point,
  ratio: number,
  startParam: number,
  endParam: number,
  tol: number,
): { points: Point[]; closed: boolean } {
  const majorLen = Math.hypot(majorAxis.x, majorAxis.y);
  const minorLen = majorLen * ratio;
  const rotation = Math.atan2(majorAxis.y, majorAxis.x);

  let sweep = endParam - startParam;
  while (sweep <= 1e-9) sweep += TAU;
  const isFull = Math.abs(sweep - TAU) < 1e-6;

  // Usa o raio maior para dimensionar os passos — é o pior caso de erro.
  const steps = segmentsForArc(Math.max(majorLen, minorLen), sweep, tol);
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  const points: Point[] = [];
  const last = isFull ? steps - 1 : steps;
  for (let i = 0; i <= last; i += 1) {
    const t = startParam + (sweep * i) / steps;
    const ex = majorLen * Math.cos(t);
    const ey = minorLen * Math.sin(t);
    points.push({
      x: center.x + ex * cosR - ey * sinR,
      y: center.y + ex * sinR + ey * cosR,
    });
  }
  return { points, closed: isFull };
}

/** Bézier cúbica adaptativa (usada pelo parser de SVG). */
export function flattenCubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tol: number,
): Point[] {
  // Estimativa grosseira do comprimento pelo polígono de controle define os passos.
  const control =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.max(2, Math.min(256, Math.ceil(Math.sqrt(control / Math.max(tol, 1e-4)) * 1.5)));

  const points: Point[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    points.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
  return points;
}

/** Bézier quadrática — elevada para cúbica e delegada. */
export function flattenQuadraticBezier(p0: Point, p1: Point, p2: Point, tol: number): Point[] {
  const c1: Point = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) };
  const c2: Point = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
  return flattenCubicBezier(p0, c1, c2, p2, tol);
}

/**
 * B-spline NURBS por de Boor. Usado pelo SPLINE do DXF, que é onde a maioria
 * dos parsers simplistas erra: aproximar spline pelo polígono de controle
 * infla o comprimento de corte e, portanto, o preço.
 */
export function flattenBSpline(
  controlPoints: readonly Point[],
  knots: readonly number[],
  degree: number,
  weights: readonly number[] | undefined,
  tol: number,
  closed: boolean,
): Point[] {
  const n = controlPoints.length;
  if (n === 0) return [];
  if (n === 1) return [controlPoints[0]];
  if (degree < 1 || n <= degree) {
    return [...controlPoints];
  }

  // Sem vetor de nós coerente, cai para uma spline uniforme com nós fixos nas pontas.
  let knotVector = knots.length === n + degree + 1 ? [...knots] : uniformClampedKnots(n, degree);

  const domainStart = knotVector[degree];
  const domainEnd = knotVector[n];
  if (!(domainEnd > domainStart)) {
    knotVector = uniformClampedKnots(n, degree);
  }

  const t0 = knotVector[degree];
  const t1 = knotVector[n];

  // Densidade proporcional ao tamanho do polígono de controle vs. tolerância.
  let controlLength = 0;
  for (let i = 1; i < n; i += 1) {
    controlLength += Math.hypot(
      controlPoints[i].x - controlPoints[i - 1].x,
      controlPoints[i].y - controlPoints[i - 1].y,
    );
  }
  const steps = Math.max(
    n * 4,
    Math.min(2000, Math.ceil(Math.sqrt(controlLength / Math.max(tol, 1e-4)) * 4)),
  );

  const points: Point[] = [];
  const lastStep = closed ? steps - 1 : steps;
  for (let i = 0; i <= lastStep; i += 1) {
    const t = t0 + ((t1 - t0) * i) / steps;
    points.push(deBoor(t, controlPoints, knotVector, degree, weights));
  }
  return points;
}

function uniformClampedKnots(n: number, degree: number): number[] {
  const knots: number[] = [];
  const inner = n - degree - 1;
  for (let i = 0; i <= degree; i += 1) knots.push(0);
  for (let i = 1; i <= inner; i += 1) knots.push(i / (inner + 1));
  for (let i = 0; i <= degree; i += 1) knots.push(1);
  return knots;
}

function findSpan(t: number, knots: readonly number[], n: number, degree: number): number {
  if (t >= knots[n]) return n - 1;
  if (t <= knots[degree]) return degree;
  let low = degree;
  let high = n;
  let mid = Math.floor((low + high) / 2);
  while (t < knots[mid] || t >= knots[mid + 1]) {
    if (t < knots[mid]) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

function deBoor(
  t: number,
  controlPoints: readonly Point[],
  knots: readonly number[],
  degree: number,
  weights: readonly number[] | undefined,
): Point {
  const n = controlPoints.length;
  const span = findSpan(t, knots, n, degree);

  // Trabalha em coordenadas homogêneas para suportar NURBS racionais.
  const dx: number[] = [];
  const dy: number[] = [];
  const dw: number[] = [];
  for (let j = 0; j <= degree; j += 1) {
    const index = span - degree + j;
    const w = weights?.[index] ?? 1;
    dx.push(controlPoints[index].x * w);
    dy.push(controlPoints[index].y * w);
    dw.push(w);
  }

  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const i = span - degree + j;
      const denom = knots[i + degree - r + 1] - knots[i];
      const alpha = denom === 0 ? 0 : (t - knots[i]) / denom;
      dx[j] = (1 - alpha) * dx[j - 1] + alpha * dx[j];
      dy[j] = (1 - alpha) * dy[j - 1] + alpha * dy[j];
      dw[j] = (1 - alpha) * dw[j - 1] + alpha * dw[j];
    }
  }

  const w = dw[degree] || 1;
  return { x: dx[degree] / w, y: dy[degree] / w };
}

/** Arco elíptico do SVG (comando A), convertido para a parametrização de centro. */
export function flattenSvgArc(
  start: Point,
  rx: number,
  ry: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweepFlag: boolean,
  end: Point,
  tol: number,
): Point[] {
  if (rx === 0 || ry === 0) return [end];

  let radiusX = Math.abs(rx);
  let radiusY = Math.abs(ry);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (start.x - end.x) / 2;
  const dy2 = (start.y - end.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Aumenta os raios se forem pequenos demais para alcançar o ponto final.
  const lambda = (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    radiusX *= scale;
    radiusY *= scale;
  }

  const sign = largeArc === sweepFlag ? -1 : 1;
  const numerator =
    radiusX * radiusX * radiusY * radiusY -
    radiusX * radiusX * y1p * y1p -
    radiusY * radiusY * x1p * x1p;
  const denominator = radiusX * radiusX * y1p * y1p + radiusY * radiusY * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = (coefficient * radiusX * y1p) / radiusY;
  const cyp = (-coefficient * radiusY * x1p) / radiusX;
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;

  const angleOf = (ux: number, uy: number): number => Math.atan2(uy, ux);
  const theta1 = angleOf((x1p - cxp) / radiusX, (y1p - cyp) / radiusY);
  let deltaTheta =
    angleOf((-x1p - cxp) / radiusX, (-y1p - cyp) / radiusY) - theta1;

  if (!sweepFlag && deltaTheta > 0) deltaTheta -= TAU;
  else if (sweepFlag && deltaTheta < 0) deltaTheta += TAU;

  const steps = segmentsForArc(Math.max(radiusX, radiusY), deltaTheta, tol);
  const points: Point[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const theta = theta1 + (deltaTheta * i) / steps;
    const ex = radiusX * Math.cos(theta);
    const ey = radiusY * Math.sin(theta);
    points.push({
      x: cosPhi * ex - sinPhi * ey + cx,
      y: sinPhi * ex + cosPhi * ey + cy,
    });
  }
  return points;
}
