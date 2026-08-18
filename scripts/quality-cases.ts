/**
 * Casos de teste das verificações de qualidade de geometria.
 *
 * Separado de `verify-engine.ts` só por tamanho: são exercidos pelo mesmo
 * arranjo de asserções, importado de lá.
 */

import { analyzeDrawing } from '../src/lib/geometry/analyze';
import { parseDxfFile } from '../src/lib/geometry/dxf';
import { quotePart } from '../src/lib/quote/pricing';
import type { PartConfig } from '../src/lib/quote/types';
import { buildDxf, circle, line, lwpolyline } from './fixtures';

export interface Harness {
  check: (name: string, actual: number, expected: number, tolerance: number) => void;
  checkTrue: (name: string, condition: boolean, detail?: string) => void;
  section: (title: string) => void;
}

const BASE_CONFIG: PartConfig = {
  materialId: 'aco-1020',
  thicknessMm: 1.5,
  finishId: 'nenhum',
  quantity: 10,
  tappedHoles: 0,
  hardwareInserts: 0,
};

function load(dxf: string, options = {}) {
  return analyzeDrawing(parseDxfFile(dxf), options);
}

export function runQualityCases({ check, checkTrue, section }: Harness): void {
  // --- Duplicidade ---------------------------------------------------------
  section('28. Traço desenhado duas vezes é cobrado uma vez');
  {
    // Quadrado 60x60 com CADA aresta duplicada — o que sai de DXF gerado a
    // partir de PDF, ou de explodir o mesmo bloco duas vezes.
    const edges = [
      ...line(0, 0, 60, 0),
      ...line(60, 0, 60, 60),
      ...line(60, 60, 0, 60),
      ...line(0, 60, 0, 0),
    ];
    const geometry = load(buildDxf([...edges, ...edges]));

    check('comprimento de corte (mm)', geometry.cutLength, 240, 0.001);
    check('área líquida (mm²)', geometry.netArea, 3600, 0.001);
    check('perfurações', geometry.pierces, 1, 0);
    check('contornos abertos', geometry.openChains.length, 0, 0);
    check('segmentos duplicados detectados', geometry.quality.duplicateSegments, 4, 0);
    check('comprimento duplicado (mm)', geometry.quality.duplicateLength, 240, 0.001);

    const quote = quotePart(geometry, BASE_CONFIG);
    checkTrue('peça aprovada', quote.ok, JSON.stringify(quote.issues.map((i) => i.title)));
    checkTrue(
      'duplicidade é reportada ao cliente',
      quote.issues.some((i) => i.id === 'geometria-duplicada'),
    );

    // Comparação direta: o mesmo desenho sem duplicata custa igual.
    const limpo = load(buildDxf(edges));
    const quoteLimpo = quotePart(limpo, BASE_CONFIG);
    check(
      'preço idêntico ao desenho limpo',
      quote.unitPrice,
      quoteLimpo.unitPrice,
      0.001,
    );
  }

  // --- Auto-interseção -----------------------------------------------------
  section('29. Contorno cruzado é bloqueio');
  {
    // Gravata-borboleta: as duas diagonais se cruzam no centro.
    const geometry = load(
      buildDxf(
        lwpolyline(
          [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 0, y: 60 },
            { x: 60, y: 60 },
          ],
          true,
        ),
      ),
    );

    checkTrue(
      'cruzamento detectado',
      geometry.quality.intersections > 0,
      `intersections=${geometry.quality.intersections}`,
    );

    const quote = quotePart(geometry, BASE_CONFIG);
    checkTrue('orçamento bloqueado', !quote.ok);
    checkTrue(
      'motivo é o contorno cruzado',
      quote.issues.some((i) => i.id === 'contorno-cruzado' && i.severity === 'bloqueio'),
      JSON.stringify(quote.issues.map((i) => i.id)),
    );
  }

  section('30. Peça bem desenhada não acusa cruzamento');
  {
    // Regressão: círculos concêntricos e retângulo com furo não podem gerar
    // falso positivo, senão a checagem seria inútil na prática.
    const concentricos = load(buildDxf([...circle(0, 0, 50), ...circle(0, 0, 20)]));
    check('círculos concêntricos', concentricos.quality.intersections, 0, 0);

    const comFuro = load(
      buildDxf([
        ...line(0, 0, 100, 0),
        ...line(100, 0, 100, 50),
        ...line(100, 50, 0, 50),
        ...line(0, 50, 0, 0),
        ...circle(50, 25, 10),
      ]),
    );
    check('retângulo com furo', comFuro.quality.intersections, 0, 0);
    checkTrue('ainda aprovado', quotePart(comFuro, BASE_CONFIG).ok);
  }

  // --- Canto agudo ---------------------------------------------------------
  section('31. Canto agudo demais para o feixe');
  {
    // Triângulo-agulha: a ponta em (0,0) tem menos de 2°.
    const geometry = load(
      buildDxf(
        lwpolyline(
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 3 },
          ],
          true,
        ),
      ),
    );

    const quote = quotePart(geometry, BASE_CONFIG);
    checkTrue(
      'canto agudo reportado',
      quote.issues.some((i) => i.id === 'canto-agudo'),
      JSON.stringify(quote.issues.map((i) => i.id)),
    );

    // Um retângulo comum tem só cantos de 90° e não pode disparar o aviso.
    const retangulo = load(
      buildDxf([
        ...line(0, 0, 100, 0),
        ...line(100, 0, 100, 60),
        ...line(100, 60, 0, 60),
        ...line(0, 60, 0, 0),
      ]),
    );
    checkTrue(
      'retângulo não dispara canto agudo',
      !quotePart(retangulo, BASE_CONFIG).issues.some((i) => i.id === 'canto-agudo'),
    );

    // Nem um círculo, cujos vértices são discretização e não canto.
    const redondo = load(buildDxf(circle(0, 0, 40)));
    checkTrue(
      'círculo não dispara canto agudo',
      !quotePart(redondo, BASE_CONFIG).issues.some((i) => i.id === 'canto-agudo'),
    );
  }

  // --- Furo x dobra --------------------------------------------------------
  section('32. Furo dentro da zona de deformação da dobra');
  {
    const comDobra = (holeX: number) =>
      load(
        buildDxf([
          ...line(0, 0, 120, 0),
          ...line(120, 0, 120, 60),
          ...line(120, 60, 0, 60),
          ...line(0, 60, 0, 0),
          ...circle(holeX, 30, 5),
          ...line(60, 0, 60, 60, 'DOBRA'),
        ]),
        { bendLayers: ['DOBRA'], etchLayers: [] },
      );

    // Furo Ø10 centrado a 6 mm da dobra: borda a 1 mm dela.
    const perto = quotePart(comDobra(66), BASE_CONFIG);
    checkTrue(
      'furo colado na dobra é reportado',
      perto.issues.some((i) => i.id === 'furo-proximo-dobra'),
      JSON.stringify(perto.issues.map((i) => i.id)),
    );

    // Mesmo furo a 40 mm da dobra: fora da zona.
    const longe = quotePart(comDobra(100), BASE_CONFIG);
    checkTrue(
      'furo afastado não é reportado',
      !longe.issues.some((i) => i.id === 'furo-proximo-dobra'),
    );
  }

  // --- Recorte menor que a sangria ----------------------------------------
  section('33. Recorte menor que a sangria é bloqueio');
  {
    const geometry = load(
      buildDxf([
        ...line(0, 0, 60, 0),
        ...line(60, 0, 60, 60),
        ...line(60, 60, 0, 60),
        ...line(0, 60, 0, 0),
        ...circle(30, 30, 0.1), // Ø0,2 mm — abaixo da sangria de 0,15 mm.
      ]),
    );

    const quote = quotePart(geometry, BASE_CONFIG);
    checkTrue('orçamento bloqueado', !quote.ok);
    checkTrue(
      'motivo inclui o recorte minúsculo',
      quote.issues.some((i) => i.id === 'recorte-minusculo' && i.severity === 'bloqueio'),
      JSON.stringify(quote.issues.map((i) => i.id)),
    );
  }

  // --- Aproveitamento ------------------------------------------------------
  section('34. Fecho convexo mede o aproveitamento da chapa');
  {
    // Triângulo retângulo 100x100: ocupa metade da própria caixa envolvente.
    const triangulo = load(
      buildDxf(
        lwpolyline(
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 0, y: 100 },
          ],
          true,
        ),
      ),
    );
    check('área do fecho convexo (mm²)', triangulo.quality.hullArea, 5000, 1);
    check('área da caixa (mm²)', triangulo.bboxArea, 10000, 1);

    // Num retângulo, fecho e caixa coincidem.
    const retangulo = load(
      buildDxf([
        ...line(0, 0, 80, 0),
        ...line(80, 0, 80, 40),
        ...line(80, 40, 0, 40),
        ...line(0, 40, 0, 0),
      ]),
    );
    check('retângulo: fecho = caixa', retangulo.quality.hullArea, retangulo.bboxArea, 1);
  }
}
