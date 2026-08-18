/**
 * Construção da malha 3D a partir do modelo dobrado.
 *
 * Vive na camada de componentes, e não em `lib/geometry`, porque importa
 * Three.js — e o solver precisa continuar rodando em Node para os testes. A
 * fronteira é o `FoldedModel`: ele já traz faces posicionadas e arcos
 * parametrizados, então aqui não se recalcula geometria, só se tesela.
 *
 * Referencial vertical: a superfície NEUTRA está em z = 0 no espaço local de
 * cada face. O material ocupa de −(1−K)·t (face externa) a +K·t (face interna),
 * que é exatamente onde os arcos das dobras chegam.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Matrix4,
  Path,
  Shape,
  Vector2,
} from 'three';

import type { FoldPatch, FoldedModel, Mat4 } from '@/lib/geometry/fold';
import type { Point } from '@/lib/geometry';

/** Passo angular da teselagem do arco, em graus. */
const ARC_STEP_DEG = 4;

function toMatrix4(m: Mat4): Matrix4 {
  const matrix = new Matrix4();
  matrix.fromArray(m as number[]);
  return matrix;
}

function toShape(outline: readonly Point[], holes: readonly Point[][]): Shape {
  const shape = new Shape(outline.map((p) => new Vector2(p.x, p.y)));
  for (const hole of holes) {
    shape.holes.push(new Path(hole.map((p) => new Vector2(p.x, p.y))));
  }
  return shape;
}

export interface FoldMeshResult {
  /** Geometrias já posicionadas no espaço; some-se todas para ver a peça. */
  geometries: BufferGeometry[];
  /** Centro da caixa envolvente, para enquadrar a câmera. */
  center: [number, number, number];
  /** Maior dimensão, para escolher a distância da câmera. */
  span: number;
}

/**
 * Gera a malha da peça dobrada.
 *
 * `kFactor` precisa ser o mesmo usado no solver — é ele que define onde a
 * superfície neutra fica dentro da espessura, e portanto se as faces encostam
 * nos arcos ou flutuam.
 */
export function buildFoldMesh(model: FoldedModel, kFactor: number): FoldMeshResult {
  const geometries: BufferGeometry[] = [];
  const t = model.thickness;
  const belowNeutral = (1 - kFactor) * t;

  for (const face of model.faces) {
    if (face.outline.length < 3) continue;

    const geometry = new ExtrudeGeometry(toShape(face.outline, face.holes), {
      depth: t,
      bevelEnabled: false,
      curveSegments: 1,
    });

    // ExtrudeGeometry sai de z = 0 a z = t; desce para a neutra ficar em zero.
    geometry.translate(0, 0, -belowNeutral);
    geometry.applyMatrix4(toMatrix4(face.transform));
    geometry.computeVertexNormals();
    geometries.push(geometry);
  }

  for (const patch of model.patches) {
    const geometry = buildPatchGeometry(patch, t, kFactor);
    if (geometry) geometries.push(geometry);
  }

  return frame(geometries);
}

/**
 * Faixa cilíndrica de uma dobra.
 *
 * Construída como uma casca de dois raios (interno e externo) varrida ao longo
 * do eixo. As pontas em φ = 0 e φ = θ ficam abertas de propósito: é onde as
 * faces encostam, e tampá-las criaria superfície interna visível.
 */
function buildPatchGeometry(
  patch: FoldPatch,
  thickness: number,
  kFactor: number,
): BufferGeometry | null {
  const angleRad = (patch.angleDeg * Math.PI) / 180;
  if (angleRad <= 1e-6) return null;

  const span = patch.spanEnd - patch.spanStart;
  if (Math.abs(span) < 1e-9) return null;

  const steps = Math.max(2, Math.ceil(patch.angleDeg / ARC_STEP_DEG));
  const rho = patch.neutralRadius;
  const rInner = rho - kFactor * thickness;
  const rOuter = rInner + thickness;
  const orientation = patch.orientation;

  const d = patch.axisDirection;
  const u = patch.toChild;
  const halfAllowance = patch.allowance / 2;

  const positions: number[] = [];
  const indices: number[] = [];

  // Para cada passo do arco, dois pontos ao longo do eixo, em dois raios.
  // Ordem dos vértices: [i][j][r] -> índice ((i * 2) + j) * 2 + r
  for (let i = 0; i <= steps; i += 1) {
    const phi = (angleRad * i) / steps;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);

    for (let j = 0; j <= 1; j += 1) {
      const s = j === 0 ? patch.spanStart : patch.spanEnd;
      // Tangente onde a face pai termina, deslocada ao longo do eixo.
      const tx = patch.axisOrigin.x + d.x * s - u.x * halfAllowance;
      const ty = patch.axisOrigin.y + d.y * s - u.y * halfAllowance;

      for (const r of [rInner, rOuter]) {
        positions.push(
          tx + u.x * r * sin,
          ty + u.y * r * sin,
          orientation * (rho - r * cos),
        );
      }
    }
  }

  const at = (i: number, j: number, r: 0 | 1): number => (i * 2 + j) * 2 + r;

  for (let i = 0; i < steps; i += 1) {
    // Superfície interna e externa.
    for (const r of [0, 1] as const) {
      const a = at(i, 0, r);
      const b = at(i, 1, r);
      const c = at(i + 1, 0, r);
      const e = at(i + 1, 1, r);
      // Winding invertido na face interna para as normais apontarem para fora.
      if (r === 1) indices.push(a, b, c, b, e, c);
      else indices.push(a, c, b, b, c, e);
    }

    // Bordas laterais da faixa (as duas pontas ao longo do eixo).
    for (const j of [0, 1] as const) {
      const a = at(i, j, 0);
      const b = at(i, j, 1);
      const c = at(i + 1, j, 0);
      const e = at(i + 1, j, 1);
      if (j === 0) indices.push(a, b, c, b, e, c);
      else indices.push(a, c, b, b, c, e);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.applyMatrix4(toMatrix4(patch.transform));
  geometry.computeVertexNormals();
  return geometry;
}

function frame(geometries: readonly BufferGeometry[]): FoldMeshResult {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) continue;
    minX = Math.min(minX, box.min.x);
    minY = Math.min(minY, box.min.y);
    minZ = Math.min(minZ, box.min.z);
    maxX = Math.max(maxX, box.max.x);
    maxY = Math.max(maxY, box.max.y);
    maxZ = Math.max(maxZ, box.max.z);
  }

  if (!Number.isFinite(minX)) {
    return { geometries: [...geometries], center: [0, 0, 0], span: 100 };
  }

  return {
    geometries: [...geometries],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
  };
}

/** Libera as geometrias ao trocar de peça — WebGL não coleta sozinho. */
export function disposeMesh(result: FoldMeshResult | null): void {
  if (!result) return;
  for (const geometry of result.geometries) geometry.dispose();
}
