/**
 * Solver de dobra: flat pattern → peça posicionada no espaço.
 *
 * O ponto que define se o preview está certo ou apenas plausível: a faixa de
 * largura BA (comprimento do arco) centrada em cada eixo é CONSUMIDA pela
 * dobra. As faces são aparadas nessa faixa e o arco a substitui.
 *
 * Sem essa etapa, girar as duas metades em torno do eixo criaria material do
 * nada — a peça sairia maior que o projeto exatamente pela dedução de dobra.
 */

import { signedArea, type Point } from '../types';
import { bendDeduction } from '../bend-allowance';
import { signedDistance, usableAxes } from './axis';
import { IDENTITY, multiply, rotationAboutLine, translation } from './matrix';
import { clipHalfPlane, partitionPart, regionArea, type Region } from './partition';
import type { BendAxis, BendConfig, FoldFace, FoldPatch, FoldWarning, FoldedModel } from './types';

export interface SolveOptions {
  /** Espessura da chapa, em mm. Vem da configuração do orçamento. */
  thickness: number;
  /** Contorno externo do flat pattern. */
  outline: readonly Point[];
  holes: readonly Point[][];
  axes: readonly BendAxis[];
  configs: readonly BendConfig[];
}

/** Duas faces são vizinhas quando diferem em UM único eixo. */
function adjacentAxis(
  a: Record<string, 1 | -1>,
  b: Record<string, 1 | -1>,
): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let differing: string | null = null;

  for (const key of keys) {
    if (a[key] !== b[key]) {
      if (differing !== null) return null; // Difere em mais de um: não é vizinha.
      differing = key;
    }
  }
  return differing;
}

export function solveFold(options: SolveOptions): FoldedModel {
  const { thickness, outline, holes, configs } = options;
  const warnings: FoldWarning[] = [];

  const axes = usableAxes(options.axes);
  const configById = new Map(configs.map((config) => [config.axisId, config]));

  // Sem eixo dobrável, a peça é o próprio plano — resposta válida, não erro.
  if (axes.length === 0) {
    return {
      ok: true,
      faces: [
        {
          id: 0,
          outline: [...outline],
          holes: holes.map((hole) => [...hole]),
          area: Math.abs(signedArea(outline)),
          signature: {},
          transform: IDENTITY,
        },
      ],
      patches: [],
      rootFace: 0,
      tree: [{ face: 0, parent: null, axisId: null }],
      warnings,
      thickness,
    };
  }

  const partition = partitionPart(outline, holes, axes);
  warnings.push(...partition.warnings);

  if (partition.regions.length < 2) {
    return failed(thickness, warnings, {
      severity: 'bloqueio',
      title: 'A dobra não dividiu a peça',
      detail:
        'Os eixos informados não separaram o flat pattern em faces distintas. ' +
        'Verifique se a linha de dobra realmente atravessa a peça.',
    });
  }

  // --- Grafo de faces -------------------------------------------------------
  const regions = partition.regions;
  const edges: { a: number; b: number; axisId: string }[] = [];

  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const axisId = adjacentAxis(regions[i].signature, regions[j].signature);
      if (axisId) edges.push({ a: i, b: j, axisId });
    }
  }

  // Árvore tem exatamente n−1 arestas. Mais que isso é ciclo: geometria
  // sobredeterminada, que não se dobra a partir do plano sem esticar material.
  if (edges.length > regions.length - 1) {
    return failed(thickness, warnings, {
      severity: 'bloqueio',
      title: 'Dobras formam um circuito fechado',
      detail:
        `São ${regions.length} faces ligadas por ${edges.length} dobras. Uma peça ` +
        'dobrável a partir do plano forma uma árvore; um circuito significa que ' +
        'alguma face teria de girar em torno de dois eixos ao mesmo tempo.',
    });
  }

  // --- Face-raiz e travessia ------------------------------------------------
  const areas = regions.map(regionArea);
  let rootFace = 0;
  for (let i = 1; i < regions.length; i += 1) {
    if (areas[i] > areas[rootFace]) rootFace = i;
  }

  const neighbours = new Map<number, { face: number; axisId: string }[]>();
  for (const edge of edges) {
    if (!neighbours.has(edge.a)) neighbours.set(edge.a, []);
    if (!neighbours.has(edge.b)) neighbours.set(edge.b, []);
    neighbours.get(edge.a)!.push({ face: edge.b, axisId: edge.axisId });
    neighbours.get(edge.b)!.push({ face: edge.a, axisId: edge.axisId });
  }

  const transforms = new Array<typeof IDENTITY>(regions.length).fill(IDENTITY);
  const tree: FoldedModel['tree'] = [];
  const patches: FoldPatch[] = [];
  const visited = new Set<number>([rootFace]);
  const queue: number[] = [rootFace];
  tree.push({ face: rootFace, parent: null, axisId: null });

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const link of neighbours.get(current) ?? []) {
      if (visited.has(link.face)) continue;
      visited.add(link.face);

      const axis = axes.find((candidate) => candidate.id === link.axisId);
      const config = configById.get(link.axisId);

      if (!axis || !config) {
        // Sem configuração, a face permanece no plano do pai.
        transforms[link.face] = transforms[current];
        tree.push({ face: link.face, parent: current, axisId: link.axisId });
        queue.push(link.face);
        continue;
      }

      // O sinal decorre de que lado a face filha está: girar +θ levanta o lado
      // positivo do eixo. Do lado negativo, o mesmo ângulo desceria.
      const side = regions[link.face].signature[axis.id];
      const orientation = config.direction === 'up' ? 1 : -1;
      const sign = (side * orientation) as 1 | -1;
      const angleRad = ((config.angleDeg * Math.PI) / 180) * sign;

      const { allowance } = bendDeduction(
        thickness,
        config.innerRadius,
        config.angleDeg,
        config.kFactor,
      );

      /*
       * Transformada da face filha, e é aqui que quase todo preview de dobra
       * erra:
       *
       *   T = Rot(centro do arco, ±θ) · Translate(−BA · û)
       *
       * A translação recua a face filha em exatamente o comprimento do arco, o
       * que faz a borda dela coincidir com a tangente onde a face pai termina.
       * Só então a rotação em torno do CENTRO DO ARCO — que fica a um raio
       * neutro fora do plano, não sobre a linha desenhada — a leva à outra
       * tangente.
       *
       * Girar em torno da linha do DXF, sem recuar, alonga a peça pela dedução
       * inteira: numa cantoneira 60+40 de 2 mm, 3,48 mm de material inventado.
       */
      const normal = { x: -axis.direction.y, y: axis.direction.x };
      const toChild = { x: normal.x * side, y: normal.y * side };
      const neutralRadius = config.innerRadius + config.kFactor * thickness;

      // Tangente onde a face pai termina: recuada BA/2 do eixo, do lado do pai.
      const tangent = {
        x: axis.origin.x - toChild.x * (allowance / 2),
        y: axis.origin.y - toChild.y * (allowance / 2),
      };
      // O centro do arco fica um raio neutro acima (ou abaixo) dessa tangente.
      const centerZ = neutralRadius * orientation;

      const rotation = rotationAboutLine(tangent, axis.direction, angleRad, centerZ);
      const retreat = translation(-toChild.x * allowance, -toChild.y * allowance, 0);

      transforms[link.face] = multiply(
        transforms[current],
        multiply(rotation, retreat),
      );

      // Trecho do eixo efetivamente coberto pela peça. Fora da travessia não há
      // material, então o arco não deve ser desenhado ali.
      const spanStart = axis.crossings.length >= 2 ? axis.crossings[0] : 0;
      const spanEnd = axis.crossings.length >= 2 ? axis.crossings[1] : axis.length;

      patches.push({
        axisId: axis.id,
        angleDeg: config.angleDeg,
        innerRadius: config.innerRadius,
        neutralRadius,
        allowance,
        axisOrigin: axis.origin,
        axisDirection: axis.direction,
        toChild,
        spanStart,
        spanEnd,
        orientation: orientation as 1 | -1,
        sign,
        transform: transforms[current],
      });

      tree.push({ face: link.face, parent: current, axisId: link.axisId });
      queue.push(link.face);
    }
  }

  if (visited.size < regions.length) {
    warnings.push({
      severity: 'atencao',
      title: 'Faces soltas no desenho',
      detail:
        `${regions.length - visited.size} face(s) não se conectam ao corpo principal ` +
        'por nenhuma dobra e foram mantidas no plano.',
    });
  }

  // --- Aparo: a faixa consumida pela dobra sai das faces --------------------
  const faces: FoldFace[] = regions.map((region, index) => {
    let trimmed = region.outline;

    for (const axis of axes) {
      const side = region.signature[axis.id];
      const config = configById.get(axis.id);
      if (side === undefined || !config) continue;

      // Só apara onde a face realmente encosta na dobra.
      const touches = (neighbours.get(index) ?? []).some((link) => link.axisId === axis.id);
      if (!touches) continue;

      const { allowance } = bendDeduction(
        thickness,
        config.innerRadius,
        config.angleDeg,
        config.kFactor,
      );
      const clipped = clipHalfPlane(trimmed, axis, side, allowance / 2);
      if (clipped.length >= 3) trimmed = clipped;
    }

    return {
      id: index,
      outline: trimmed,
      holes: region.holes,
      area: areas[index],
      signature: region.signature,
      transform: transforms[index],
    };
  });

  // Furo que sobrou fora da face aparada caiu dentro da zona de dobra.
  for (const face of faces) {
    const outside = face.holes.filter((hole) => !holeInside(hole, face.outline, axes, face));
    if (outside.length > 0) {
      warnings.push({
        severity: 'atencao',
        title: 'Furo dentro da zona de dobra',
        detail:
          `${outside.length} furo(s) caem na faixa consumida pelo raio de dobra. ` +
          'No preview aparecem sobre a face; na prensa saem deformados.',
      });
      break;
    }
  }

  return {
    ok: !warnings.some((warning) => warning.severity === 'bloqueio'),
    faces,
    patches,
    rootFace,
    tree,
    warnings,
    thickness,
  };
}

/** Um furo é considerado fora quando cruza a borda aparada da face. */
function holeInside(
  hole: readonly Point[],
  outline: readonly Point[],
  axes: readonly BendAxis[],
  face: FoldFace,
): boolean {
  for (const axis of axes) {
    const side = face.signature[axis.id];
    if (side === undefined) continue;
    for (const point of hole) {
      if (signedDistance(point, axis.origin, axis.direction) * side < 0) return false;
    }
  }
  return outline.length >= 3;
}

function failed(
  thickness: number,
  warnings: FoldWarning[],
  blocker: FoldWarning,
): FoldedModel {
  return {
    ok: false,
    faces: [],
    patches: [],
    rootFace: 0,
    tree: [],
    warnings: [...warnings, blocker],
    thickness,
  };
}

export type { Region };
