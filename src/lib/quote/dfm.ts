/**
 * Validação de manufaturabilidade (DFM).
 *
 * Roda antes do preço porque um bloqueio invalida o orçamento: não adianta
 * cotar uma peça com furo menor do que o feixe consegue abrir. Os limites saem
 * do catálogo (razões sobre a espessura), não de constantes soltas.
 */

import {
  findSharpCorners,
  findUncuttableLoops,
  minimumHoleToBendDistance,
  minimumWebWidth,
  smallestHoleDimension,
  suspiciousScale,
  type PartGeometry,
} from '../geometry';
import { STATIC_CATALOG, findMaterial, findThickness, type Catalog } from './catalog';
import type { DfmIssue, PartConfig } from './types';

/** Menor peça que a expedição consegue manusear sem se perder na chapa. */
const MIN_PART_DIMENSION_MM = 8;

/** Acima disso o desenho é denso demais para orçamento instantâneo. */
const MAX_DENSITY_MM_PER_MM2 = 0.35;

export function validatePart(
  geometry: PartGeometry,
  config: PartConfig,
  catalog: Catalog = STATIC_CATALOG,
): DfmIssue[] {
  const issues: DfmIssue[] = [];
  const material = findMaterial(config.materialId, catalog);
  const thickness = material ? findThickness(material, config.thicknessMm) : undefined;

  if (!material || !thickness) {
    issues.push({
      id: 'material-invalido',
      severity: 'bloqueio',
      title: 'Material ou espessura indisponível',
      detail: 'A combinação selecionada não está no catálogo.',
      fix: 'Escolha outra espessura para este material.',
    });
    return issues;
  }

  const process = catalog.processes[material.process];

  checkGeometryIntegrity(geometry, issues);
  checkIntersections(geometry, issues);
  checkDuplicates(geometry, issues);
  checkUncuttableFeatures(geometry, process.kerf, issues);
  checkSharpCorners(geometry, process.kerf, issues);
  checkHoleToBend(geometry, thickness, issues);
  checkSize(geometry, process.sheet, issues);
  checkHoles(geometry, thickness.mm, thickness.minHoleRatio, issues);
  checkWebs(geometry, thickness.mm, thickness.minWebRatio, issues);
  checkDensity(geometry, issues);
  checkScale(geometry, issues);
  checkBends(geometry, thickness, catalog.services.bending.maxBendLength, issues);
  checkServices(geometry, material, config, catalog, issues);
  checkConstruction(geometry, issues);
  checkIgnoredEntities(geometry, issues);

  // Ordena por gravidade para o painel mostrar o que trava primeiro.
  const rank = { bloqueio: 0, atencao: 1, info: 2 } as const;
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function checkGeometryIntegrity(geometry: PartGeometry, issues: DfmIssue[]): void {
  if (geometry.loops.length === 0 && geometry.openChains.length === 0) {
    issues.push({
      id: 'sem-geometria',
      severity: 'bloqueio',
      title: 'Nenhuma geometria de corte encontrada',
      detail:
        'O arquivo foi lido, mas não contém contornos aproveitáveis. ' +
        'Textos, cotas e hachuras não viram trajetória de corte.',
      fix: 'Exporte apenas a geometria 2D do perfil, convertendo textos em contornos.',
    });
    return;
  }

  if (geometry.bodyCount === 0) {
    issues.push({
      id: 'sem-contorno-externo',
      severity: 'bloqueio',
      title: 'Nenhum contorno externo fechado',
      detail: 'A peça precisa de pelo menos um perímetro fechado para ser destacada da chapa.',
      fix: 'Verifique se todas as pontas se encontram e use "join" no CAD antes de exportar.',
    });
  }

  if (geometry.openChains.length > 0) {
    const total = geometry.openChains.reduce((sum, chain) => sum + chain.length, 0);
    issues.push({
      id: 'contorno-aberto',
      severity: 'bloqueio',
      title: `${geometry.openChains.length} contorno(s) aberto(s)`,
      detail:
        `Foram encontrados ${total.toFixed(1)} mm de trajetória que não fecha. ` +
        'Contorno aberto corta a chapa sem destacar a peça.',
      fix: 'Feche os perfis no CAD (comando join/close) ou aumente a tolerância de junção.',
    });
  }

  if (geometry.bodyCount > 1) {
    issues.push({
      id: 'multiplos-corpos',
      severity: 'atencao',
      title: `${geometry.bodyCount} corpos independentes no mesmo arquivo`,
      detail:
        'Cada contorno externo será cortado como uma peça separada, mas todos ' +
        'contam como um único item do pedido.',
      fix: 'Se são peças diferentes, envie um arquivo por peça para orçar cada uma.',
    });
  }
}

function checkSize(
  geometry: PartGeometry,
  sheet: { width: number; height: number },
  issues: DfmIssue[],
): void {
  const { width, height } = geometry.bbox;
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);

  // Considera a peça girada 90°: só não cabe se não couber em nenhuma orientação.
  const sheetLongest = Math.max(sheet.width, sheet.height);
  const sheetShortest = Math.min(sheet.width, sheet.height);

  if (longest > sheetLongest || shortest > sheetShortest) {
    issues.push({
      id: 'peca-grande',
      severity: 'bloqueio',
      title: 'Peça maior que a chapa',
      detail:
        `A peça mede ${longest.toFixed(0)} x ${shortest.toFixed(0)} mm e a chapa útil é ` +
        `${sheetLongest} x ${sheetShortest} mm.`,
      fix: 'Divida a peça ou solicite orçamento manual para chapa especial.',
    });
  }

  if (longest > 0 && longest < MIN_PART_DIMENSION_MM) {
    issues.push({
      id: 'peca-pequena',
      severity: 'bloqueio',
      title: 'Peça abaixo do tamanho mínimo',
      detail: `A maior dimensão é ${longest.toFixed(2)} mm; o mínimo manuseável é ${MIN_PART_DIMENSION_MM} mm.`,
      fix: 'Verifique a unidade do desenho ou agrupe as peças em um chicote com pontes.',
    });
  }
}

function checkHoles(
  geometry: PartGeometry,
  thicknessMm: number,
  minHoleRatio: number,
  issues: DfmIssue[],
): void {
  const minHole = thicknessMm * minHoleRatio;
  const holes = geometry.loops.filter((loop) => loop.depth % 2 === 1);

  let smallest = Infinity;
  let offenders = 0;
  for (const hole of holes) {
    const dimension = smallestHoleDimension(hole);
    if (dimension < smallest) smallest = dimension;
    if (dimension < minHole) offenders += 1;
  }

  if (offenders > 0) {
    issues.push({
      id: 'furo-pequeno',
      severity: 'bloqueio',
      title: `${offenders} furo(s) abaixo do diâmetro mínimo`,
      detail:
        `Nesta espessura (${thicknessMm} mm) o furo mínimo é ${minHole.toFixed(2)} mm. ` +
        `O menor do desenho tem ${smallest.toFixed(2)} mm.`,
      fix: `Aumente os furos para pelo menos ${minHole.toFixed(2)} mm ou use uma chapa mais fina.`,
    });
  }
}

function checkWebs(
  geometry: PartGeometry,
  thicknessMm: number,
  minWebRatio: number,
  issues: DfmIssue[],
): void {
  const minWeb = thicknessMm * minWebRatio;
  const measured = minimumWebWidth(geometry.loops);

  if (Number.isFinite(measured) && measured < minWeb) {
    issues.push({
      id: 'teia-fina',
      severity: 'atencao',
      title: 'Material remanescente muito estreito',
      detail:
        `A menor distância entre dois cortes é ${measured.toFixed(2)} mm, abaixo do ` +
        `recomendado de ${minWeb.toFixed(2)} mm para esta espessura. A região pode ` +
        'deformar ou romper no corte.',
      fix: 'Afaste os furos entre si e das bordas da peça.',
    });
  }
}

function checkDensity(geometry: PartGeometry, issues: DfmIssue[]): void {
  if (geometry.density > MAX_DENSITY_MM_PER_MM2) {
    issues.push({
      id: 'desenho-denso',
      severity: 'atencao',
      title: 'Desenho muito denso',
      detail:
        `São ${geometry.cutLength.toFixed(0)} mm de corte em uma área de ` +
        `${(geometry.bboxArea / 100).toFixed(1)} cm². O tempo de máquina domina o preço.`,
      fix: 'Reduzir número de furos e simplificar contornos derruba o custo rapidamente.',
    });
  }
}

function checkScale(geometry: PartGeometry, issues: DfmIssue[]): void {
  const scale = suspiciousScale(geometry);
  if (scale.suspect && scale.reason) {
    issues.push({
      id: 'escala-suspeita',
      severity: 'atencao',
      title: 'Confirme a escala do desenho',
      detail: scale.reason,
      fix: scale.suggestion
        ? `Se o desenho estiver em ${scale.suggestion}, troque a unidade de origem no painel.`
        : 'Confira as medidas exibidas contra o desenho original.',
    });
  }
}

function checkBends(
  geometry: PartGeometry,
  thickness: { mm: number; bendable: boolean; minFlangeRatio: number; bendRadius: number },
  maxBendLength: number,
  issues: DfmIssue[],
): void {
  if (geometry.bendLines.length === 0) return;

  if (!thickness.bendable) {
    issues.push({
      id: 'espessura-nao-dobravel',
      severity: 'bloqueio',
      title: 'Espessura não dobrável',
      detail: `O desenho tem ${geometry.bendLines.length} linha(s) de dobra, mas ${thickness.mm} mm excede a capacidade da prensa.`,
      fix: 'Escolha uma espessura menor ou remova as dobras do desenho.',
    });
    return;
  }

  const longest = Math.max(...geometry.bendLines.map((bend) => bend.length));
  if (longest > maxBendLength) {
    issues.push({
      id: 'dobra-longa',
      severity: 'bloqueio',
      title: 'Dobra maior que a prensa',
      detail: `A maior dobra tem ${longest.toFixed(0)} mm; o limite é ${maxBendLength} mm.`,
      fix: 'Divida a peça ou solicite orçamento manual.',
    });
  }

  const minFlange = thickness.mm * thickness.minFlangeRatio;
  issues.push({
    id: 'dobra-detectada',
    severity: 'info',
    title: `${geometry.bendLines.length} dobra(s) detectada(s)`,
    detail:
      `Linhas em layer de dobra foram cobradas como operação de prensa, não como corte. ` +
      `Raio interno padrão: ${thickness.bendRadius.toFixed(1)} mm.`,
    fix: `Garanta aba mínima de ${minFlange.toFixed(1)} mm e furos a pelo menos ${(minFlange * 1.5).toFixed(1)} mm da linha de dobra.`,
  });
}

function checkServices(
  geometry: PartGeometry,
  material: { tappable: boolean; finishes: string[]; name: string },
  config: PartConfig,
  catalog: Catalog,
  issues: DfmIssue[],
): void {
  if (config.tappedHoles > 0 && !material.tappable) {
    issues.push({
      id: 'rosca-incompativel',
      severity: 'bloqueio',
      title: 'Material não aceita rosqueamento',
      detail: `${material.name} não sustenta rosca com a confiabilidade exigida.`,
      fix: 'Use inserto prensado ou porca rebitada no lugar da rosca direta.',
    });
  }

  const holes = geometry.loops.filter((loop) => loop.depth % 2 === 1).length;
  if (config.tappedHoles > holes) {
    issues.push({
      id: 'rosca-sem-furo',
      severity: 'atencao',
      title: 'Mais roscas do que furos',
      detail: `Foram pedidas ${config.tappedHoles} roscas, mas o desenho tem ${holes} furo(s).`,
      fix: 'Ajuste a quantidade de roscas ou acrescente os furos no desenho.',
    });
  }

  if (config.hardwareInserts > holes) {
    issues.push({
      id: 'inserto-sem-furo',
      severity: 'atencao',
      title: 'Mais insertos do que furos',
      detail: `Foram pedidos ${config.hardwareInserts} insertos para ${holes} furo(s).`,
      fix: 'Reveja a quantidade de insertos.',
    });
  }

  if (!material.finishes.includes(config.finishId)) {
    const finish = catalog.finishes[config.finishId];
    issues.push({
      id: 'acabamento-incompativel',
      severity: 'bloqueio',
      title: 'Acabamento incompatível com o material',
      detail: `${finish?.name ?? config.finishId} não é aplicável a ${material.name}.`,
      fix: 'Escolha um acabamento da lista disponível para este material.',
    });
  }
}

/**
 * Contornos que se cruzam.
 *
 * Bloqueio, não aviso: um perfil que cruza a si mesmo não tem dentro e fora
 * definidos. A área sai errada, o aninhamento sai errado, e a máquina não sabe
 * de que lado deixar o material.
 */
function checkIntersections(geometry: PartGeometry, issues: DfmIssue[]): void {
  const { intersections } = geometry.quality;
  if (intersections === 0) return;

  issues.push({
    id: 'contorno-cruzado',
    severity: 'bloqueio',
    title: `${intersections} cruzamento(s) de contorno`,
    detail:
      'Há linhas de corte que se cruzam. Um contorno cruzado não define uma ' +
      'região fechada: a área da peça e o lado do material ficam ambíguos.',
    fix: 'Procure os pontos destacados em vermelho no desenho e apare (trim) as sobras nos cruzamentos.',
  });
}

/**
 * Geometria desenhada em duplicidade.
 *
 * Já foi descontada da medição — este aviso existe para o cliente entender por
 * que o preço não bate com a contagem de entidades do CAD dele.
 */
function checkDuplicates(geometry: PartGeometry, issues: DfmIssue[]): void {
  const { duplicateSegments, duplicateLength } = geometry.quality;
  if (duplicateSegments === 0) return;

  issues.push({
    id: 'geometria-duplicada',
    severity: 'atencao',
    title: `${duplicateSegments} segmento(s) sobrepostos`,
    detail:
      `Foram encontrados ${duplicateLength.toFixed(1)} mm de traço desenhado mais de ` +
      'uma vez. Já foram descontados do orçamento — a máquina corta uma vez só. ' +
      'É comum em DXF gerado a partir de PDF ou em bloco explodido duas vezes.',
    fix: 'No CAD, use "overkill"/"purgar duplicados" para limpar o desenho antes de exportar.',
  });
}

/**
 * Recortes menores que o feixe consegue abrir.
 *
 * Diferente do furo mínimo (que é função da espessura), este limite é físico:
 * abaixo da largura de sangria não existe recorte, existe uma marca.
 */
function checkUncuttableFeatures(
  geometry: PartGeometry,
  kerf: number,
  issues: DfmIssue[],
): void {
  const minimum = kerf * 2;
  const tiny = findUncuttableLoops(geometry.loops, minimum);
  if (tiny.length === 0) return;

  const smallest = Math.min(...tiny.map((loop) => Math.min(loop.bbox.width, loop.bbox.height)));
  issues.push({
    id: 'recorte-minusculo',
    severity: 'bloqueio',
    title: `${tiny.length} recorte(s) menores que a sangria`,
    detail:
      `O menor recorte tem ${smallest.toFixed(3)} mm e a sangria do processo é ` +
      `${kerf} mm. Abaixo de ${minimum.toFixed(2)} mm o feixe não abre o recorte, ` +
      'apenas marca o material.',
    fix: 'Aumente o recorte ou remova-o do desenho, se for resíduo de conversão.',
  });
}

/**
 * Cantos agudos demais.
 *
 * O feixe é redondo: um vértice mais fechado que o próprio feixe sai
 * arredondado, e o calor concentrado na ponta queima a borda.
 */
function checkSharpCorners(geometry: PartGeometry, kerf: number, issues: DfmIssue[]): void {
  // Arestas menores que 10x a sangria são discretização de curva, não canto.
  const report = findSharpCorners(geometry.loops, 20, Math.max(kerf * 10, 1));
  if (report.count === 0) return;

  issues.push({
    id: 'canto-agudo',
    severity: 'atencao',
    title: `${report.count} canto(s) muito agudo(s)`,
    detail:
      `O canto mais fechado tem ${report.smallestAngle.toFixed(0)}°. Abaixo de 20° o ` +
      'feixe não reproduz a ponta: ela sai arredondada e a região concentra calor.',
    fix: 'Adicione um pequeno raio na ponta ou abra o ângulo, se a função da peça permitir.',
  });
}

/**
 * Furo perto demais da linha de dobra.
 *
 * Na dobra o material escoa; um furo dentro dessa zona sai oval e puxa a aba
 * para fora de esquadro. A régua usual é o raio interno mais duas espessuras.
 */
function checkHoleToBend(
  geometry: PartGeometry,
  thickness: { mm: number; bendRadius: number },
  issues: DfmIssue[],
): void {
  if (geometry.bendLines.length === 0) return;

  const measured = minimumHoleToBendDistance(geometry.loops, geometry.bendLines);
  if (!Number.isFinite(measured)) return;

  const minimum = thickness.bendRadius + thickness.mm * 2;
  if (measured >= minimum) return;

  issues.push({
    id: 'furo-proximo-dobra',
    severity: 'atencao',
    title: 'Furo dentro da zona de deformação da dobra',
    detail:
      `O furo mais próximo está a ${measured.toFixed(1)} mm da linha de dobra, e o ` +
      `recomendado para esta espessura é ${minimum.toFixed(1)} mm. O furo tende a ` +
      'sair oval e a aba a perder o esquadro.',
    fix: `Afaste o furo para pelo menos ${minimum.toFixed(1)} mm da dobra.`,
  });
}

/**
 * Reporta as linhas de construção que foram descartadas.
 *
 * Descartar geometria em silêncio é o risco real deste filtro: se alguém
 * desenhar um rasgo de verdade em traço tracejado, a peça sairia sem o rasgo e
 * ninguém perceberia até a entrega. Por isso o descarte é sempre informado,
 * com o linetype que motivou a decisão e o caminho para reverter.
 */
function checkConstruction(geometry: PartGeometry, issues: DfmIssue[]): void {
  if (geometry.constructionLines.length === 0) return;

  const byType = new Map<string, number>();
  for (const line of geometry.constructionLines) {
    const key = line.linetype || 'sem linetype';
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  const summary = [...byType.entries()].map(([type, count]) => `${count}x ${type}`).join(', ');

  issues.push({
    id: 'linhas-construcao',
    severity: 'info',
    title: `${geometry.constructionLines.length} linha(s) de construção ignorada(s)`,
    detail:
      `Traço não contínuo indica linha auxiliar (eixo, oculta, fantasma) e não ` +
      `trajetória de corte: ${summary}. Não foram cobradas nem consideradas na ` +
      'checagem de contorno fechado.',
    fix: 'Se alguma delas deveria ser cortada, converta para linha contínua (Continuous) no CAD.',
  });
}

function checkIgnoredEntities(geometry: PartGeometry, issues: DfmIssue[]): void {
  const entries = Object.entries(geometry.source.ignoredEntities);
  if (entries.length === 0) return;

  const summary = entries
    .map(([type, count]) => `${count}x ${type}`)
    .slice(0, 6)
    .join(', ');

  issues.push({
    id: 'entidades-ignoradas',
    severity: 'info',
    title: 'Elementos não cortáveis ignorados',
    detail: `O arquivo contém ${summary}. Esses elementos não geram trajetória e não foram cobrados.`,
    fix: 'Se algum deles deveria ser cortado, converta-o em polilinha antes de exportar.',
  });
}

/** Um orçamento só é emitido se não houver bloqueio. */
export function hasBlockers(issues: readonly DfmIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'bloqueio');
}
