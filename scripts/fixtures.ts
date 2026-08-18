/** Geradores de DXF sintético para os testes do motor. */

interface Pair {
  code: number;
  value: string | number;
}

function serialize(pairs: Pair[]): string {
  return pairs.map((pair) => `${pair.code}\n${pair.value}`).join('\n') + '\n';
}

/** Monta um DXF completo com header de unidade + entidades. */
export function buildDxf(entities: Pair[], insunits = 4): string {
  const header: Pair[] = [
    { code: 0, value: 'SECTION' },
    { code: 2, value: 'HEADER' },
    { code: 9, value: '$INSUNITS' },
    { code: 70, value: insunits },
    { code: 0, value: 'ENDSEC' },
  ];
  const body: Pair[] = [
    { code: 0, value: 'SECTION' },
    { code: 2, value: 'ENTITIES' },
    ...entities,
    { code: 0, value: 'ENDSEC' },
    { code: 0, value: 'EOF' },
  ];
  return serialize([...header, ...body]);
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer = '0',
): Pair[] {
  return [
    { code: 0, value: 'LINE' },
    { code: 8, value: layer },
    { code: 10, value: x1 },
    { code: 20, value: y1 },
    { code: 11, value: x2 },
    { code: 21, value: y2 },
  ];
}

export function circle(cx: number, cy: number, r: number, layer = '0'): Pair[] {
  return [
    { code: 0, value: 'CIRCLE' },
    { code: 8, value: layer },
    { code: 10, value: cx },
    { code: 20, value: cy },
    { code: 40, value: r },
  ];
}

export function arc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
  layer = '0',
): Pair[] {
  return [
    { code: 0, value: 'ARC' },
    { code: 8, value: layer },
    { code: 10, value: cx },
    { code: 20, value: cy },
    { code: 40, value: r },
    { code: 50, value: startDeg },
    { code: 51, value: endDeg },
  ];
}

export interface LwVertex {
  x: number;
  y: number;
  bulge?: number;
}

export function lwpolyline(vertices: LwVertex[], closed: boolean, layer = '0'): Pair[] {
  const pairs: Pair[] = [
    { code: 0, value: 'LWPOLYLINE' },
    { code: 8, value: layer },
    { code: 90, value: vertices.length },
    { code: 70, value: closed ? 1 : 0 },
  ];
  for (const vertex of vertices) {
    pairs.push({ code: 10, value: vertex.x });
    pairs.push({ code: 20, value: vertex.y });
    if (vertex.bulge) pairs.push({ code: 42, value: vertex.bulge });
  }
  return pairs;
}

/** Retângulo montado como 4 LINE soltas — o caso que exige encadeamento. */
export function rectangleAsLines(w: number, h: number, layer = '0'): Pair[] {
  return [
    ...line(0, 0, w, 0, layer),
    ...line(w, 0, w, h, layer),
    ...line(w, h, 0, h, layer),
    ...line(0, h, 0, 0, layer),
  ];
}

/** Bloco + INSERT, para exercitar a expansão com transformação. */
export function dxfWithBlock(
  blockName: string,
  blockEntities: Pair[],
  insert: { x: number; y: number; scale?: number; rotationDeg?: number },
): string {
  const pairs: Pair[] = [
    { code: 0, value: 'SECTION' },
    { code: 2, value: 'HEADER' },
    { code: 9, value: '$INSUNITS' },
    { code: 70, value: 4 },
    { code: 0, value: 'ENDSEC' },

    { code: 0, value: 'SECTION' },
    { code: 2, value: 'BLOCKS' },
    { code: 0, value: 'BLOCK' },
    { code: 2, value: blockName },
    { code: 10, value: 0 },
    { code: 20, value: 0 },
    ...blockEntities,
    { code: 0, value: 'ENDBLK' },
    { code: 0, value: 'ENDSEC' },

    { code: 0, value: 'SECTION' },
    { code: 2, value: 'ENTITIES' },
    { code: 0, value: 'INSERT' },
    { code: 8, value: '0' },
    { code: 2, value: blockName },
    { code: 10, value: insert.x },
    { code: 20, value: insert.y },
    { code: 41, value: insert.scale ?? 1 },
    { code: 42, value: insert.scale ?? 1 },
    { code: 50, value: insert.rotationDeg ?? 0 },
    { code: 0, value: 'ENDSEC' },
    { code: 0, value: 'EOF' },
  ];
  return serialize(pairs);
}

/** POLYLINE/VERTEX legada (DXF R12). */
export function legacyPolyline(vertices: LwVertex[], closed: boolean, layer = '0'): Pair[] {
  const pairs: Pair[] = [
    { code: 0, value: 'POLYLINE' },
    { code: 8, value: layer },
    { code: 66, value: 1 },
    { code: 70, value: closed ? 1 : 0 },
  ];
  for (const vertex of vertices) {
    pairs.push({ code: 0, value: 'VERTEX' });
    pairs.push({ code: 8, value: layer });
    pairs.push({ code: 10, value: vertex.x });
    pairs.push({ code: 20, value: vertex.y });
    if (vertex.bulge) pairs.push({ code: 42, value: vertex.bulge });
  }
  pairs.push({ code: 0, value: 'SEQEND' });
  return pairs;
}

/** LINE com linetype explícito (código 6). */
export function lineWithLinetype(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  linetype: string,
  layer = '0',
): Pair[] {
  return [
    { code: 0, value: 'LINE' },
    { code: 8, value: layer },
    { code: 6, value: linetype },
    { code: 10, value: x1 },
    { code: 20, value: y1 },
    { code: 11, value: x2 },
    { code: 21, value: y2 },
  ];
}

/**
 * DXF com tabela LAYER declarando o linetype de cada camada.
 *
 * Reproduz o caso mais comum de CAD real: a entidade não declara linetype
 * (ou diz BYLAYER) e o valor efetivo vem da camada.
 */
export function buildDxfWithLayerTable(
  layers: readonly { name: string; linetype: string }[],
  entities: Pair[],
): string {
  const pairs: Pair[] = [
    { code: 0, value: 'SECTION' },
    { code: 2, value: 'HEADER' },
    { code: 9, value: '$INSUNITS' },
    { code: 70, value: 4 },
    { code: 0, value: 'ENDSEC' },

    { code: 0, value: 'SECTION' },
    { code: 2, value: 'TABLES' },
    { code: 0, value: 'TABLE' },
    { code: 2, value: 'LAYER' },
    { code: 70, value: layers.length },
  ];
  for (const layer of layers) {
    pairs.push({ code: 0, value: 'LAYER' });
    pairs.push({ code: 2, value: layer.name });
    pairs.push({ code: 70, value: 0 });
    pairs.push({ code: 62, value: 7 });
    pairs.push({ code: 6, value: layer.linetype });
  }
  pairs.push({ code: 0, value: 'ENDTAB' });
  pairs.push({ code: 0, value: 'ENDSEC' });

  pairs.push({ code: 0, value: 'SECTION' });
  pairs.push({ code: 2, value: 'ENTITIES' });
  pairs.push(...entities);
  pairs.push({ code: 0, value: 'ENDSEC' });
  pairs.push({ code: 0, value: 'EOF' });

  return pairs.map((p) => `${p.code}\n${p.value}`).join('\n') + '\n';
}
