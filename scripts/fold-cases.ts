/**
 * Casos de teste do solver de dobra (passos 1–4: eixo, validação, partição,
 * árvore). Nenhum toca em Three.js — o solver roda em Node de propósito.
 */

import { analyzeDrawing } from '../src/lib/geometry/analyze';
import { bendDeduction } from '../src/lib/geometry/bend-allowance';
import { parseDxfFile } from '../src/lib/geometry/dxf';
import { extractAxes } from '../src/lib/geometry/fold/axis';
import { applyToFlatPoint } from '../src/lib/geometry/fold/matrix';
import { solveFold } from '../src/lib/geometry/fold/solver';
import type { BendConfig, FoldedModel } from '../src/lib/geometry/fold/types';
import type { Loop, Point } from '../src/lib/geometry/types';
import { buildDxf, line, lineWithLinetype, lwpolyline, rectangleAsLines } from './fixtures';

export interface Harness {
  check: (name: string, actual: number, expected: number, tolerance: number) => void;
  checkTrue: (name: string, condition: boolean, detail?: string) => void;
  section: (title: string) => void;
}

const T = 2;
const R = 2;
const K = 0.44;
const { allowance } = bendDeduction(T, R, 90, K);

function config(axisId: string, angleDeg = 90, direction: 'up' | 'down' = 'up'): BendConfig {
  return { axisId, angleDeg, direction, innerRadius: R, kFactor: K };
}

/** Roda o pipeline completo: DXF → peça → eixos → dobra. */
function fold(dxf: string, configs: (ids: string[]) => BendConfig[]): {
  model: FoldedModel;
  axisIds: string[];
  warnings: string[];
} {
  const geometry = analyzeDrawing(parseDxfFile(dxf), { bendLayers: ['DOBRA'], etchLayers: [] });
  const outer = geometry.loops.filter((loop: Loop) => loop.depth % 2 === 0);
  const extraction = extractAxes(geometry.bendLines, outer);

  const outline = outer.find((loop) => loop.depth === 0)?.points ?? [];
  const holes = geometry.loops.filter((loop) => loop.depth % 2 === 1).map((loop) => loop.points);
  const axisIds = extraction.axes.map((axis) => axis.id);

  const model = solveFold({
    thickness: T,
    outline,
    holes,
    axes: extraction.axes,
    configs: configs(axisIds),
  });

  return {
    model,
    axisIds,
    warnings: [...extraction.warnings, ...model.warnings].map((w) => `${w.severity}: ${w.title}`),
  };
}

/** Caixa envolvente 3D da superfície neutra, após as transformadas. */
function foldedBounds(model: FoldedModel) {
  const bounds = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  for (const face of model.faces) {
    for (const point of face.outline as Point[]) {
      const p = applyToFlatPoint(face.transform, point);
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxY = Math.max(bounds.maxY, p.y);
      bounds.minZ = Math.min(bounds.minZ, p.z);
      bounds.maxZ = Math.max(bounds.maxZ, p.z);
    }
  }
  return bounds;
}

function faceLengthAlongX(model: FoldedModel, faceId: number): number {
  const face = model.faces[faceId];
  const xs = (face.outline as Point[]).map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

export function runFoldCases({ check, checkTrue, section }: Harness): void {
  const { deduction } = bendDeduction(T, R, 90, K);
  const flat = 60 + 40 - deduction;
  const bendAt = 60 - deduction / 2;

  // --- Cantoneira: o caso que prova a transformada ------------------------
  section('35. Cantoneira 60+40 dobrada a 90° recupera as medidas de projeto');
  {
    const { model, warnings } = fold(
      buildDxf([
        ...rectangleAsLines(flat, 50),
        ...line(bendAt, 0, bendAt, 50, 'DOBRA'),
      ]),
      (ids) => ids.map((id) => config(id)),
    );

    checkTrue('sem bloqueio', model.ok, warnings.join(' | '));
    check('faces', model.faces.length, 2, 0);
    check('dobras aplicadas', model.patches.length, 1, 0);
    check('arestas da árvore', model.tree.filter((n) => n.parent !== null).length, 1, 0);

    // Conservação de comprimento na superfície neutra: face + arco + face tem
    // de dar exatamente o plano. É a garantia de que nada foi criado nem perdido.
    const faceA = faceLengthAlongX(model, model.rootFace);
    const faceB = faceLengthAlongX(model, model.rootFace === 0 ? 1 : 0);
    check('face maior aparada (mm)', faceA, 56, 0.001);
    check('face menor aparada (mm)', faceB, 36, 0.001);
    check('face + arco + face = plano', faceA + allowance + faceB, flat, 0.001);

    // A prova final: as medidas EXTERNAS da peça dobrada.
    const bounds = foldedBounds(model);
    const outerOffset = (1 - K) * T; // da superfície neutra à face externa
    check('extensão X externa (mm)', bounds.maxX + outerOffset, 60, 0.002);
    check('extensão Z externa (mm)', bounds.maxZ + outerOffset, 40, 0.002);

    checkTrue(
      'a peça dobrada é MENOR que o plano',
      bounds.maxX < flat - 30,
      `maxX=${bounds.maxX.toFixed(2)} plano=${flat.toFixed(2)}`,
    );
  }

  // --- Direção -------------------------------------------------------------
  section('36. Direção up/down inverte o sinal em Z');
  {
    const dxf = buildDxf([
      ...rectangleAsLines(flat, 50),
      ...line(bendAt, 0, bendAt, 50, 'DOBRA'),
    ]);

    const up = foldedBounds(fold(dxf, (ids) => ids.map((id) => config(id, 90, 'up'))).model);
    const down = foldedBounds(fold(dxf, (ids) => ids.map((id) => config(id, 90, 'down'))).model);

    checkTrue('up sobe', up.maxZ > 1 && Math.abs(up.minZ) < 1e-6, `maxZ=${up.maxZ}`);
    checkTrue('down desce', down.minZ < -1 && Math.abs(down.maxZ) < 1e-6, `minZ=${down.minZ}`);
    check('mesma altura, sinal oposto', up.maxZ, -down.minZ, 0.001);
  }

  // --- Ângulo 0 ------------------------------------------------------------
  section('37. Ângulo zero mantém a peça plana');
  {
    const { model } = fold(
      buildDxf([
        ...rectangleAsLines(flat, 50),
        ...line(bendAt, 0, bendAt, 50, 'DOBRA'),
      ]),
      (ids) => ids.map((id) => config(id, 0)),
    );
    const bounds = foldedBounds(model);
    check('não sai do plano', Math.abs(bounds.maxZ) + Math.abs(bounds.minZ), 0, 1e-6);
  }

  // --- Perfil U: duas dobras paralelas ------------------------------------
  section('38. Perfil U: duas dobras paralelas formam três faces em cadeia');
  {
    const base = 80;
    const aba = 30;
    const larguraPlana = base + 2 * aba - 2 * deduction;
    const dobra1 = aba - deduction / 2;
    const dobra2 = larguraPlana - (aba - deduction / 2);

    const { model, warnings } = fold(
      buildDxf([
        ...rectangleAsLines(larguraPlana, 200),
        ...line(dobra1, 0, dobra1, 200, 'DOBRA'),
        ...line(dobra2, 0, dobra2, 200, 'DOBRA'),
      ]),
      (ids) => ids.map((id) => config(id)),
    );

    checkTrue('sem bloqueio', model.ok, warnings.join(' | '));
    check('faces', model.faces.length, 3, 0);
    check('dobras aplicadas', model.patches.length, 2, 0);
    check('arestas da árvore', model.tree.filter((n) => n.parent !== null).length, 2, 0);

    // A base é a maior face, então fica fixa no plano; as duas abas sobem.
    const bounds = foldedBounds(model);
    const outerOffset = (1 - K) * T;
    check('altura externa das abas (mm)', bounds.maxZ + outerOffset, aba, 0.002);
    check('base externa (mm)', bounds.maxX - bounds.minX + 2 * outerOffset, base, 0.01);
  }

  // --- Recusas -------------------------------------------------------------
  section('39. Eixo que não atravessa a peça é recusado');
  {
    const { warnings, model } = fold(
      buildDxf([
        ...rectangleAsLines(100, 60),
        // Para em y=40, não alcança a borda de cima: dobra parcial.
        ...line(50, 0, 50, 40, 'DOBRA'),
      ]),
      (ids) => ids.map((id) => config(id)),
    );
    checkTrue(
      'dobra parcial recusada',
      warnings.some((w) => w.includes('não dobrável')),
      warnings.join(' | '),
    );
    check('permanece uma face', model.faces.length, 1, 0);
  }

  section('40. Eixos que se cruzam são recusados');
  {
    const { warnings } = fold(
      buildDxf([
        ...rectangleAsLines(100, 100),
        ...line(50, 0, 50, 100, 'DOBRA'),
        ...line(0, 50, 100, 50, 'DOBRA'),
      ]),
      (ids) => ids.map((id) => config(id)),
    );
    checkTrue(
      'cruzamento de eixos recusado',
      warnings.some((w) => w.includes('se cruzam')),
      warnings.join(' | '),
    );
  }

  section('41. Linha de dobra curva é recusada');
  {
    const { warnings } = fold(
      buildDxf([
        ...rectangleAsLines(100, 60),
        ...lwpolyline(
          [
            { x: 50, y: 0 },
            { x: 55, y: 30 },
            { x: 50, y: 60 },
          ],
          false,
          'DOBRA',
        ),
      ]),
      (ids) => ids.map((id) => config(id)),
    );
    checkTrue(
      'linha curva recusada',
      warnings.some((w) => w.includes('curva')),
      warnings.join(' | '),
    );
  }

  section('42. Peça sem dobra continua plana e válida');
  {
    const { model } = fold(buildDxf(rectangleAsLines(100, 60)), () => []);
    checkTrue('válida', model.ok);
    check('uma face', model.faces.length, 1, 0);
    check('sem dobras', model.patches.length, 0, 0);
    check('no plano', foldedBounds(model).maxZ, 0, 1e-9);
  }

  // --- Furos acompanham a face --------------------------------------------
  section('43. Furos vão para a face a que pertencem');
  {
    const { model } = fold(
      buildDxf([
        ...rectangleAsLines(flat, 50),
        ...line(bendAt, 0, bendAt, 50, 'DOBRA'),
        ...lwpolyline(
          [
            { x: 20, y: 25, bulge: 1 },
            { x: 30, y: 25, bulge: 1 },
          ],
          true,
        ),
        ...lwpolyline(
          [
            { x: 75, y: 25, bulge: 1 },
            { x: 85, y: 25, bulge: 1 },
          ],
          true,
        ),
      ]),
      (ids) => ids.map((id) => config(id)),
    );

    check('faces', model.faces.length, 2, 0);
    check(
      'um furo em cada face',
      model.faces.filter((face) => face.holes.length === 1).length,
      2,
      0,
    );
  }
}

/**
 * Casos que dependem de reclassificar entidades — a linha de construção
 * promovida a eixo de dobra pela interface.
 */
export function runPromotionCases({ check, checkTrue, section }: Harness): void {
  section('46. Linha de construção promovida a eixo dobra a peça');
  {
    // Reproduz PeçaTeste3.DXF: quadrado 60x60 contínuo + eixo CENTERX2 no meio.
    const dxf = buildDxf([
      ...lineWithLinetype(0, 30, 60, 30, 'CENTERX2'),
      ...lineWithLinetype(0, 0, 60, 0, 'Continuous'),
      ...lineWithLinetype(0, 0, 0, 60, 'Continuous'),
      ...lineWithLinetype(0, 60, 60, 60, 'Continuous'),
      ...lineWithLinetype(60, 0, 60, 60, 'Continuous'),
    ]);
    const geometry = analyzeDrawing(parseDxfFile(dxf), { bendLayers: ['DOBRA'], etchLayers: [] });
    const outer = geometry.loops.filter((loop: Loop) => loop.depth % 2 === 0);
    const outline = outer.find((loop) => loop.depth === 0)?.points ?? [];

    check('nenhuma dobra automática', geometry.bendLines.length, 0, 0);
    check('uma linha de construção', geometry.constructionLines.length, 1, 0);

    // Sem promover: peça plana, e isso é resposta válida (não erro).
    const plana = solveFold({ thickness: T, outline, holes: [], axes: [], configs: [] });
    checkTrue('sem promoção: plana e válida', plana.ok && plana.faces.length === 1);

    // Promovendo a linha de construção, exatamente como a interface faz.
    const promovidos = geometry.constructionLines.map((line) => ({
      points: line.points,
      layer: line.layer,
      length: 0,
    }));
    const extraction = extractAxes(promovidos, outer);
    const usable = extraction.axes.filter((axis) => axis.problem === null);
    check('eixo aceito após promoção', usable.length, 1, 0);

    const dobrada = solveFold({
      thickness: T,
      outline,
      holes: [],
      axes: extraction.axes,
      configs: usable.map((axis) => config(axis.id)),
    });
    checkTrue('dobra resolvida', dobrada.ok, dobrada.warnings.map((w) => w.title).join(' | '));
    check('faces', dobrada.faces.length, 2, 0);
    check('dobras', dobrada.patches.length, 1, 0);

    // Conservação: as duas metades aparadas mais o arco dão o plano de 60 mm.
    const alturas = dobrada.faces.map((face) => {
      const ys = (face.outline as Point[]).map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    });
    check(
      'metade + arco + metade = 60 mm',
      alturas[0] + allowance + alturas[1],
      60,
      0.001,
    );
  }
}
