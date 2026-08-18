/**
 * Verificação do motor contra geometrias de resultado conhecido.
 *
 * Cada caso tem um valor analítico exato (perímetro de retângulo, área de
 * círculo, comprimento de arco). Se o parser ou a topologia errar, o número
 * não bate — e o preço estaria errado sem ninguém perceber.
 */

import { analyzeDrawing } from '../src/lib/geometry/analyze';
import { parseDxfFile } from '../src/lib/geometry/dxf';
import { quantityLadder, quotePart, volumeFactor } from '../src/lib/quote/pricing';
import type { PartConfig } from '../src/lib/quote/types';
import { TEMPLATES } from '../src/lib/templates/catalog';
import { exportDxf } from '../src/lib/templates/dxf-export';
import { buildTemplateById, buildTemplateGeometry } from '../src/lib/templates';
import { bendDeduction } from '../src/lib/templates/shapes';
import { defaultValues } from '../src/lib/templates/types';
import {
  arc,
  buildDxf,
  circle,
  dxfWithBlock,
  legacyPolyline,
  line,
  lwpolyline,
  rectangleAsLines,
  lineWithLinetype,
  buildDxfWithLayerTable,
} from './fixtures';

let passed = 0;
let failed = 0;

function check(name: string, actual: number, expected: number, tolerance: number): void {
  const delta = Math.abs(actual - expected);
  if (delta <= tolerance) {
    passed += 1;
    console.log(`  ok   ${name}: ${actual.toFixed(4)} (esperado ${expected.toFixed(4)})`);
  } else {
    failed += 1;
    console.error(
      `  FALHA ${name}: obtido ${actual.toFixed(4)}, esperado ${expected.toFixed(4)} (delta ${delta.toFixed(4)})`,
    );
  }
}

/**
 * Comparação por erro relativo.
 *
 * Necessária onde a referência é uma curva: o achatamento usa polígonos
 * inscritos, que subestimam perímetro e área por construção. O erro é
 * proporcional ao tamanho da peça, então tolerância absoluta não serve.
 */
function checkRelative(name: string, actual: number, expected: number, maxPercent: number): void {
  const percent = expected === 0 ? 0 : (Math.abs(actual - expected) / Math.abs(expected)) * 100;
  if (percent <= maxPercent) {
    passed += 1;
    console.log(`  ok   ${name}: ${actual.toFixed(4)} vs ${expected.toFixed(4)} (${percent.toFixed(4)}%)`);
  } else {
    failed += 1;
    console.error(
      `  FALHA ${name}: ${actual.toFixed(4)} vs ${expected.toFixed(4)} — erro de ${percent.toFixed(4)}%, limite ${maxPercent}%`,
    );
  }
}

function checkTrue(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FALHA ${name} ${detail}`);
  }
}

function load(dxf: string, options = {}) {
  return analyzeDrawing(parseDxfFile(dxf), options);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// --- 1. Retângulo montado com 4 linhas soltas -------------------------------
section('1. Retângulo 100x50 como 4 LINE independentes (exige encadeamento)');
{
  const geometry = load(buildDxf(rectangleAsLines(100, 50)));
  check('comprimento de corte (mm)', geometry.cutLength, 300, 0.001);
  check('área líquida (mm²)', geometry.netArea, 5000, 0.001);
  check('largura da caixa (mm)', geometry.bbox.width, 100, 0.001);
  check('altura da caixa (mm)', geometry.bbox.height, 50, 0.001);
  check('perfurações', geometry.pierces, 1, 0);
  check('contornos abertos', geometry.openChains.length, 0, 0);
  check('corpos', geometry.bodyCount, 1, 0);
}

// --- 2. Círculo -------------------------------------------------------------
section('2. Círculo de raio 20');
{
  const geometry = load(buildDxf(circle(0, 0, 20)));
  // A tolerância de corda de 0,02 mm subestima o perímetro em ~0,03%.
  check('perímetro (mm)', geometry.cutLength, 2 * Math.PI * 20, 0.1);
  check('área (mm²)', geometry.netArea, Math.PI * 400, 2);
  check('perfurações', geometry.pierces, 1, 0);
}

// --- 3. Retângulo com furo --------------------------------------------------
section('3. Retângulo 100x50 com furo Ø20 no centro');
{
  const geometry = load(buildDxf([...rectangleAsLines(100, 50), ...circle(50, 25, 10)]));
  check('comprimento de corte (mm)', geometry.cutLength, 300 + 2 * Math.PI * 10, 0.1);
  check('área líquida (mm²)', geometry.netArea, 5000 - Math.PI * 100, 1);
  check('perfurações', geometry.pierces, 2, 0);
  check('furos', geometry.holeCount, 1, 0);
  check('corpos', geometry.bodyCount, 1, 0);
  checkTrue(
    'furo classificado como profundidade 1',
    geometry.loops.some((loop) => loop.depth === 1),
  );
}

// --- 4. Bulge (arco em polilinha) ------------------------------------------
section('4. LWPOLYLINE com bulge = 1 (semicírculo)');
{
  // De (0,0) a (100,0) com bulge 1 = semicírculo de raio 50, mais o fechamento reto.
  const geometry = load(
    buildDxf(lwpolyline([{ x: 0, y: 0, bulge: 1 }, { x: 100, y: 0 }], true)),
  );
  const expected = Math.PI * 50 + 100;
  check('perímetro (mm)', geometry.cutLength, expected, 0.15);
  check('área (mm²)', geometry.netArea, (Math.PI * 50 * 50) / 2, 3);
}

// --- 5. Retângulo com cantos arredondados ----------------------------------
section('5. Retângulo 80x40 com raio 10 nos cantos (sinal do bulge)');
{
  const r = 10;
  const w = 80;
  const h = 40;
  // Percurso anti-horário: um canto convexo vira à esquerda, logo bulge > 0.
  // O quarto de círculo tem ângulo incluso de 90°, e bulge = tan(90°/4).
  const roundedRect = (bulge: number) =>
    lwpolyline(
      [
        { x: r, y: 0, bulge: 0 },
        { x: w - r, y: 0, bulge },
        { x: w, y: r, bulge: 0 },
        { x: w, y: h - r, bulge },
        { x: w - r, y: h, bulge: 0 },
        { x: r, y: h, bulge },
        { x: 0, y: h - r, bulge: 0 },
        { x: 0, y: r, bulge },
      ],
      true,
    );

  // O perímetro é idêntico nos dois sinais (4 quartos de círculo = 1 círculo),
  // então só a área distingue canto arredondado de canto mordido para dentro.
  const expectedPerimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;

  const convex = load(buildDxf(roundedRect(Math.tan(Math.PI / 8))));
  check('convexo: perímetro (mm)', convex.cutLength, expectedPerimeter, 0.2);
  check('convexo: área (mm²)', convex.netArea, w * h - (4 - Math.PI) * r * r, 2);
  check('convexo: largura da caixa', convex.bbox.width, w, 0.01);
  check('convexo: altura da caixa', convex.bbox.height, h, 0.01);

  // Bulge negativo inverte o sentido do arco: os cantos passam a remover um
  // quarto de disco inteiro de cada vértice.
  const concave = load(buildDxf(roundedRect(-Math.tan(Math.PI / 8))));
  check('côncavo: perímetro (mm)', concave.cutLength, expectedPerimeter, 0.2);
  check('côncavo: área (mm²)', concave.netArea, w * h - 4 * ((Math.PI * r * r) / 4), 2);
}

// --- 6. Arcos encadeados ----------------------------------------------------
section('6. Dois semicírculos ARC formando um círculo Ø60');
{
  const geometry = load(
    buildDxf([...arc(0, 0, 30, 0, 180), ...arc(0, 0, 30, 180, 360)]),
  );
  check('perímetro (mm)', geometry.cutLength, 2 * Math.PI * 30, 0.15);
  check('perfurações', geometry.pierces, 1, 0);
  check('contornos abertos', geometry.openChains.length, 0, 0);
}

// --- 7. Unidades ------------------------------------------------------------
section('7. Quadrado de 1 unidade com $INSUNITS = 1 (polegadas)');
{
  const geometry = load(buildDxf(rectangleAsLines(1, 1), 1));
  check('largura convertida (mm)', geometry.bbox.width, 25.4, 0.001);
  check('perímetro (mm)', geometry.cutLength, 4 * 25.4, 0.001);
  checkTrue('unidade detectada', geometry.source.sourceUnit === 'in');
}

// --- 8. INSERT de bloco -----------------------------------------------------
section('8. INSERT de bloco com translação e escala 2x');
{
  const dxf = dxfWithBlock('FURO', circle(0, 0, 5), { x: 40, y: 30, scale: 2 });
  const geometry = load(dxf);
  check('perímetro (mm)', geometry.cutLength, 2 * Math.PI * 10, 0.1);
  check('centro X da caixa', (geometry.bbox.minX + geometry.bbox.maxX) / 2, 40, 0.01);
  check('centro Y da caixa', (geometry.bbox.minY + geometry.bbox.maxY) / 2, 30, 0.01);
}

// --- 9. POLYLINE legada -----------------------------------------------------
section('9. POLYLINE/VERTEX legada (DXF R12)');
{
  const geometry = load(
    buildDxf(
      legacyPolyline(
        [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 30 },
          { x: 0, y: 30 },
        ],
        true,
      ),
    ),
  );
  check('perímetro (mm)', geometry.cutLength, 180, 0.001);
  check('área (mm²)', geometry.netArea, 1800, 0.001);
}

// --- 10. Layers de dobra e gravação ----------------------------------------
section('10. Separação por layer: DOBRA e GRAVACAO fora do corte');
{
  const dxf = buildDxf([
    ...rectangleAsLines(100, 50),
    ...line(50, 0, 50, 50, 'DOBRA'),
    ...line(10, 10, 40, 10, 'GRAVACAO'),
  ]);
  const geometry = load(dxf, {
    etchLayers: ['GRAVACAO'],
    bendLayers: ['DOBRA'],
  });
  check('comprimento de corte (mm)', geometry.cutLength, 300, 0.001);
  check('comprimento de gravação (mm)', geometry.etchLength, 30, 0.001);
  check('linhas de dobra', geometry.bendLines.length, 1, 0);
  check('comprimento da dobra (mm)', geometry.bendLines[0].length, 50, 0.001);
  check('perfurações (dobra não perfura)', geometry.pierces, 1, 0);
}

// --- 11. Contorno aberto detectado -----------------------------------------
section('11. Contorno aberto é reprovado');
{
  const geometry = load(buildDxf([...line(0, 0, 100, 0), ...line(100, 0, 100, 50)]));
  check('contornos abertos', geometry.openChains.length, 1, 0);
  check('corpos', geometry.bodyCount, 0, 0);
}

// --- 12. Ilha dentro de furo ------------------------------------------------
section('12. Aninhamento de 3 níveis: peça > furo > ilha');
{
  const geometry = load(
    buildDxf([...circle(0, 0, 50), ...circle(0, 0, 30), ...circle(0, 0, 10)]),
  );
  const expectedArea = Math.PI * (2500 - 900 + 100);
  check('área líquida (mm²)', geometry.netArea, expectedArea, 10);
  check('perfurações', geometry.pierces, 3, 0);
  check('furos (profundidade ímpar)', geometry.holeCount, 1, 0);
  checkTrue(
    'ilha tem profundidade 2',
    geometry.loops.some((loop) => loop.depth === 2),
  );
}

// --- 13. Precificação -------------------------------------------------------
section('13. Precificação: placa 100x50 mm em aço 1,50 mm');
{
  const geometry = load(buildDxf([...rectangleAsLines(100, 50), ...circle(50, 25, 10)]));
  const config: PartConfig = {
    materialId: 'aco-1020',
    thicknessMm: 1.5,
    finishId: 'nenhum',
    quantity: 1,
    tappedHoles: 0,
    hardwareInserts: 0,
  };

  const single = quotePart(geometry, config);
  checkTrue('orçamento aprovado (sem bloqueios)', single.ok, JSON.stringify(single.issues, null, 2));
  checkTrue('pedido mínimo aplicado na peça única', single.minimumAdjustment > 0);
  check('total respeita o pedido mínimo', single.totalPrice, 180, 0.01);

  const hundred = quotePart(geometry, { ...config, quantity: 100 });
  checkTrue(
    'unitário de 100 pç é menor que o de 1 pç',
    hundred.unitPrice < single.unitPrice,
    `${hundred.unitPrice} vs ${single.unitPrice}`,
  );
  checkTrue('sem pedido mínimo em 100 pç', hundred.minimumAdjustment === 0);

  // Massa: área líquida x espessura x densidade.
  const expectedMass = ((5000 - Math.PI * 100) / 1e6) * 1.5 * 7.85;
  check('massa unitária (kg)', hundred.unitMassKg, expectedMass, 0.0005);

  const ladder = quantityLadder(geometry, config);
  checkTrue('escada de quantidade preenchida', ladder.length > 0);
  checkTrue(
    'unitário é monotonicamente decrescente',
    ladder.every((row, index) => index === 0 || row.unitPrice <= ladder[index - 1].unitPrice + 1e-9),
    JSON.stringify(ladder.map((r) => [r.quantity, Number(r.unitPrice.toFixed(2))])),
  );

  check('fator de volume em 1 pç', volumeFactor(1), 1, 0);
  check('fator de volume em 100 pç', volumeFactor(100), 0.74, 0);
  check('fator de volume em 3 pç (faixa de 1)', volumeFactor(3), 1, 0);
}

// --- 14. DFM: furo pequeno demais bloqueia ---------------------------------
section('14. DFM: furo Ø1 mm em chapa de 6,35 mm é bloqueio');
{
  const geometry = load(buildDxf([...rectangleAsLines(100, 50), ...circle(50, 25, 0.5)]));
  const quote = quotePart(geometry, {
    materialId: 'aco-1020',
    thicknessMm: 6.35,
    finishId: 'nenhum',
    quantity: 10,
    tappedHoles: 0,
    hardwareInserts: 0,
  });
  checkTrue('orçamento bloqueado', !quote.ok);
  checkTrue(
    'motivo é o furo mínimo',
    quote.issues.some((issue) => issue.id === 'furo-pequeno' && issue.severity === 'bloqueio'),
    JSON.stringify(quote.issues.map((i) => i.id)),
  );
}

// --- 15. DFM: peça maior que a chapa ---------------------------------------
section('15. DFM: peça de 4 m não cabe na chapa');
{
  const geometry = load(buildDxf(rectangleAsLines(4000, 800)));
  const quote = quotePart(geometry, {
    materialId: 'aco-1020',
    thicknessMm: 1.5,
    finishId: 'nenhum',
    quantity: 1,
    tappedHoles: 0,
    hardwareInserts: 0,
  });
  checkTrue(
    'bloqueio por tamanho',
    quote.issues.some((issue) => issue.id === 'peca-grande' && issue.severity === 'bloqueio'),
  );
}

// --- 16. Acabamento incompatível -------------------------------------------
section('16. DFM: anodização em aço carbono é bloqueio');
{
  const geometry = load(buildDxf(rectangleAsLines(100, 50)));
  const quote = quotePart(geometry, {
    materialId: 'aco-1020',
    thicknessMm: 1.5,
    finishId: 'anodizado',
    quantity: 10,
    tappedHoles: 0,
    hardwareInserts: 0,
  });
  checkTrue(
    'bloqueio por acabamento',
    quote.issues.some((issue) => issue.id === 'acabamento-incompativel'),
  );
}

// --- 17. Templates: placa retangular ---------------------------------------
section('17. Template "placa retangular" 120x80, raio 6, 4 furos Ø6');
{
  const built = buildTemplateById('placa-retangular', {
    largura: 120,
    altura: 80,
    raio: 6,
    furos: 1,
    furoDiametro: 6,
    recuo: 12,
  });
  checkTrue('geometria gerada', built.geometry !== null, built.errors.join('; '));

  if (built.geometry) {
    // Contorno: 4 lados retos encurtados pelos raios + 1 círculo completo.
    const contorno = 2 * (120 - 12) + 2 * (80 - 12) + 2 * Math.PI * 6;
    const furos = 4 * (2 * Math.PI * 3);
    check('comprimento de corte (mm)', built.geometry.cutLength, contorno + furos, 0.2);
    check('área líquida (mm²)', built.geometry.netArea, 120 * 80 - (4 - Math.PI) * 36 - 4 * Math.PI * 9, 2);
    check('perfurações', built.geometry.pierces, 5, 0);
    check('furos', built.geometry.holeCount, 4, 0);
    check('caixa: largura', built.geometry.bbox.width, 120, 0.01);
  }
}

// --- 18. Templates: disco -------------------------------------------------
section('18. Template "disco" Ø100 com furo central Ø25');
{
  const built = buildTemplateById('disco', { diametro: 100, furoCentral: 25 });
  checkTrue('geometria gerada', built.geometry !== null, built.errors.join('; '));

  if (built.geometry) {
    checkRelative('comprimento de corte (mm)', built.geometry.cutLength, Math.PI * (100 + 25), 0.1);
    checkRelative('área líquida (mm²)', built.geometry.netArea, Math.PI * (2500 - 156.25), 0.1);
    check('furos', built.geometry.holeCount, 1, 0);
  }
}

// --- 18b. Erro de discretização é comercialmente irrelevante --------------
section('18b. O achatamento de curvas subestima, e o quanto importa');
{
  // Círculo grande: o pior caso relativo de acúmulo de erro do polígono inscrito.
  const geometry = load(buildDxf(circle(0, 0, 250)));
  const perimetroExato = 2 * Math.PI * 250;
  const areaExata = Math.PI * 250 * 250;

  checkTrue(
    'perímetro é subestimado (polígono inscrito), nunca superestimado',
    geometry.cutLength <= perimetroExato,
    `${geometry.cutLength} vs ${perimetroExato}`,
  );
  checkRelative('erro de perímetro em Ø500', geometry.cutLength, perimetroExato, 0.05);
  checkRelative('erro de área em Ø500', geometry.netArea, areaExata, 0.05);
}

// --- 19. Templates: validação geométrica bloqueia o impossível -------------
section('19. Templates rejeitam configurações impossíveis');
{
  const furoMaior = buildTemplateById('disco', { diametro: 50, furoCentral: 60 });
  checkTrue('furo maior que o disco é rejeitado', furoMaior.geometry === null);

  // 40 furos de Ø10 num círculo de furação de Ø60 não cabem.
  const flangeApertada = buildTemplateById('flange', {
    diametro: 200,
    furoCentral: 20,
    bcd: 60,
    quantidade: 40,
    furoDiametro: 10,
    anguloInicial: 0,
  });
  checkTrue(
    'furos sobrepostos no círculo de furação são rejeitados',
    flangeApertada.geometry === null,
  );

  const passoInvalido = buildTemplateById('painel-perfurado', {
    largura: 200,
    altura: 120,
    raio: 5,
    margem: 15,
    furoDiametro: 20,
    passo: 10,
    alternado: 0,
  });
  checkTrue('passo menor que o furo é rejeitado', passoInvalido.geometry === null);

  const valida = buildTemplateById('flange', {
    diametro: 200,
    furoCentral: 80,
    bcd: 150,
    quantidade: 8,
    furoDiametro: 10,
    anguloInicial: 0,
  });
  checkTrue('flange viável é aceita', valida.geometry !== null, valida.errors.join('; '));
  if (valida.geometry) {
    checkRelative(
      'flange: comprimento de corte (mm)',
      valida.geometry.cutLength,
      Math.PI * 200 + Math.PI * 80 + 8 * Math.PI * 10,
      0.1,
    );
  }
}

// --- 20. Templates: desenvolvimento de dobra ------------------------------
section('20. Cantoneira: desenvolvimento de dobra (fator K)');
{
  const espessura = 2;
  const raio = 2;
  const k = 0.44;

  // Referência analítica: BA = (π/2)(R + K·t), setback = (R + t)·tan(45°).
  const allowance = (Math.PI / 2) * (raio + k * espessura);
  const setback = (raio + espessura) * Math.tan(Math.PI / 4);
  const deduction = 2 * setback - allowance;

  const calculated = bendDeduction(espessura, raio, 90, k);
  check('arco da dobra (mm)', calculated.allowance, allowance, 1e-9);
  check('dedução de dobra (mm)', calculated.deduction, deduction, 1e-9);

  const built = buildTemplateById('cantoneira', {
    abaA: 60,
    abaB: 40,
    largura: 50,
    espessura,
    angulo: 90,
    raioInterno: raio,
    fatorK: k,
    furosPorAba: 0,
    furoDiametro: 6,
  });
  checkTrue('cantoneira gerada', built.geometry !== null, built.errors.join('; '));

  if (built.geometry) {
    // O plano é MENOR que a soma das abas: é isso que a dedução corrige.
    check('comprimento planificado (mm)', built.geometry.bbox.width, 60 + 40 - deduction, 0.01);
    checkTrue('plano é menor que a soma das abas', built.geometry.bbox.width < 100);
    check('linhas de dobra', built.geometry.bendLines.length, 1, 0);
    check('dobra não entra no corte (mm)', built.geometry.cutLength, 2 * (60 + 40 - deduction) + 2 * 50, 0.01);
  }
}

// --- 21. Round-trip: exportar DXF e reimportar ----------------------------
section('21. Round-trip: template -> DXF -> parser devolve a mesma peça');
{
  const built = buildTemplateById('barra-furada', {
    comprimento: 300,
    largura: 40,
    pontas: 1,
    quantidade: 6,
    furoDiametro: 8,
    rasgo: 0,
    rasgoCurso: 12,
    margem: 20,
  });
  checkTrue('barra gerada', built.geometry !== null, built.errors.join('; '));

  if (built.geometry) {
    const dxf = exportDxf(built.polylines, { title: 'round-trip' });
    const reimported = load(dxf);

    check('corte preservado (mm)', reimported.cutLength, built.geometry.cutLength, 0.001);
    check('área preservada (mm²)', reimported.netArea, built.geometry.netArea, 0.001);
    check('perfurações preservadas', reimported.pierces, built.geometry.pierces, 0);
    check('furos preservados', reimported.holeCount, built.geometry.holeCount, 0);
    check('largura preservada (mm)', reimported.bbox.width, built.geometry.bbox.width, 0.001);
    check('sem contornos abertos', reimported.openChains.length, 0, 0);
  }
}

// --- 22. Round-trip preserva o layer de dobra -----------------------------
section('22. Round-trip: perfil U preserva as duas dobras');
{
  const built = buildTemplateById('perfil-u', {
    base: 80,
    aba: 30,
    comprimento: 200,
    espessura: 2,
    raioInterno: 2,
    fatorK: 0.44,
  });
  checkTrue('perfil U gerado', built.geometry !== null, built.errors.join('; '));

  if (built.geometry) {
    const dxf = exportDxf(built.polylines, { title: 'perfil-u' });
    const reimported = load(dxf, { bendLayers: ['DOBRA'] });

    check('dobras preservadas', reimported.bendLines.length, 2, 0);
    check('corte preservado (mm)', reimported.cutLength, built.geometry.cutLength, 0.001);
    checkTrue(
      'dobras ficam fora do comprimento de corte',
      Math.abs(reimported.cutLength - 2 * (built.geometry.bbox.width + 200)) < 0.01,
      `${reimported.cutLength}`,
    );
  }
}

// --- 23. Todo template gera geometria válida no padrão --------------------
section('23. Todos os templates são válidos nos valores padrão');
{
  for (const template of TEMPLATES) {
    const built = buildTemplateGeometry(template, defaultValues(template));
    checkTrue(
      `${template.id}: gera geometria`,
      built.geometry !== null && built.geometry.openChains.length === 0,
      built.errors.join('; '),
    );

    if (built.geometry) {
      const quote = quotePart(built.geometry, {
        materialId: 'aco-1020',
        thicknessMm: built.suggestedThicknessMm ?? 2,
        finishId: 'nenhum',
        quantity: 10,
        tappedHoles: 0,
        hardwareInserts: 0,
      });
      checkTrue(
        `${template.id}: orça sem bloqueio`,
        quote.ok,
        quote.issues
          .filter((issue) => issue.severity === 'bloqueio')
          .map((issue) => issue.title)
          .join('; '),
      );
    }
  }
}

// --- 24. Linhas de construção não são corte ---------------------------------
section('24. Linetype de construção é separado do corte');
{
  // Reproduz PeçaTeste3.DXF: quadrado 60x60 Continuous + eixo CENTERX2 que
  // atravessa a peça de borda a borda.
  const dxf = buildDxf([
    ...lineWithLinetype(0, 15, 60, 15, 'CENTERX2'),
    ...lineWithLinetype(0, 0, 60, 0, 'Continuous'),
    ...lineWithLinetype(0, 0, 0, 60, 'Continuous'),
    ...lineWithLinetype(0, 60, 60, 60, 'Continuous'),
    ...lineWithLinetype(60, 0, 60, 60, 'Continuous'),
  ]);
  const geometry = load(dxf);

  check('comprimento de corte (mm)', geometry.cutLength, 240, 0.001);
  check('área líquida (mm²)', geometry.netArea, 3600, 0.001);
  check('perfurações', geometry.pierces, 1, 0);
  check('contornos abertos', geometry.openChains.length, 0, 0);
  check('linhas de construção', geometry.constructionLines.length, 1, 0);
  checkTrue(
    'o eixo não entra na caixa envolvente (não infla o custo de material)',
    Math.abs(geometry.bbox.width - 60) < 1e-6 && Math.abs(geometry.bbox.height - 60) < 1e-6,
  );

  const quote = quotePart(geometry, {
    materialId: 'aco-1020', thicknessMm: 1.5, finishId: 'nenhum',
    quantity: 10, tappedHoles: 0, hardwareInserts: 0,
  });
  checkTrue('peça aprovada', quote.ok, JSON.stringify(quote.issues.map((i) => i.title)));
  checkTrue(
    'o descarte é reportado, não silencioso',
    quote.issues.some((i) => i.id === 'linhas-construcao' && i.severity === 'info'),
  );
}

// --- 25. BYLAYER: o linetype vem da camada ---------------------------------
section('25. BYLAYER resolve pelo linetype da camada');
{
  // Caso típico de CAD real: a entidade não declara linetype; quem define é a
  // camada. Sem ler a tabela LAYER, o eixo voltaria a ser cobrado como corte.
  const dxf = buildDxfWithLayerTable(
    [
      { name: 'CORTE', linetype: 'Continuous' },
      { name: 'EIXOS', linetype: 'CENTER' },
    ],
    [
      ...line(0, 0, 60, 0, 'CORTE'),
      ...line(60, 0, 60, 60, 'CORTE'),
      ...line(60, 60, 0, 60, 'CORTE'),
      ...line(0, 60, 0, 0, 'CORTE'),
      // Sem código 6: herda CENTER da camada EIXOS.
      ...line(-10, 30, 70, 30, 'EIXOS'),
    ],
  );
  const geometry = load(dxf);

  check('comprimento de corte (mm)', geometry.cutLength, 240, 0.001);
  check('linhas de construção', geometry.constructionLines.length, 1, 0);
  check('contornos abertos', geometry.openChains.length, 0, 0);
  checkTrue(
    'linetype resolvido para CENTER',
    geometry.constructionLines[0]?.linetype.toUpperCase() === 'CENTER',
    geometry.constructionLines[0]?.linetype,
  );
  // O eixo vai de -10 a 70, mas a caixa da peça continua 60x60.
  check('caixa ignora o eixo que ultrapassa', geometry.bbox.width, 60, 1e-6);
}

// --- 26. Layer tem precedência sobre linetype ------------------------------
section('26. Dobra em traço-ponto continua sendo dobra');
{
  // Linha de dobra é desenhada em traço-ponto por convenção. Se o linetype
  // vencesse o layer, toda dobra viraria "construção" e sumiria da peça.
  const dxf = buildDxf([
    ...rectangleAsLines(100, 50),
    ...lineWithLinetype(50, 0, 50, 50, 'CENTER', 'DOBRA'),
  ]);
  const geometry = load(dxf, { bendLayers: ['DOBRA'], etchLayers: [] });

  check('linhas de dobra', geometry.bendLines.length, 1, 0);
  check('linhas de construção', geometry.constructionLines.length, 0, 0);
  check('comprimento de corte (mm)', geometry.cutLength, 300, 0.001);
}

// --- 27. Continuous e vazio nunca viram construção ------------------------
section('27. Continuous, SOLID e linetype vazio são corte');
{
  for (const linetype of ['Continuous', 'CONTINUOUS', 'SOLID', '']) {
    const dxf = buildDxf([
      ...lineWithLinetype(0, 0, 40, 0, linetype),
      ...lineWithLinetype(40, 0, 40, 40, linetype),
      ...lineWithLinetype(40, 40, 0, 40, linetype),
      ...lineWithLinetype(0, 40, 0, 0, linetype),
    ]);
    const geometry = load(dxf);
    checkTrue(
      `"${linetype || '(vazio)'}" tratado como corte`,
      geometry.cutLength > 159 && geometry.constructionLines.length === 0,
      `corte=${geometry.cutLength} constr=${geometry.constructionLines.length}`,
    );
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`${passed} verificações passaram, ${failed} falharam.`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);
