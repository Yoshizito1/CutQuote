/**
 * Escritor de DXF.
 *
 * Permite baixar a peça configurada por template como arquivo CAD real, para
 * levar ao fornecedor, arquivar no projeto ou reabrir no CAD e ajustar.
 *
 * Escreve DXF R12 ASCII: é o dialeto mais antigo e, por isso, o que praticamente
 * todo software abre sem reclamar.
 */

import type { Polyline } from '../geometry/types';

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

/** Layers usados no desenho, com uma cor distinta por papel. */
const LAYER_COLORS: Record<string, number> = {
  CORTE: 7, // branco/preto conforme o fundo
  DOBRA: 6, // magenta
  GRAVACAO: 4, // ciano
};

function layerTable(layers: readonly string[]): string {
  let out = pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER');
  out += pair(70, layers.length);

  for (const layer of layers) {
    out += pair(0, 'LAYER');
    out += pair(2, layer);
    out += pair(70, 0);
    out += pair(62, LAYER_COLORS[layer] ?? 7);
    out += pair(6, 'CONTINUOUS');
  }
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  return out;
}

export interface DxfExportOptions {
  /** Descrição gravada como comentário do cabeçalho. */
  title?: string;
}

/**
 * Serializa polilinhas em DXF.
 *
 * Cada polilinha vira uma LWPOLYLINE — o achatamento já foi feito pelo gerador
 * de template, então o arquivo carrega exatamente a geometria que foi cotada,
 * sem diferença entre o que foi visto na tela e o que será cortado.
 */
export function exportDxf(polylines: readonly Polyline[], options: DxfExportOptions = {}): string {
  const layers = [...new Set(polylines.map((polyline) => polyline.layer))];

  let out = '';

  // Cabeçalho: unidade em milímetros e extensão do desenho.
  const allPoints = polylines.flatMap((polyline) => polyline.points);
  const minX = allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.x)) : 0;
  const minY = allPoints.length > 0 ? Math.min(...allPoints.map((p) => p.y)) : 0;
  const maxX = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.x)) : 0;
  const maxY = allPoints.length > 0 ? Math.max(...allPoints.map((p) => p.y)) : 0;

  out += pair(999, options.title ?? 'CutQuote');
  out += pair(0, 'SECTION') + pair(2, 'HEADER');
  out += pair(9, '$ACADVER') + pair(1, 'AC1009');
  out += pair(9, '$INSUNITS') + pair(70, 4); // 4 = milímetros
  out += pair(9, '$EXTMIN') + pair(10, minX.toFixed(6)) + pair(20, minY.toFixed(6)) + pair(30, '0.0');
  out += pair(9, '$EXTMAX') + pair(10, maxX.toFixed(6)) + pair(20, maxY.toFixed(6)) + pair(30, '0.0');
  out += pair(0, 'ENDSEC');

  out += layerTable(layers);

  out += pair(0, 'SECTION') + pair(2, 'ENTITIES');
  for (const polyline of polylines) {
    if (polyline.points.length < 2) continue;

    out += pair(0, 'LWPOLYLINE');
    out += pair(8, polyline.layer);
    out += pair(100, 'AcDbEntity');
    out += pair(100, 'AcDbPolyline');
    out += pair(90, polyline.points.length);
    out += pair(70, polyline.closed ? 1 : 0);

    for (const point of polyline.points) {
      out += pair(10, point.x.toFixed(6));
      out += pair(20, point.y.toFixed(6));
    }
  }
  out += pair(0, 'ENDSEC');
  out += pair(0, 'EOF');

  return out;
}

/** Dispara o download do DXF no navegador. */
export function downloadDxf(polylines: readonly Polyline[], filename: string): void {
  const content = exportDxf(polylines, { title: filename });
  const blob = new Blob([content], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.dxf') ? filename : `${filename}.dxf`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}
