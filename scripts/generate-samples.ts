/**
 * Gera DXFs de exemplo em `public/exemplos/`, para o usuário testar o
 * orçamentista sem precisar abrir um CAD.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyzeDrawing } from '../src/lib/geometry/analyze';
import { parseDxfFile } from '../src/lib/geometry/dxf';
import { buildDxf, circle, line, lwpolyline, rectangleAsLines, type LwVertex } from './fixtures';

const OUT_DIR = join(process.cwd(), 'public', 'exemplos');
mkdirSync(OUT_DIR, { recursive: true });

/** Retângulo de cantos arredondados percorrido no sentido anti-horário. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): LwVertex[] {
  const bulge = Math.tan(Math.PI / 8); // quarto de círculo convexo
  return [
    { x: x + r, y, bulge: 0 },
    { x: x + w - r, y, bulge },
    { x: x + w, y: y + r, bulge: 0 },
    { x: x + w, y: y + h - r, bulge },
    { x: x + w - r, y: y + h, bulge: 0 },
    { x: x + r, y: y + h, bulge },
    { x, y: y + h - r, bulge: 0 },
    { x, y: y + r, bulge },
  ];
}

interface Sample {
  filename: string;
  description: string;
  dxf: string;
}

const samples: Sample[] = [
  {
    filename: 'placa-simples.dxf',
    description: 'Placa 120x80 mm com 4 furos de fixação Ø6',
    dxf: buildDxf([
      ...lwpolyline(roundedRect(0, 0, 120, 80, 8), true),
      ...circle(12, 12, 3),
      ...circle(108, 12, 3),
      ...circle(108, 68, 3),
      ...circle(12, 68, 3),
    ]),
  },
  {
    filename: 'suporte-em-L.dxf',
    description: 'Suporte com linha de dobra em layer DOBRA e logotipo em GRAVACAO',
    dxf: buildDxf([
      ...lwpolyline(roundedRect(0, 0, 160, 90, 6), true),
      // Rasgo oblongo montado com dois arcos e dois lados retos.
      ...lwpolyline(
        [
          { x: 30, y: 30, bulge: 0 },
          { x: 60, y: 30, bulge: 1 },
          { x: 60, y: 45, bulge: 0 },
          { x: 30, y: 45, bulge: 1 },
        ],
        true,
      ),
      ...circle(120, 25, 5),
      ...circle(120, 65, 5),
      // A dobra divide a peça ao meio, no eixo maior.
      ...line(80, 0, 80, 90, 'DOBRA'),
      // Marcação de identificação, apenas superficial.
      ...line(15, 75, 45, 75, 'GRAVACAO'),
      ...line(15, 70, 35, 70, 'GRAVACAO'),
    ]),
  },
  {
    filename: 'flange-circular.dxf',
    description: 'Flange Ø200 com furo central Ø80 e 8 furos Ø10 no diâmetro de 150',
    dxf: buildDxf([
      ...circle(0, 0, 100),
      ...circle(0, 0, 40),
      ...Array.from({ length: 8 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 8;
        return circle(Math.cos(angle) * 75, Math.sin(angle) * 75, 5);
      }).flat(),
    ]),
  },
  {
    filename: 'contorno-aberto.dxf',
    description: 'Caso de erro: perfil que não fecha, para ver o bloqueio de DFM',
    dxf: buildDxf([
      ...line(0, 0, 100, 0),
      ...line(100, 0, 100, 60),
      ...line(100, 60, 0, 60),
      // O quarto lado está faltando de propósito.
    ]),
  },
  {
    filename: 'painel-denso.dxf',
    description: 'Painel perfurado 200x120 com 60 furos — mostra o efeito da densidade no preço',
    dxf: buildDxf([
      ...rectangleAsLines(200, 120),
      ...Array.from({ length: 10 }, (_, column) =>
        Array.from({ length: 6 }, (_, row) =>
          circle(20 + column * 18, 15 + row * 18, 4),
        ).flat(),
      ).flat(),
    ]),
  },
];

console.log('Gerando exemplos e conferindo cada um no motor:\n');

for (const sample of samples) {
  const path = join(OUT_DIR, sample.filename);
  writeFileSync(path, sample.dxf, 'utf8');

  const geometry = analyzeDrawing(parseDxfFile(sample.dxf), {
    etchLayers: ['GRAVACAO'],
    bendLayers: ['DOBRA'],
  });

  console.log(`  ${sample.filename}`);
  console.log(`    ${sample.description}`);
  console.log(
    `    ${geometry.bbox.width.toFixed(1)} x ${geometry.bbox.height.toFixed(1)} mm · ` +
      `${(geometry.cutLength / 1000).toFixed(3)} m de corte · ` +
      `${geometry.pierces} perfurações · ${geometry.holeCount} recortes · ` +
      `${geometry.bendLines.length} dobras · ${geometry.openChains.length} abertos`,
  );
  console.log('');
}

console.log(`${samples.length} arquivos escritos em public/exemplos/`);
