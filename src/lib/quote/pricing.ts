/**
 * Motor de precificação.
 *
 * Estrutura do cálculo:
 *
 *   custo variável (por peça)     custo de setup (por pedido)
 *   ------------------------      ---------------------------
 *   material aninhado             programação do corte
 *   tempo de corte                programação de cada dobra
 *   tempo de perfuração           preparo de acabamento
 *   tempo de gravação             preparo de rosca/inserto
 *   manuseio
 *   dobra / rosca / inserto
 *   acabamento
 *
 *   preço unitário = (variável x fator de volume + setup/qtd + taxa/qtd) x (1 + margem)
 *
 * O setup dividido pela quantidade é o que faz a curva de preço cair com o
 * lote — não há desconto arbitrário embutido, apenas diluição real mais o
 * ganho de eficiência de `QUANTITY_BREAKS`.
 */

import type { PartGeometry } from '../geometry';
import {
  QUANTITY_LADDER,
  STATIC_CATALOG,
  findMaterial,
  findThickness,
  type Catalog,
} from './catalog';
import { hasBlockers, validatePart } from './dfm';
import type { PartConfig, PartQuote, PriceLine, QuoteLadderRow } from './types';

const MM2_PER_M2 = 1_000_000;

export function volumeFactor(quantity: number, catalog: Catalog = STATIC_CATALOG): number {
  let factor = 1;
  for (const tier of catalog.quantityBreaks) {
    if (quantity >= tier.minQty) factor = tier.variableFactor;
  }
  return factor;
}

/** Converte segundos de máquina em reais. */
function timeCost(seconds: number, ratePerHour: number): number {
  return (seconds / 3600) * ratePerHour;
}

export function quotePart(
  geometry: PartGeometry,
  config: PartConfig,
  catalog: Catalog = STATIC_CATALOG,
): PartQuote {
  const issues = validatePart(geometry, config, catalog);
  const material = findMaterial(config.materialId, catalog);
  const thickness = material ? findThickness(material, config.thicknessMm) : undefined;
  const quantity = Math.max(1, Math.floor(config.quantity));

  if (!material || !thickness) {
    return blockedQuote(geometry, config, issues);
  }

  const { services: SERVICES, orderConfig: ORDER_CONFIG } = catalog;
  const process = catalog.processes[material.process];
  const finish = catalog.finishes[config.finishId] ?? catalog.finishes.nenhum;

  // --- Material ------------------------------------------------------------
  // A peça ocupa sua caixa envolvente mais a folga de aninhamento (sangria +
  // espaço entre peças). O que sobra dentro dos furos não é reaproveitável.
  const nestingGap = process.kerf + 2;
  const nestedAreaMm2 =
    (geometry.bbox.width + nestingGap) * (geometry.bbox.height + nestingGap);
  const nestedAreaM2 = nestedAreaMm2 / MM2_PER_M2;
  const areaWeightKgPerM2 = thickness.mm * material.density;
  const materialCost =
    nestedAreaM2 * areaWeightKgPerM2 * material.pricePerKg * (1 + material.scrapFactor);

  const unitMassKg = (geometry.netArea / MM2_PER_M2) * areaWeightKgPerM2;
  const materialUtilization = nestedAreaMm2 > 0 ? geometry.netArea / nestedAreaMm2 : 0;

  // --- Corte ---------------------------------------------------------------
  const cutLengthM = geometry.cutLength / 1000;
  const cutSeconds = (cutLengthM / thickness.cutSpeedMPerMin) * 60;
  const cutCost = timeCost(cutSeconds, process.machineRatePerHour);

  const pierceSeconds = geometry.pierces * thickness.pierceSeconds;
  const pierceCost = timeCost(pierceSeconds, process.machineRatePerHour);

  const handlingCost = timeCost(process.handlingSecondsPerPart, process.machineRatePerHour);

  // --- Gravação ------------------------------------------------------------
  const etchLengthM = geometry.etchLength / 1000;
  const etchSeconds = etchLengthM > 0 ? (etchLengthM / SERVICES.etching.speedMPerMin) * 60 : 0;
  const etchCost = timeCost(etchSeconds, process.machineRatePerHour);

  // --- Dobra ---------------------------------------------------------------
  const bendCount = geometry.bendLines.length;
  const bendCost = timeCost(bendCount * SERVICES.bending.secondsPerBend, SERVICES.bending.ratePerHour);

  // --- Rosca e insertos ----------------------------------------------------
  const tapCost = timeCost(
    config.tappedHoles * SERVICES.tapping.secondsPerHole,
    SERVICES.tapping.ratePerHour,
  );
  const hardwareCost =
    timeCost(config.hardwareInserts * SERVICES.hardware.secondsPerInsert, SERVICES.hardware.ratePerHour) +
    config.hardwareInserts * SERVICES.hardware.pricePerInsert;

  // --- Acabamento ----------------------------------------------------------
  // Trata os dois lados da peça mais a área das paredes do contorno.
  const finishAreaM2 =
    (geometry.netArea * 2 + geometry.cutLength * thickness.mm) / MM2_PER_M2;
  const finishCost = finishAreaM2 * finish.pricePerM2 + finish.pricePerPart;

  // --- Setups (por pedido) -------------------------------------------------
  const cutSetup = ORDER_CONFIG.cutSetupCost; // Programação e nesting do arquivo.
  const bendSetup = bendCount * SERVICES.bending.setupPerBendLine;
  const tapSetup = config.tappedHoles > 0 ? SERVICES.tapping.setupCost : 0;
  const hardwareSetup = config.hardwareInserts > 0 ? SERVICES.hardware.setupCost : 0;
  const etchSetup = etchLengthM > 0 ? SERVICES.etching.setupCost : 0;
  const finishSetup = finish.setupCost;

  const totalSetup = cutSetup + bendSetup + tapSetup + hardwareSetup + etchSetup + finishSetup;
  const factor = volumeFactor(quantity, catalog);

  const lines: PriceLine[] = [
    {
      id: 'material',
      label: 'Material',
      detail:
        `${(nestedAreaMm2 / 100).toFixed(1)} cm² aninhados · ${areaWeightKgPerM2.toFixed(2)} kg/m² · ` +
        `R$ ${material.pricePerKg.toFixed(2)}/kg · ${(material.scrapFactor * 100).toFixed(0)}% de perda`,
      unitAmount: materialCost,
      setupAmount: 0,
    },
    {
      id: 'corte',
      label: 'Tempo de corte',
      detail:
        `${cutLengthM.toFixed(2)} m a ${thickness.cutSpeedMPerMin} m/min = ${cutSeconds.toFixed(1)} s · ` +
        `${process.name} a R$ ${process.machineRatePerHour}/h`,
      unitAmount: cutCost,
      setupAmount: 0,
    },
    {
      id: 'perfuracao',
      label: 'Perfurações',
      detail: `${geometry.pierces} furos de entrada x ${thickness.pierceSeconds} s = ${pierceSeconds.toFixed(1)} s`,
      unitAmount: pierceCost,
      setupAmount: 0,
    },
    {
      id: 'manuseio',
      label: 'Manuseio',
      detail: `${process.handlingSecondsPerPart} s por peça (carga, descarga, separação)`,
      unitAmount: handlingCost,
      setupAmount: 0,
    },
    {
      id: 'programacao',
      label: 'Programação e nesting',
      detail: `R$ ${cutSetup.toFixed(2)} por pedido, rateado entre ${quantity} peça(s)`,
      unitAmount: 0,
      setupAmount: cutSetup,
    },
  ];

  if (etchLengthM > 0) {
    lines.push({
      id: 'gravacao',
      label: 'Gravação',
      detail: `${etchLengthM.toFixed(2)} m a ${SERVICES.etching.speedMPerMin} m/min = ${etchSeconds.toFixed(1)} s`,
      unitAmount: etchCost,
      setupAmount: etchSetup,
    });
  }

  if (bendCount > 0) {
    lines.push({
      id: 'dobra',
      label: 'Dobra',
      detail:
        `${bendCount} dobra(s) x ${SERVICES.bending.secondsPerBend} s a R$ ${SERVICES.bending.ratePerHour}/h · ` +
        `setup de R$ ${SERVICES.bending.setupPerBendLine.toFixed(2)} por dobra`,
      unitAmount: bendCost,
      setupAmount: bendSetup,
    });
  }

  if (config.tappedHoles > 0) {
    lines.push({
      id: 'rosca',
      label: 'Rosqueamento',
      detail: `${config.tappedHoles} rosca(s) x ${SERVICES.tapping.secondsPerHole} s`,
      unitAmount: tapCost,
      setupAmount: tapSetup,
    });
  }

  if (config.hardwareInserts > 0) {
    lines.push({
      id: 'insertos',
      label: 'Insertos prensados',
      detail:
        `${config.hardwareInserts} inserto(s) a R$ ${SERVICES.hardware.pricePerInsert.toFixed(2)} ` +
        `+ ${SERVICES.hardware.secondsPerInsert} s de prensagem cada`,
      unitAmount: hardwareCost,
      setupAmount: hardwareSetup,
    });
  }

  if (finish.id !== 'nenhum') {
    lines.push({
      id: 'acabamento',
      label: finish.name,
      detail:
        `${(finishAreaM2 * 10000).toFixed(0)} cm² tratados a R$ ${finish.pricePerM2.toFixed(2)}/m² ` +
        `+ R$ ${finish.pricePerPart.toFixed(2)}/peça`,
      unitAmount: finishCost,
      setupAmount: finishSetup,
    });
  }

  const variableCost = lines.reduce((sum, line) => sum + line.unitAmount, 0);
  const unitCost =
    variableCost * factor + totalSetup / quantity + ORDER_CONFIG.orderHandlingFee / quantity;

  const rawUnitPrice = unitCost * (1 + ORDER_CONFIG.marginRate);
  const rawTotal = rawUnitPrice * quantity;

  // Pedido mínimo: cobre o custo de existir do pedido, não da peça.
  const minimumAdjustment = Math.max(0, ORDER_CONFIG.minimumOrderValue - rawTotal);
  const totalPrice = rawTotal + minimumAdjustment;
  const unitPrice = totalPrice / quantity;

  const leadDays = computeLeadDays(
    process.baseLeadDays,
    {
      bends: bendCount,
      finish: finish.leadDays,
      tapped: config.tappedHoles > 0,
      hardware: config.hardwareInserts > 0,
      quantity,
    },
    SERVICES,
  );

  return {
    ok: !hasBlockers(issues),
    issues,
    lines,
    unitCost,
    unitPrice,
    totalPrice,
    minimumAdjustment,
    leadDays,
    volumeFactor: factor,
    unitMassKg,
    materialUtilization,
    geometry,
    config: { ...config, quantity },
  };
}

function computeLeadDays(
  base: number,
  extras: { bends: number; finish: number; tapped: boolean; hardware: boolean; quantity: number },
  services: Catalog['services'],
): number {
  let days = base;
  if (extras.bends > 0) days += services.bending.leadDays;
  if (extras.tapped) days += services.tapping.leadDays;
  if (extras.hardware) days += services.hardware.leadDays;
  days += extras.finish;

  // Lotes grandes ocupam mais janelas de máquina.
  if (extras.quantity >= 100) days += 1;
  if (extras.quantity >= 500) days += 2;
  if (extras.quantity >= 2000) days += 3;

  return days;
}

function blockedQuote(
  geometry: PartGeometry,
  config: PartConfig,
  issues: PartQuote['issues'],
): PartQuote {
  return {
    ok: false,
    issues,
    lines: [],
    unitCost: 0,
    unitPrice: 0,
    totalPrice: 0,
    minimumAdjustment: 0,
    leadDays: 0,
    volumeFactor: 1,
    unitMassKg: 0,
    materialUtilization: 0,
    geometry,
    config,
  };
}

/** Tabela de faixas: o mesmo desenho cotado em várias quantidades. */
export function quantityLadder(
  geometry: PartGeometry,
  config: PartConfig,
  quantities: readonly number[] = QUANTITY_LADDER,
  catalog: Catalog = STATIC_CATALOG,
): QuoteLadderRow[] {
  const reference = quotePart(geometry, { ...config, quantity: 1 }, catalog);
  if (!reference.ok) return [];

  return quantities.map((quantity) => {
    const quote = quotePart(geometry, { ...config, quantity }, catalog);
    return {
      quantity,
      unitPrice: quote.unitPrice,
      totalPrice: quote.totalPrice,
      savingsPercent:
        reference.unitPrice > 0 ? (1 - quote.unitPrice / reference.unitPrice) * 100 : 0,
    };
  });
}

export function formatCurrency(value: number, catalog: Catalog = STATIC_CATALOG): string {
  return new Intl.NumberFormat(catalog.orderConfig.locale, {
    style: 'currency',
    currency: catalog.orderConfig.currency,
  }).format(value);
}

export function formatNumber(value: number, digits = 1, catalog: Catalog = STATIC_CATALOG): string {
  return new Intl.NumberFormat(catalog.orderConfig.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Data de entrega estimada, pulando fins de semana. */
export function estimateDeliveryDate(leadDays: number, from = new Date()): Date {
  const date = new Date(from);
  let remaining = leadDays;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date;
}
