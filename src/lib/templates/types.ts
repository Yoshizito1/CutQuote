/** Definição de um template paramétrico de peça. */

import type { Polyline } from '../geometry/types';

export type ParamType = 'number' | 'integer' | 'boolean' | 'select';

export interface TemplateParam {
  id: string;
  label: string;
  type: ParamType;
  /** Unidade exibida ao lado do campo (mm, °, un.). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
  options?: readonly { value: number; label: string }[];
  hint?: string;
  /** Agrupa os campos em seções no formulário. */
  group?: string;
  /** Esconde o campo quando a condição não é satisfeita. */
  visibleWhen?: (values: ParamValues) => boolean;
}

export type ParamValues = Record<string, number>;

export interface TemplateBuildResult {
  polylines: Polyline[];
  /** Impossibilidades geométricas — impedem a geração. */
  errors: string[];
  /** Observações que não impedem a geração. */
  notes: string[];
  /**
   * Espessura sugerida quando o template depende dela (cálculo de dobra).
   * A configuração do orçamento adota a espessura disponível mais próxima.
   */
  suggestedThicknessMm?: number;
}

export interface PartTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  params: readonly TemplateParam[];
  build: (values: ParamValues) => TemplateBuildResult;
}

export function defaultValues(template: PartTemplate): ParamValues {
  const values: ParamValues = {};
  for (const param of template.params) values[param.id] = param.default;
  return values;
}
