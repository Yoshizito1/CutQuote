/**
 * Matrizes 4x4 rígidas em ordem de coluna.
 *
 * Implementadas aqui, e não importadas do Three.js, porque a camada de
 * geometria precisa rodar em Node para os testes. São só as três operações que
 * a dobra usa: identidade, produto e rotação em torno de um eixo arbitrário.
 *
 * Índices em ordem de coluna (WebGL):
 *   m[0] m[4] m[8]  m[12]
 *   m[1] m[5] m[9]  m[13]
 *   m[2] m[6] m[10] m[14]
 *   m[3] m[7] m[11] m[15]
 */

import type { Point } from '../types';
import type { Mat4 } from './types';

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * Rotação de `angleRad` em torno da reta que passa por `origin` com direção
 * `direction` (direção no plano; a reta pode estar fora de z = 0).
 *
 * O `originZ` é essencial e não decorativo: o eixo de rotação da dobra é a
 * linha de CENTRO DO ARCO, que fica a um raio neutro acima ou abaixo da chapa —
 * nunca sobre a linha desenhada no DXF. Girar em torno da linha desenhada
 * afasta a aba da tangente do arco e alonga a peça.
 */
export function rotationAboutLine(
  origin: Point,
  direction: Point,
  angleRad: number,
  originZ = 0,
): Mat4 {
  const length = Math.hypot(direction.x, direction.y);
  if (length < 1e-12) return IDENTITY;

  const ux = direction.x / length;
  const uy = direction.y / length;
  const uz = 0;

  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const t = 1 - c;

  // Rotação pura (Rodrigues), em ordem de coluna.
  const r: number[] = [
    t * ux * ux + c,
    t * ux * uy + s * uz,
    t * ux * uz - s * uy,
    0,

    t * ux * uy - s * uz,
    t * uy * uy + c,
    t * uy * uz + s * ux,
    0,

    t * ux * uz + s * uy,
    t * uy * uz - s * ux,
    t * uz * uz + c,
    0,

    0,
    0,
    0,
    1,
  ];

  // Leva o eixo à origem, gira, e devolve.
  return multiply(
    translation(origin.x, origin.y, originZ),
    multiply(r, translation(-origin.x, -origin.y, -originZ)),
  );
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function applyToPoint(m: Mat4, p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

/** Aplica a um ponto do plano do flat (z = 0). */
export function applyToFlatPoint(m: Mat4, p: Point): Vec3 {
  return applyToPoint(m, { x: p.x, y: p.y, z: 0 });
}
