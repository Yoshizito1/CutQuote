/**
 * Catálogo de materiais, processos e serviços.
 *
 * ⚠️ TODOS OS VALORES AQUI SÃO PLACEHOLDERS PLAUSÍVEIS, NÃO PREÇOS REAIS.
 * Este arquivo é o único ponto de calibração do motor: troque os números pelos
 * da sua operação (R$/kg de compra, R$/hora de máquina, velocidades reais de
 * corte) e todo o resto do sistema se ajusta sozinho.
 *
 * O modelo de custo é físico, não tabelado:
 *   custo de corte  = (comprimento / velocidade) x R$/hora de máquina
 *   custo de material = área aninhada x espessura x densidade x R$/kg
 * Isso significa que basta medir a máquina uma vez para o orçamento ficar fiel.
 */

export type CutProcessId = 'laser-fibra' | 'laser-co2' | 'jato-dagua' | 'router-cnc';

export interface CutProcess {
  id: CutProcessId;
  name: string;
  /** Custo-hora da máquina, já com operador e rateio (R$/h). */
  machineRatePerHour: number;
  /** Largura da sangria, em mm — entra na folga de aninhamento. */
  kerf: number;
  /** Segundos de manuseio por peça (carga, descarga, separação). */
  handlingSecondsPerPart: number;
  /** Dias úteis de base para o processo. */
  baseLeadDays: number;
  /** Maior chapa que a máquina aceita, em mm. */
  sheet: { width: number; height: number };
  description: string;
}

export const PROCESSES: Record<CutProcessId, CutProcess> = {
  'laser-fibra': {
    id: 'laser-fibra',
    name: 'Laser de fibra',
    machineRatePerHour: 240,
    kerf: 0.15,
    handlingSecondsPerPart: 8,
    baseLeadDays: 3,
    sheet: { width: 3000, height: 1500 },
    description: 'Metais em geral. Melhor relação custo-precisão para chapa fina.',
  },
  'laser-co2': {
    id: 'laser-co2',
    name: 'Laser CO₂',
    machineRatePerHour: 160,
    kerf: 0.25,
    handlingSecondsPerPart: 6,
    baseLeadDays: 3,
    sheet: { width: 1300, height: 900 },
    description: 'Acrílico, madeira e polímeros. Borda polida em acrílico.',
  },
  'jato-dagua': {
    id: 'jato-dagua',
    name: 'Jato d’água abrasivo',
    machineRatePerHour: 380,
    kerf: 0.9,
    handlingSecondsPerPart: 20,
    baseLeadDays: 6,
    sheet: { width: 2000, height: 1500 },
    description: 'Sem zona termicamente afetada. Compósitos, titânio e chapa grossa.',
  },
  'router-cnc': {
    id: 'router-cnc',
    name: 'Router CNC',
    machineRatePerHour: 130,
    kerf: 3.175,
    handlingSecondsPerPart: 12,
    baseLeadDays: 4,
    sheet: { width: 2440, height: 1220 },
    description: 'Madeira, MDF e plásticos espessos. Fresa de 1/8".',
  },
};

export interface ThicknessOption {
  /** Espessura nominal em mm. */
  mm: number;
  /** Rótulo exibido (inclui bitola quando é referência usual de mercado). */
  label: string;
  /** Velocidade de corte em m/min nessa espessura. */
  cutSpeedMPerMin: number;
  /** Segundos por perfuração inicial. */
  pierceSeconds: number;
  /** Furo mínimo como múltiplo da espessura. */
  minHoleRatio: number;
  /** Teia mínima (material entre dois cortes) como múltiplo da espessura. */
  minWebRatio: number;
  /** Se a espessura é dobrável na prensa. */
  bendable: boolean;
  /** Aba mínima de dobra como múltiplo da espessura. */
  minFlangeRatio: number;
  /** Raio interno de dobra padrão, em mm. */
  bendRadius: number;
  /** Disponível para orçamento instantâneo. */
  available: boolean;
}

export interface Material {
  id: string;
  name: string;
  family: string;
  process: CutProcessId;
  /** g/cm³ — junto com a espessura define o kg/m². */
  density: number;
  /** Preço de compra da matéria-prima, R$/kg. */
  pricePerKg: number;
  /**
   * Sobra de material inevitável no aninhamento (0,18 = 18%). Peças pequenas e
   * de contorno irregular desperdiçam mais chapa.
   */
  scrapFactor: number;
  thicknesses: ThicknessOption[];
  /** Ids de acabamento compatíveis. */
  finishes: string[];
  /** Aceita rosqueamento. */
  tappable: boolean;
  notes?: string;
}

/** Gera a grade de espessuras a partir de uma curva de velocidade do processo. */
function metalThicknesses(
  entries: readonly {
    mm: number;
    label?: string;
    speed: number;
    pierce: number;
    bendable?: boolean;
    available?: boolean;
  }[],
  overrides: Partial<ThicknessOption> = {},
): ThicknessOption[] {
  return entries.map((entry) => ({
    mm: entry.mm,
    label: entry.label ?? `${entry.mm.toFixed(2).replace('.', ',')} mm`,
    cutSpeedMPerMin: entry.speed,
    pierceSeconds: entry.pierce,
    minHoleRatio: 1,
    minWebRatio: 1,
    bendable: entry.bendable ?? entry.mm <= 6,
    minFlangeRatio: 4,
    bendRadius: Math.max(0.5, entry.mm),
    available: entry.available ?? true,
    ...overrides,
  }));
}

export const MATERIALS: Material[] = [
  {
    id: 'aco-1020',
    name: 'Aço carbono SAE 1020',
    family: 'Aço carbono',
    process: 'laser-fibra',
    density: 7.85,
    pricePerKg: 9.5,
    scrapFactor: 0.18,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'zincado', 'pintura-po', 'jateado'],
    notes: 'Oxida sem acabamento. Especifique zincagem ou pintura para uso externo.',
    thicknesses: metalThicknesses([
      { mm: 0.9, label: '0,90 mm (20 ga)', speed: 14, pierce: 0.3 },
      { mm: 1.2, label: '1,20 mm (18 ga)', speed: 12, pierce: 0.35 },
      { mm: 1.5, label: '1,50 mm (16 ga)', speed: 10, pierce: 0.4 },
      { mm: 2.0, label: '2,00 mm (14 ga)', speed: 7.5, pierce: 0.5 },
      { mm: 3.0, label: '3,00 mm (11 ga)', speed: 4.5, pierce: 0.8 },
      { mm: 4.75, label: '4,75 mm (3/16")', speed: 2.4, pierce: 1.4 },
      { mm: 6.35, label: '6,35 mm (1/4")', speed: 1.5, pierce: 2.2 },
      { mm: 9.525, label: '9,53 mm (3/8")', speed: 0.9, pierce: 4.0, bendable: false },
      { mm: 12.7, label: '12,70 mm (1/2")', speed: 0.6, pierce: 6.5, bendable: false },
    ]),
  },
  {
    id: 'inox-304',
    name: 'Aço inox 304',
    family: 'Aço inox',
    process: 'laser-fibra',
    density: 8.0,
    pricePerKg: 42,
    scrapFactor: 0.2,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'escovado', 'jateado', 'eletropolido'],
    notes: 'Padrão para contato com alimentos e ambientes corrosivos.',
    thicknesses: metalThicknesses([
      { mm: 0.8, label: '0,80 mm', speed: 11, pierce: 0.4 },
      { mm: 1.2, label: '1,20 mm', speed: 9, pierce: 0.5 },
      { mm: 1.5, label: '1,50 mm', speed: 7.5, pierce: 0.6 },
      { mm: 2.0, label: '2,00 mm', speed: 5.5, pierce: 0.8 },
      { mm: 3.0, label: '3,00 mm', speed: 3.2, pierce: 1.3 },
      { mm: 4.0, label: '4,00 mm', speed: 2.0, pierce: 2.0 },
      { mm: 6.0, label: '6,00 mm', speed: 1.1, pierce: 3.4 },
      { mm: 8.0, label: '8,00 mm', speed: 0.7, pierce: 5.5, bendable: false },
    ]),
  },
  {
    id: 'inox-316l',
    name: 'Aço inox 316L',
    family: 'Aço inox',
    process: 'laser-fibra',
    density: 8.0,
    pricePerKg: 68,
    scrapFactor: 0.2,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'escovado', 'eletropolido', 'jateado'],
    notes: 'Grau cirúrgico/implantável. Exigido em ambientes com cloretos.',
    thicknesses: metalThicknesses([
      { mm: 0.8, label: '0,80 mm', speed: 10, pierce: 0.45 },
      { mm: 1.2, label: '1,20 mm', speed: 8.5, pierce: 0.55 },
      { mm: 1.5, label: '1,50 mm', speed: 7, pierce: 0.65 },
      { mm: 2.0, label: '2,00 mm', speed: 5, pierce: 0.9 },
      { mm: 3.0, label: '3,00 mm', speed: 3, pierce: 1.4 },
      { mm: 4.0, label: '4,00 mm', speed: 1.8, pierce: 2.2 },
    ]),
  },
  {
    id: 'aluminio-5052',
    name: 'Alumínio 5052-H32',
    family: 'Alumínio',
    process: 'laser-fibra',
    density: 2.68,
    pricePerKg: 48,
    scrapFactor: 0.18,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'anodizado', 'pintura-po', 'jateado'],
    notes: 'Melhor liga para dobra. Padrão para gabinetes e chassis.',
    thicknesses: metalThicknesses([
      { mm: 0.8, label: '0,80 mm', speed: 16, pierce: 0.3 },
      { mm: 1.0, label: '1,00 mm', speed: 15, pierce: 0.3 },
      { mm: 1.6, label: '1,60 mm (1/16")', speed: 12, pierce: 0.4 },
      { mm: 2.0, label: '2,00 mm', speed: 10, pierce: 0.5 },
      { mm: 3.175, label: '3,18 mm (1/8")', speed: 6, pierce: 0.9 },
      { mm: 4.76, label: '4,76 mm (3/16")', speed: 3.5, pierce: 1.5 },
      { mm: 6.35, label: '6,35 mm (1/4")', speed: 2.2, pierce: 2.4 },
    ]),
  },
  {
    id: 'aluminio-6061',
    name: 'Alumínio 6061-T6',
    family: 'Alumínio',
    process: 'laser-fibra',
    density: 2.7,
    pricePerKg: 55,
    scrapFactor: 0.18,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'anodizado', 'jateado'],
    notes: 'Mais resistente que o 5052, porém trinca em dobras fechadas.',
    thicknesses: metalThicknesses(
      [
        { mm: 1.6, label: '1,60 mm (1/16")', speed: 12, pierce: 0.4 },
        { mm: 3.175, label: '3,18 mm (1/8")', speed: 6, pierce: 0.9 },
        { mm: 6.35, label: '6,35 mm (1/4")', speed: 2.2, pierce: 2.4 },
        { mm: 9.525, label: '9,53 mm (3/8")', speed: 1.2, pierce: 4.2, bendable: false },
        { mm: 12.7, label: '12,70 mm (1/2")', speed: 0.7, pierce: 7.0, bendable: false },
      ],
      { minFlangeRatio: 5 },
    ),
  },
  {
    id: 'latao-260',
    name: 'Latão C260',
    family: 'Latão e cobre',
    process: 'laser-fibra',
    density: 8.53,
    pricePerKg: 78,
    scrapFactor: 0.22,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'escovado', 'polido'],
    thicknesses: metalThicknesses([
      { mm: 0.8, label: '0,80 mm', speed: 8, pierce: 0.5 },
      { mm: 1.6, label: '1,60 mm', speed: 5.5, pierce: 0.8 },
      { mm: 3.175, label: '3,18 mm', speed: 2.8, pierce: 1.6 },
    ]),
  },
  {
    id: 'cobre-110',
    name: 'Cobre C110',
    family: 'Latão e cobre',
    process: 'laser-fibra',
    density: 8.94,
    pricePerKg: 96,
    scrapFactor: 0.22,
    tappable: false,
    finishes: ['nenhum', 'rebarbado', 'polido'],
    notes: 'Alta refletividade: corte mais lento e sujeito a análise prévia.',
    thicknesses: metalThicknesses([
      { mm: 0.8, label: '0,80 mm', speed: 6, pierce: 0.7 },
      { mm: 1.6, label: '1,60 mm', speed: 4, pierce: 1.1 },
      { mm: 3.175, label: '3,18 mm', speed: 2, pierce: 2.2 },
    ]),
  },
  {
    id: 'titanio-gr2',
    name: 'Titânio Grau 2',
    family: 'Titânio',
    process: 'jato-dagua',
    density: 4.51,
    pricePerKg: 420,
    scrapFactor: 0.28,
    tappable: true,
    finishes: ['nenhum', 'rebarbado', 'jateado'],
    notes: 'Cortado em jato d’água para evitar zona termicamente afetada.',
    thicknesses: metalThicknesses(
      [
        { mm: 1.0, label: '1,00 mm', speed: 1.4, pierce: 6 },
        { mm: 2.0, label: '2,00 mm', speed: 0.8, pierce: 9 },
        { mm: 3.0, label: '3,00 mm', speed: 0.5, pierce: 12 },
        { mm: 6.0, label: '6,00 mm', speed: 0.25, pierce: 20, bendable: false },
      ],
      { minHoleRatio: 1.5, minWebRatio: 1.5 },
    ),
  },
  {
    id: 'acrilico',
    name: 'Acrílico (PMMA)',
    family: 'Plásticos',
    process: 'laser-co2',
    density: 1.19,
    pricePerKg: 62,
    scrapFactor: 0.2,
    tappable: false,
    finishes: ['nenhum'],
    notes: 'Borda sai polida no laser CO₂. Não dobra a frio.',
    thicknesses: metalThicknesses(
      [
        { mm: 2.0, label: '2,00 mm', speed: 6, pierce: 0.4, bendable: false },
        { mm: 3.0, label: '3,00 mm', speed: 4.5, pierce: 0.5, bendable: false },
        { mm: 5.0, label: '5,00 mm', speed: 2.5, pierce: 0.8, bendable: false },
        { mm: 8.0, label: '8,00 mm', speed: 1.2, pierce: 1.4, bendable: false },
        { mm: 10.0, label: '10,00 mm', speed: 0.8, pierce: 2.0, bendable: false },
      ],
      { minHoleRatio: 1.2, minWebRatio: 1.5 },
    ),
  },
  {
    id: 'policarbonato',
    name: 'Policarbonato',
    family: 'Plásticos',
    process: 'router-cnc',
    density: 1.2,
    pricePerKg: 74,
    scrapFactor: 0.2,
    tappable: false,
    finishes: ['nenhum', 'rebarbado'],
    notes: 'Queima no laser: usinado em router para manter transparência.',
    thicknesses: metalThicknesses(
      [
        { mm: 2.0, label: '2,00 mm', speed: 3.5, pierce: 1.5, bendable: false },
        { mm: 3.0, label: '3,00 mm', speed: 3.0, pierce: 1.8, bendable: false },
        { mm: 6.0, label: '6,00 mm', speed: 1.8, pierce: 2.5, bendable: false },
      ],
      { minHoleRatio: 1.5, minWebRatio: 2 },
    ),
  },
  {
    id: 'mdf',
    name: 'MDF',
    family: 'Madeira',
    process: 'router-cnc',
    density: 0.75,
    pricePerKg: 12,
    scrapFactor: 0.22,
    tappable: false,
    finishes: ['nenhum', 'lixado'],
    thicknesses: metalThicknesses(
      [
        { mm: 3.0, label: '3,00 mm', speed: 5, pierce: 1.2, bendable: false },
        { mm: 6.0, label: '6,00 mm', speed: 4, pierce: 1.5, bendable: false },
        { mm: 9.0, label: '9,00 mm', speed: 3, pierce: 2.0, bendable: false },
        { mm: 15.0, label: '15,00 mm', speed: 1.8, pierce: 3.0, bendable: false },
      ],
      { minHoleRatio: 1.2, minWebRatio: 2 },
    ),
  },
];

export interface Finish {
  id: string;
  name: string;
  /** Custo por m² de área tratada (conta os dois lados). */
  pricePerM2: number;
  /** Custo fixo por pedido (preparo de linha, troca de cor). */
  setupCost: number;
  /** Custo por peça (manuseio, pendura). */
  pricePerPart: number;
  /** Dias úteis somados ao prazo. */
  leadDays: number;
  description: string;
}

export const FINISHES: Record<string, Finish> = {
  nenhum: {
    id: 'nenhum',
    name: 'Sem acabamento',
    pricePerM2: 0,
    setupCost: 0,
    pricePerPart: 0,
    leadDays: 0,
    description: 'Peça sai como cortada, com rebarba e óxido de corte.',
  },
  rebarbado: {
    id: 'rebarbado',
    name: 'Rebarbação',
    pricePerM2: 0,
    setupCost: 35,
    pricePerPart: 2.4,
    leadDays: 1,
    description: 'Remove a aresta viva e o respingo de corte.',
  },
  escovado: {
    id: 'escovado',
    name: 'Escovado (grão 240)',
    pricePerM2: 95,
    setupCost: 60,
    pricePerPart: 3.2,
    leadDays: 2,
    description: 'Acabamento direcional em inox e latão.',
  },
  polido: {
    id: 'polido',
    name: 'Polido espelhado',
    pricePerM2: 210,
    setupCost: 90,
    pricePerPart: 6,
    leadDays: 3,
    description: 'Polimento mecânico progressivo.',
  },
  jateado: {
    id: 'jateado',
    name: 'Jateamento',
    pricePerM2: 78,
    setupCost: 70,
    pricePerPart: 2.8,
    leadDays: 2,
    description: 'Textura fosca uniforme; boa base para pintura.',
  },
  zincado: {
    id: 'zincado',
    name: 'Zincagem eletrolítica',
    pricePerM2: 120,
    setupCost: 140,
    pricePerPart: 3.5,
    leadDays: 4,
    description: 'Proteção contra corrosão em aço carbono.',
  },
  'pintura-po': {
    id: 'pintura-po',
    name: 'Pintura a pó',
    pricePerM2: 165,
    setupCost: 180,
    pricePerPart: 5.5,
    leadDays: 5,
    description: 'Camada epóxi-poliéster curada em estufa.',
  },
  anodizado: {
    id: 'anodizado',
    name: 'Anodização',
    pricePerM2: 195,
    setupCost: 210,
    pricePerPart: 5,
    leadDays: 6,
    description: 'Camada de óxido dura, só para alumínio.',
  },
  eletropolido: {
    id: 'eletropolido',
    name: 'Eletropolimento',
    pricePerM2: 260,
    setupCost: 240,
    pricePerPart: 7,
    leadDays: 6,
    description: 'Passivação e brilho para inox de grau sanitário/médico.',
  },
  lixado: {
    id: 'lixado',
    name: 'Lixado',
    pricePerM2: 45,
    setupCost: 25,
    pricePerPart: 1.8,
    leadDays: 1,
    description: 'Remove a fibra levantada no corte de madeira.',
  },
};

/** Parâmetros dos serviços secundários. */
export const SERVICES = {
  bending: {
    /** Programação da dobra, por dobra distinta e por pedido. */
    setupPerBendLine: 85,
    /** Tempo de ciclo por dobra por peça (segundos). */
    secondsPerBend: 14,
    /** Custo-hora da prensa dobradeira. */
    ratePerHour: 190,
    leadDays: 2,
    /** Comprimento máximo de dobra, em mm. */
    maxBendLength: 2500,
  },
  tapping: {
    setupCost: 45,
    secondsPerHole: 22,
    ratePerHour: 120,
    leadDays: 1,
  },
  hardware: {
    setupCost: 60,
    secondsPerInsert: 18,
    ratePerHour: 130,
    /** Custo médio do inserto em si. */
    pricePerInsert: 3.8,
    leadDays: 1,
  },
  etching: {
    setupCost: 25,
    /** Gravação é mais rápida que corte passante. */
    speedMPerMin: 20,
    leadDays: 0,
  },
} as const;

/**
 * Curva de volume. Além da diluição natural do setup (que o motor já faz ao
 * dividir os custos fixos pela quantidade), há ganho real de eficiência por
 * lote: menos manuseio por peça, aninhamento melhor, menos paradas.
 */
export const QUANTITY_BREAKS: readonly { minQty: number; variableFactor: number }[] = [
  { minQty: 1, variableFactor: 1.0 },
  { minQty: 5, variableFactor: 0.94 },
  { minQty: 10, variableFactor: 0.89 },
  { minQty: 25, variableFactor: 0.84 },
  { minQty: 50, variableFactor: 0.79 },
  { minQty: 100, variableFactor: 0.74 },
  { minQty: 250, variableFactor: 0.7 },
  { minQty: 500, variableFactor: 0.66 },
  { minQty: 1000, variableFactor: 0.62 },
];

/** Quantidades exibidas na tabela de faixas de preço. */
export const QUANTITY_LADDER: readonly number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

export const ORDER_CONFIG = {
  currency: 'BRL',
  locale: 'pt-BR',
  /** Pedido mínimo faturável. Abaixo disso, cobra-se a diferença. */
  minimumOrderValue: 180,
  /** Margem bruta aplicada sobre o custo direto. */
  marginRate: 0.42,
  /** Taxa fixa por pedido (embalagem, emissão, expedição). */
  orderHandlingFee: 28,
  /** Prazo máximo aceito no orçamento instantâneo, em dias úteis. */
  maxInstantLeadDays: 20,
} as const;

export interface ServiceParams {
  bending: {
    setupPerBendLine: number;
    secondsPerBend: number;
    ratePerHour: number;
    leadDays: number;
    maxBendLength: number;
  };
  tapping: { setupCost: number; secondsPerHole: number; ratePerHour: number; leadDays: number };
  hardware: {
    setupCost: number;
    secondsPerInsert: number;
    ratePerHour: number;
    pricePerInsert: number;
    leadDays: number;
  };
  etching: { setupCost: number; speedMPerMin: number; leadDays: number };
}

export interface OrderConfig {
  currency: string;
  locale: string;
  minimumOrderValue: number;
  marginRate: number;
  orderHandlingFee: number;
  maxInstantLeadDays: number;
  /** Custo de programação e nesting, por pedido. */
  cutSetupCost: number;
}

export interface QuantityBreak {
  minQty: number;
  variableFactor: number;
}

/**
 * Catálogo completo como estrutura de dados.
 *
 * Existir como objeto (e não como constantes soltas) é o que permite o mesmo
 * motor rodar com o catálogo estático deste arquivo OU com uma versão vinda do
 * banco — e, principalmente, com o catálogo **congelado** dentro de um
 * orçamento antigo, para que republicar preços não altere valores já enviados.
 */
export interface Catalog {
  /** Identifica a origem: 'static' ou o id da versão publicada no banco. */
  versionId: string;
  label: string;
  processes: Record<CutProcessId, CutProcess>;
  materials: Material[];
  finishes: Record<string, Finish>;
  services: ServiceParams;
  quantityBreaks: QuantityBreak[];
  orderConfig: OrderConfig;
}

/** Catálogo padrão, embutido no código. Serve de semente e de fallback. */
export const STATIC_CATALOG: Catalog = {
  versionId: 'static',
  label: 'Catálogo padrão (código)',
  processes: PROCESSES,
  materials: MATERIALS,
  finishes: FINISHES,
  services: SERVICES as unknown as ServiceParams,
  quantityBreaks: [...QUANTITY_BREAKS],
  orderConfig: { ...ORDER_CONFIG, cutSetupCost: 65 },
};

export function findMaterial(
  materialId: string,
  catalog: Catalog = STATIC_CATALOG,
): Material | undefined {
  return catalog.materials.find((material) => material.id === materialId);
}

export function findThickness(material: Material, mm: number): ThicknessOption | undefined {
  return material.thicknesses.find((thickness) => Math.abs(thickness.mm - mm) < 1e-6);
}

export function materialFamilies(catalog: Catalog = STATIC_CATALOG): string[] {
  return [...new Set(catalog.materials.map((material) => material.family))];
}

/** kg por m² de chapa nessa espessura. */
export function areaWeight(material: Material, thicknessMm: number): number {
  return thicknessMm * material.density;
}

/** Cópia profunda — usada ao congelar o catálogo dentro de um orçamento. */
export function cloneCatalog(catalog: Catalog): Catalog {
  return JSON.parse(JSON.stringify(catalog)) as Catalog;
}
