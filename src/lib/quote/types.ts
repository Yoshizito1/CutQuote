/** Tipos compartilhados entre o validador DFM e o motor de preço. */

import type { PartGeometry } from '../geometry';

export interface PartConfig {
  materialId: string;
  thicknessMm: number;
  finishId: string;
  quantity: number;
  /** Roscas a executar (o desenho não distingue furo passante de rosca). */
  tappedHoles: number;
  /** Insertos prensados (tipo PEM). */
  hardwareInserts: number;
}

export type IssueSeverity = 'bloqueio' | 'atencao' | 'info';

export interface DfmIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** O que o cliente deve fazer para resolver. */
  fix?: string;
}

export interface PriceLine {
  id: string;
  label: string;
  /** Como o valor foi obtido — a memória de cálculo que o cliente pode conferir. */
  detail: string;
  /** Valor por peça, em R$. */
  unitAmount: number;
  /** Valor rateado do custo de pedido, por peça, em R$. */
  setupAmount: number;
}

export interface PartQuote {
  ok: boolean;
  /** Bloqueios impedem o orçamento; avisos não. */
  issues: DfmIssue[];
  lines: PriceLine[];
  /** Custo direto por peça, antes da margem. */
  unitCost: number;
  /** Preço unitário final, com margem. */
  unitPrice: number;
  totalPrice: number;
  /** Preço mínimo de pedido aplicado (0 quando não incidiu). */
  minimumAdjustment: number;
  leadDays: number;
  /** Fator de volume que incidiu sobre a parte variável. */
  volumeFactor: number;
  /** Massa de uma peça, em kg. */
  unitMassKg: number;
  /** Aproveitamento: área líquida / área aninhada. */
  materialUtilization: number;
  geometry: PartGeometry;
  config: PartConfig;
}

export interface QuoteLadderRow {
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /** Economia percentual no unitário em relação à quantidade 1. */
  savingsPercent: number;
}
