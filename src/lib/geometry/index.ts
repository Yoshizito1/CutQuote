/** Fachada da camada de geometria: arquivo cru -> peça analisada. */

import { analyzeDrawing, type AnalyzeOptions } from './analyze';
import { parseDxfFile, type DxfParseOptions } from './dxf';
import { parseSvg } from './svg';
import type { ParsedDrawing, PartGeometry, SourceUnit } from './types';

export * from './types';
export {
  analyzeDrawing,
  classifyEntity,
  isConstructionLinetype,
  minimumWebWidth,
  smallestHoleDimension,
  DEFAULT_GAP_TOLERANCE,
} from './analyze';
export { DEFAULT_CHORD_TOLERANCE } from './curves';
export { parseDxfFile } from './dxf';
export { parseSvg } from './svg';

export const SUPPORTED_EXTENSIONS = ['.dxf', '.svg'] as const;

/** Convenções de nome de layer reconhecidas automaticamente. */
const ETCH_LAYER_PATTERN = /grav|etch|engrav|marca|mark|scribe/i;
const BEND_LAYER_PATTERN = /dobra|bend|fold|vinco/i;

/**
 * Classifica os layers do desenho por convenção de nome. O usuário pode
 * sobrescrever depois, mas o padrão acerta a maioria dos arquivos de produção.
 */
export function detectLayerRoles(layers: readonly string[]): {
  etchLayers: string[];
  bendLayers: string[];
  cutLayers: string[];
} {
  const etchLayers: string[] = [];
  const bendLayers: string[] = [];
  const cutLayers: string[] = [];

  for (const layer of layers) {
    if (BEND_LAYER_PATTERN.test(layer)) bendLayers.push(layer);
    else if (ETCH_LAYER_PATTERN.test(layer)) etchLayers.push(layer);
    else cutLayers.push(layer);
  }
  return { etchLayers, bendLayers, cutLayers };
}

export interface LoadOptions extends AnalyzeOptions, DxfParseOptions {}

export class UnsupportedFormatError extends Error {
  constructor(extension: string) {
    super(
      `Formato "${extension}" não suportado. Envie DXF ou SVG. ` +
        'Arquivos STEP/DWG precisam ser convertidos antes do envio.',
    );
    this.name = 'UnsupportedFormatError';
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Lê o conteúdo de um arquivo e devolve a peça já analisada.
 *
 * Quando o chamador não define os papéis de layer, eles são inferidos pelo nome
 * — em duas passadas, porque a lista de layers só existe depois do parse.
 */
export function loadDrawing(
  filename: string,
  content: string,
  options: LoadOptions = {},
): PartGeometry {
  const extension = extensionOf(filename);

  let drawing: ParsedDrawing;
  switch (extension) {
    case '.dxf':
      drawing = parseDxfFile(content, options);
      break;
    case '.svg':
      drawing = parseSvg(content, options);
      break;
    default:
      throw new UnsupportedFormatError(extension || filename);
  }

  const detected = detectLayerRoles(drawing.layers);
  return analyzeDrawing(drawing, {
    ...options,
    etchLayers: options.etchLayers ?? detected.etchLayers,
    bendLayers: options.bendLayers ?? detected.bendLayers,
  });
}

/**
 * Heurística de unidade errada. O sintoma clássico é o DXF sem `$INSUNITS`
 * desenhado em polegadas e lido como milímetros: a peça sai 25x menor.
 */
export function suspiciousScale(geometry: PartGeometry): {
  suspect: boolean;
  suggestion: SourceUnit | null;
  reason: string | null;
} {
  const { width, height } = geometry.bbox;
  const largest = Math.max(width, height);

  if (largest === 0) {
    return { suspect: false, suggestion: null, reason: null };
  }
  if (geometry.source.sourceUnit === 'unknown') {
    return {
      suspect: true,
      suggestion: null,
      reason: 'O arquivo não declara unidade ($INSUNITS ausente). Confirme a escala abaixo.',
    };
  }
  if (largest < 3) {
    return {
      suspect: true,
      suggestion: 'in',
      reason: `A peça mede apenas ${largest.toFixed(2)} mm. É comum um desenho em polegadas ser lido como milímetros.`,
    };
  }
  if (largest > 3000) {
    return {
      suspect: true,
      suggestion: 'mm',
      reason: `A peça mede ${(largest / 1000).toFixed(2)} m. Verifique se o desenho não está em unidade maior que a esperada.`,
    };
  }
  return { suspect: false, suggestion: null, reason: null };
}
