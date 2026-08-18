/**
 * Modelo de dobra: do flat pattern à peça dobrada.
 *
 * Esta camada não conhece preço nem Three.js. Espessura, raio e fator K entram
 * por parâmetro — quem lê o catálogo é a interface. Isso mantém o solver
 * testável em Node e impede que a regra comercial vaze para a geometria.
 */

import type { Point } from '../types';

/**
 * Matriz 4x4 rígida, em ordem de coluna (a mesma do WebGL e do Three.js).
 *
 * Guardada como array simples de propósito: a camada de geometria não importa
 * Three.js, então a matriz precisa atravessar a fronteira sem tipo de terceiro.
 */
export type Mat4 = readonly number[];

/**
 * Eixo de dobra.
 *
 * A reta suporte é guardada separada do segmento desenhado de propósito: o
 * recorte das faces precisa da reta infinita, enquanto a validação de travessia
 * e o comprimento de prensa precisam do segmento real. Confundir os dois é a
 * origem clássica do bug de dobra parcial.
 */
export interface BendAxis {
  id: string;
  /** Ponto qualquer sobre a reta suporte. */
  origin: Point;
  /** Vetor unitário da reta. */
  direction: Point;
  /** Extremos do segmento efetivamente desenhado no DXF. */
  start: Point;
  end: Point;
  /** Comprimento do segmento desenhado, em mm. */
  length: number;
  layer: string;
  /** Onde a reta atravessa o contorno externo, como parâmetro ao longo dela. */
  crossings: number[];
  /** false quando o eixo não corta a peça de borda a borda. */
  spansPart: boolean;
  /** Motivo pelo qual o eixo não é dobrável, quando houver. */
  problem: string | null;
}

export interface BendConfig {
  axisId: string;
  /** Ângulo de dobra em graus (0 = plano, 90 = esquadro). */
  angleDeg: number;
  /** Sentido da rotação da face distal. */
  direction: 'up' | 'down';
  /** Raio interno, em mm. */
  innerRadius: number;
  /** Posição da linha neutra. 0,44 típico de aço; 0,41 de alumínio. */
  kFactor: number;
}

/** Face rígida do flat pattern, já aparada e posicionada no espaço. */
export interface FoldFace {
  id: number;
  /** Contorno externo no plano do flat, antes da transformada. */
  outline: Point[];
  /** Furos pertencentes a esta face. */
  holes: Point[][];
  /** Área em mm² — usada para eleger a face-raiz. */
  area: number;
  /** De que lado de cada eixo esta face está (+1 / -1). */
  signature: Record<string, 1 | -1>;
  /** Transformada rígida acumulada da raiz até aqui. */
  transform: Mat4;
}

/**
 * Trecho cilíndrico que substitui o material consumido pela dobra.
 *
 * Carrega tudo que a malha precisa para se construir sozinha, sem recalcular
 * nada: quem monta o mesh importa Three.js e não pode depender do solver.
 */
export interface FoldPatch {
  axisId: string;
  angleDeg: number;
  /** Raio da face interna, em mm. */
  innerRadius: number;
  /** Raio da linha neutra, em mm. */
  neutralRadius: number;
  /** Comprimento do arco no raio neutro, em mm. */
  allowance: number;

  /** Reta suporte do eixo, no plano do flat. */
  axisOrigin: Point;
  axisDirection: Point;
  /** Vetor unitário no plano, do eixo em direção à face filha. */
  toChild: Point;
  /** Trecho do eixo coberto pela peça, como parâmetro ao longo dele. */
  spanStart: number;
  spanEnd: number;

  /** +1 dobra para cima (+z local), −1 para baixo. */
  orientation: 1 | -1;
  /** Sentido da rotação, já resolvido em sinal. */
  sign: 1 | -1;
  /** Transformada da face de origem: o arco nasce na borda aparada dela. */
  transform: Mat4;
}

export type FoldSeverity = 'bloqueio' | 'atencao';

export interface FoldWarning {
  severity: FoldSeverity;
  title: string;
  detail: string;
}

export interface FoldedModel {
  ok: boolean;
  faces: FoldFace[];
  patches: FoldPatch[];
  /** Índice da face que permanece no plano. */
  rootFace: number;
  /** Árvore de dobra: pai de cada face e por qual eixo. */
  tree: { face: number; parent: number | null; axisId: string | null }[];
  warnings: FoldWarning[];
  /** Espessura usada, em mm. */
  thickness: number;
}
