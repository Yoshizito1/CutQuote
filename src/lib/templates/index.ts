/**
 * Fachada dos templates paramétricos.
 *
 * O ponto central: um template não tem caminho próprio de cálculo. Ele produz
 * as mesmas polilinhas que um DXF produziria e entra no MESMO `analyzeDrawing`.
 * Assim é impossível uma peça de template ser cotada por regra diferente da de
 * uma peça importada.
 */

import { analyzeDrawing } from '../geometry/analyze';
import { detectLayerRoles } from '../geometry';
import type { ParsedDrawing, PartGeometry } from '../geometry/types';
import { findTemplate } from './catalog';
import type { ParamValues, PartTemplate, TemplateBuildResult } from './types';

export * from './types';
export { TEMPLATES, findTemplate, templateCategories, clampParam } from './catalog';
export { exportDxf, downloadDxf } from './dxf-export';
export { bendDeduction } from './shapes';

export interface TemplateGeometryResult {
  geometry: PartGeometry | null;
  errors: string[];
  notes: string[];
  suggestedThicknessMm?: number;
  /** Polilinhas cruas, para exportar em DXF. */
  polylines: TemplateBuildResult['polylines'];
}

/** Constrói a geometria de um template e a passa pelo motor de análise. */
export function buildTemplateGeometry(
  template: PartTemplate,
  values: ParamValues,
): TemplateGeometryResult {
  let result: TemplateBuildResult;
  try {
    result = template.build(values);
  } catch (error) {
    return {
      geometry: null,
      errors: [error instanceof Error ? error.message : 'Falha ao gerar a geometria.'],
      notes: [],
      polylines: [],
    };
  }

  if (result.errors.length > 0 || result.polylines.length === 0) {
    return {
      geometry: null,
      errors: result.errors.length > 0 ? result.errors : ['O template não gerou geometria.'],
      notes: result.notes,
      polylines: result.polylines,
    };
  }

  const layers = [...new Set(result.polylines.map((polyline) => polyline.layer))];
  const drawing: ParsedDrawing = {
    polylines: result.polylines,
    sourceUnit: 'mm',
    unitScale: 1,
    layers,
    ignoredEntities: {},
    format: 'dxf',
  };

  const roles = detectLayerRoles(layers);
  const geometry = analyzeDrawing(drawing, {
    etchLayers: roles.etchLayers,
    bendLayers: roles.bendLayers,
  });

  return {
    geometry,
    errors: [],
    notes: result.notes,
    suggestedThicknessMm: result.suggestedThicknessMm,
    polylines: result.polylines,
  };
}

/** Atalho por id, para links diretos e testes. */
export function buildTemplateById(
  templateId: string,
  values: ParamValues,
): TemplateGeometryResult {
  const template = findTemplate(templateId);
  if (!template) {
    return { geometry: null, errors: [`Template "${templateId}" não existe.`], notes: [], polylines: [] };
  }
  return buildTemplateGeometry(template, values);
}

/** Nome de arquivo sugerido, a partir do template e das medidas principais. */
export function suggestFilename(template: PartTemplate, geometry: PartGeometry): string {
  const width = Math.round(geometry.bbox.width);
  const height = Math.round(geometry.bbox.height);
  return `${template.id}-${width}x${height}.dxf`;
}
