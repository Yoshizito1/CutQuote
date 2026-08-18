/**
 * Desenvolvimento de dobra.
 *
 * Vive na camada de geometria porque tem dois consumidores: os templates
 * paramétricos, que calculam o comprimento planificado ao gerar a peça, e o
 * solver de dobra, que precisa saber quanto material a dobra consome do plano.
 *
 * O fator K descreve onde fica a linha neutra dentro da espessura — a fibra que
 * nem estica nem comprime. É o único parâmetro empírico da conta, e varia com
 * material e ferramenta.
 */

export interface BendAllowance {
  /** Comprimento do arco no raio neutro, em mm. */
  allowance: number;
  /** Quanto o plano encurta em relação à soma das abas externas, em mm. */
  deduction: number;
  /** Recuo do vértice teórico até a tangente do arco, em mm. */
  setback: number;
}

export function bendDeduction(
  thickness: number,
  innerRadius: number,
  angleDeg: number,
  kFactor: number,
): BendAllowance {
  const angleRad = (angleDeg * Math.PI) / 180;
  const allowance = angleRad * (innerRadius + kFactor * thickness);
  const setback = (innerRadius + thickness) * Math.tan(angleRad / 2);
  return { allowance, deduction: 2 * setback - allowance, setback };
}
