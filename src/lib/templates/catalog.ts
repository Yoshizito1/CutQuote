/**
 * Catálogo de templates paramétricos.
 *
 * Cada template gera a mesma estrutura de polilinhas que sairia de um DXF, com
 * as mesmas convenções de layer (`DOBRA` vira operação de prensa). Isso garante
 * que uma peça configurada aqui e a mesma peça importada de CAD passem pelo
 * motor exatamente do mesmo jeito, sem caminho paralelo de cálculo.
 */

import type { Polyline } from '../geometry/types';
import {
  bendDeduction,
  boltCircle,
  circleRing,
  holeGrid,
  linearHoles,
  regularPolygonRing,
  roundedRectRing,
  slotRing,
} from './shapes';
import type { PartTemplate, ParamValues, TemplateBuildResult } from './types';

/** Converte anéis em polilinhas fechadas de um layer. */
function rings(list: readonly (readonly { x: number; y: number }[])[], layer = 'CORTE'): Polyline[] {
  return list.map((points) => ({ points: [...points], closed: true, layer, linetype: 'CONTINUOUS' }));
}

function ok(polylines: Polyline[], notes: string[] = [], suggestedThicknessMm?: number): TemplateBuildResult {
  return { polylines, errors: [], notes, suggestedThicknessMm };
}

function fail(...errors: string[]): TemplateBuildResult {
  return { polylines: [], errors, notes: [] };
}

// ---------------------------------------------------------------------------

const placaRetangular: PartTemplate = {
  id: 'placa-retangular',
  name: 'Placa retangular',
  category: 'Placas',
  description: 'Retângulo com cantos arredondados e furação de fixação nos cantos.',
  params: [
    { id: 'largura', label: 'Largura', type: 'number', unit: 'mm', min: 10, max: 2000, step: 1, default: 120, group: 'Contorno' },
    { id: 'altura', label: 'Altura', type: 'number', unit: 'mm', min: 10, max: 2000, step: 1, default: 80, group: 'Contorno' },
    { id: 'raio', label: 'Raio dos cantos', type: 'number', unit: 'mm', min: 0, max: 200, step: 0.5, default: 6, group: 'Contorno' },
    { id: 'furos', label: 'Furos de canto', type: 'boolean', default: 1, group: 'Furação' },
    {
      id: 'furoDiametro',
      label: 'Diâmetro do furo',
      type: 'number',
      unit: 'mm',
      min: 1,
      max: 60,
      step: 0.5,
      default: 6,
      group: 'Furação',
      visibleWhen: (values) => values.furos === 1,
    },
    {
      id: 'recuo',
      label: 'Recuo da borda',
      type: 'number',
      unit: 'mm',
      min: 3,
      max: 200,
      step: 0.5,
      default: 12,
      hint: 'Distância do centro do furo até as duas bordas mais próximas.',
      group: 'Furação',
      visibleWhen: (values) => values.furos === 1,
    },
  ],
  build: (values) => {
    const { largura, altura, raio, furos, furoDiametro, recuo } = values;
    if (raio > Math.min(largura, altura) / 2) {
      return fail('O raio dos cantos não pode passar de metade da menor dimensão.');
    }

    const polylines = rings([roundedRectRing(0, 0, largura, altura, raio)]);
    const notes: string[] = [];

    if (furos === 1) {
      const r = furoDiametro / 2;
      if (recuo <= r) return fail('O recuo precisa ser maior que o raio do furo.');
      if (recuo * 2 >= Math.min(largura, altura)) {
        return fail('O recuo é grande demais: os furos se sobrepõem no centro.');
      }
      polylines.push(
        ...rings([
          circleRing(recuo, recuo, r),
          circleRing(largura - recuo, recuo, r),
          circleRing(largura - recuo, altura - recuo, r),
          circleRing(recuo, altura - recuo, r),
        ]),
      );

      // A distância do furo ao canto arredondado é menor que o recuo ortogonal.
      const diagonal = Math.hypot(recuo - raio, recuo - raio);
      if (raio > 0 && diagonal + r > raio) {
        notes.push('Os furos ficam próximos do canto arredondado — confira a folga no preview.');
      }
    }
    return ok(polylines, notes);
  },
};

const disco: PartTemplate = {
  id: 'disco',
  name: 'Disco / arruela',
  category: 'Placas',
  description: 'Círculo com furo central opcional.',
  params: [
    { id: 'diametro', label: 'Diâmetro externo', type: 'number', unit: 'mm', min: 10, max: 2000, step: 1, default: 100 },
    { id: 'furoCentral', label: 'Furo central', type: 'number', unit: 'mm', min: 0, max: 1900, step: 0.5, default: 25, hint: '0 remove o furo.' },
  ],
  build: (values) => {
    const { diametro, furoCentral } = values;
    if (furoCentral >= diametro) return fail('O furo central precisa ser menor que o diâmetro externo.');

    const list = [circleRing(0, 0, diametro / 2)];
    if (furoCentral > 0) list.push(circleRing(0, 0, furoCentral / 2));

    const notes: string[] = [];
    if (furoCentral > 0 && (diametro - furoCentral) / 2 < diametro * 0.05) {
      notes.push('A parede resultante é muito fina em relação ao diâmetro; verifique a rigidez.');
    }
    return ok(rings(list), notes);
  },
};

const flange: PartTemplate = {
  id: 'flange',
  name: 'Flange com furação',
  category: 'Placas',
  description: 'Disco com furo central e furos distribuídos em círculo de furação.',
  params: [
    { id: 'diametro', label: 'Diâmetro externo', type: 'number', unit: 'mm', min: 30, max: 2000, step: 1, default: 200, group: 'Contorno' },
    { id: 'furoCentral', label: 'Furo central', type: 'number', unit: 'mm', min: 0, max: 1900, step: 1, default: 80, group: 'Contorno' },
    { id: 'bcd', label: 'Círculo de furação', type: 'number', unit: 'mm', min: 10, max: 1900, step: 1, default: 150, group: 'Furação' },
    { id: 'quantidade', label: 'Número de furos', type: 'integer', unit: 'un.', min: 2, max: 48, step: 1, default: 8, group: 'Furação' },
    { id: 'furoDiametro', label: 'Diâmetro dos furos', type: 'number', unit: 'mm', min: 1, max: 100, step: 0.5, default: 10, group: 'Furação' },
    { id: 'anguloInicial', label: 'Ângulo do primeiro furo', type: 'number', unit: '°', min: 0, max: 360, step: 1, default: 0, group: 'Furação' },
  ],
  build: (values) => {
    const { diametro, furoCentral, bcd, quantidade, furoDiametro, anguloInicial } = values;
    const r = furoDiametro / 2;

    if (furoCentral >= diametro) return fail('O furo central precisa ser menor que o diâmetro externo.');
    if (bcd / 2 + r > diametro / 2) return fail('Os furos do círculo de furação saem da borda externa.');
    if (bcd / 2 - r < furoCentral / 2) return fail('Os furos do círculo de furação invadem o furo central.');

    // Distância entre centros de dois furos vizinhos no círculo de furação.
    const spacing = 2 * (bcd / 2) * Math.sin(Math.PI / quantidade);
    if (spacing <= furoDiametro) {
      return fail(
        `Com ${quantidade} furos de Ø${furoDiametro} mm nesse círculo, os furos se sobrepõem ` +
          `(espaçamento de ${spacing.toFixed(1)} mm entre centros).`,
      );
    }

    const list = [circleRing(0, 0, diametro / 2)];
    if (furoCentral > 0) list.push(circleRing(0, 0, furoCentral / 2));
    list.push(...boltCircle(0, 0, bcd, quantidade, furoDiametro, (anguloInicial * Math.PI) / 180));

    const notes: string[] = [];
    const web = spacing - furoDiametro;
    if (web < furoDiametro) {
      notes.push(`Material entre furos vizinhos: ${web.toFixed(1)} mm. Confirme na aba Análise.`);
    }
    return ok(rings(list), notes);
  },
};

const cantoneira: PartTemplate = {
  id: 'cantoneira',
  name: 'Cantoneira em L',
  category: 'Dobrados',
  description:
    'Suporte de duas abas com linha de dobra. O comprimento planificado já desconta o desenvolvimento da dobra.',
  params: [
    { id: 'abaA', label: 'Aba A', type: 'number', unit: 'mm', min: 5, max: 1000, step: 1, default: 60, hint: 'Medida externa.', group: 'Geometria' },
    { id: 'abaB', label: 'Aba B', type: 'number', unit: 'mm', min: 5, max: 1000, step: 1, default: 40, hint: 'Medida externa.', group: 'Geometria' },
    { id: 'largura', label: 'Largura', type: 'number', unit: 'mm', min: 5, max: 2000, step: 1, default: 50, group: 'Geometria' },
    { id: 'espessura', label: 'Espessura', type: 'number', unit: 'mm', min: 0.5, max: 12, step: 0.1, default: 2, group: 'Dobra' },
    { id: 'angulo', label: 'Ângulo da dobra', type: 'number', unit: '°', min: 15, max: 165, step: 1, default: 90, group: 'Dobra' },
    { id: 'raioInterno', label: 'Raio interno', type: 'number', unit: 'mm', min: 0.2, max: 50, step: 0.1, default: 2, group: 'Dobra' },
    {
      id: 'fatorK',
      label: 'Fator K',
      type: 'number',
      min: 0.25,
      max: 0.5,
      step: 0.01,
      default: 0.44,
      hint: 'Posição da linha neutra. 0,44 é típico de aço; alumínio fica perto de 0,41.',
      group: 'Dobra',
    },
    { id: 'furosPorAba', label: 'Furos por aba', type: 'integer', unit: 'un.', min: 0, max: 10, step: 1, default: 2, group: 'Furação' },
    {
      id: 'furoDiametro',
      label: 'Diâmetro dos furos',
      type: 'number',
      unit: 'mm',
      min: 1,
      max: 40,
      step: 0.5,
      default: 6,
      group: 'Furação',
      visibleWhen: (values) => values.furosPorAba > 0,
    },
  ],
  build: (values) => {
    const { abaA, abaB, largura, espessura, angulo, raioInterno, fatorK, furosPorAba, furoDiametro } =
      values;

    const { deduction, allowance } = bendDeduction(espessura, raioInterno, angulo, fatorK);
    const comprimentoPlano = abaA + abaB - deduction;

    if (comprimentoPlano <= 0) {
      return fail('As abas são pequenas demais para o raio de dobra informado.');
    }

    const minFlange = espessura * 4 + raioInterno;
    const notes: string[] = [
      `Desenvolvimento: ${abaA} + ${abaB} − ${deduction.toFixed(2)} mm de dedução = ` +
        `${comprimentoPlano.toFixed(2)} mm de chapa plana (arco da dobra: ${allowance.toFixed(2)} mm).`,
    ];
    if (abaA < minFlange || abaB < minFlange) {
      notes.push(
        `Aba mínima recomendada para esta espessura: ${minFlange.toFixed(1)} mm. ` +
          'Abas menores escorregam na prensa.',
      );
    }

    // A linha de dobra fica onde a aba A termina, já no plano.
    const posicaoDobra = abaA - deduction / 2;
    const polylines = rings([roundedRectRing(0, 0, comprimentoPlano, largura, 0)]);

    polylines.push({
      points: [
        { x: posicaoDobra, y: 0 },
        { x: posicaoDobra, y: largura },
      ],
      closed: false,
      linetype: 'CONTINUOUS',
      layer: 'DOBRA',
    });

    if (furosPorAba > 0) {
      const r = furoDiametro / 2;
      // Mantém os furos afastados da zona de deformação da dobra.
      const zonaDobra = raioInterno + espessura * 2;
      const centroA = posicaoDobra / 2;
      const centroB = posicaoDobra + (comprimentoPlano - posicaoDobra) / 2;

      if (posicaoDobra - zonaDobra < r * 2 || comprimentoPlano - posicaoDobra - zonaDobra < r * 2) {
        notes.push('As abas são curtas para a furação escolhida; confira a distância furo–dobra.');
      }

      const margem = Math.max(r * 2, largura * 0.15);
      polylines.push(
        ...rings(
          linearHoles(
            { x: centroA, y: margem },
            { x: centroA, y: largura - margem },
            furosPorAba,
            furoDiametro,
          ),
        ),
        ...rings(
          linearHoles(
            { x: centroB, y: margem },
            { x: centroB, y: largura - margem },
            furosPorAba,
            furoDiametro,
          ),
        ),
      );
    }

    return ok(polylines, notes, espessura);
  },
};

const painelPerfurado: PartTemplate = {
  id: 'painel-perfurado',
  name: 'Painel perfurado',
  category: 'Painéis',
  description: 'Chapa com malha de furos, em linha ou alternada. Muitos furos elevam bastante o custo.',
  params: [
    { id: 'largura', label: 'Largura', type: 'number', unit: 'mm', min: 20, max: 2000, step: 1, default: 200, group: 'Contorno' },
    { id: 'altura', label: 'Altura', type: 'number', unit: 'mm', min: 20, max: 2000, step: 1, default: 120, group: 'Contorno' },
    { id: 'raio', label: 'Raio dos cantos', type: 'number', unit: 'mm', min: 0, max: 200, step: 0.5, default: 5, group: 'Contorno' },
    { id: 'margem', label: 'Margem sem furos', type: 'number', unit: 'mm', min: 2, max: 300, step: 1, default: 15, group: 'Malha' },
    { id: 'furoDiametro', label: 'Diâmetro do furo', type: 'number', unit: 'mm', min: 0.5, max: 100, step: 0.5, default: 6, group: 'Malha' },
    { id: 'passo', label: 'Passo entre furos', type: 'number', unit: 'mm', min: 1, max: 300, step: 0.5, default: 14, group: 'Malha' },
    {
      id: 'alternado',
      label: 'Malha alternada',
      type: 'boolean',
      default: 1,
      hint: 'Desloca as linhas ímpares em meio passo.',
      group: 'Malha',
    },
  ],
  build: (values) => {
    const { largura, altura, raio, margem, furoDiametro, passo, alternado } = values;

    if (passo <= furoDiametro) {
      return fail('O passo precisa ser maior que o diâmetro do furo, senão os furos se cruzam.');
    }
    if (margem * 2 >= Math.min(largura, altura)) {
      return fail('A margem consome toda a área útil do painel.');
    }

    const area = {
      x: margem,
      y: margem,
      width: largura - margem * 2,
      height: altura - margem * 2,
    };
    const furos = holeGrid(area, passo, alternado === 1 ? passo * 0.866 : passo, furoDiametro, alternado === 1);

    const notes: string[] = [`${furos.length} furos gerados.`];
    const teia = passo - furoDiametro;
    notes.push(`Material entre furos: ${teia.toFixed(1)} mm.`);
    if (furos.length > 400) {
      notes.push('Acima de ~400 furos o tempo de perfuração domina o preço. Considere aumentar o passo.');
    }

    return ok(
      [...rings([roundedRectRing(0, 0, largura, altura, raio)]), ...rings(furos)],
      notes,
    );
  },
};

const cartela: PartTemplate = {
  id: 'cartela',
  name: 'Cartela triangular',
  category: 'Reforços',
  description: 'Reforço de canto (gusset) com hipotenusa reta ou côncava.',
  params: [
    { id: 'catetoA', label: 'Cateto horizontal', type: 'number', unit: 'mm', min: 20, max: 1000, step: 1, default: 100, group: 'Geometria' },
    { id: 'catetoB', label: 'Cateto vertical', type: 'number', unit: 'mm', min: 20, max: 1000, step: 1, default: 100, group: 'Geometria' },
    { id: 'raioCanto', label: 'Raio do canto reto', type: 'number', unit: 'mm', min: 0, max: 100, step: 0.5, default: 8, group: 'Geometria' },
    { id: 'furoDiametro', label: 'Diâmetro dos furos', type: 'number', unit: 'mm', min: 0, max: 40, step: 0.5, default: 8, hint: '0 remove a furação.', group: 'Furação' },
    { id: 'recuo', label: 'Recuo dos furos', type: 'number', unit: 'mm', min: 5, max: 200, step: 1, default: 20, group: 'Furação' },
  ],
  build: (values) => {
    const { catetoA, catetoB, raioCanto, furoDiametro, recuo } = values;
    if (raioCanto > Math.min(catetoA, catetoB) / 2) {
      return fail('O raio do canto é grande demais para os catetos informados.');
    }

    // Triângulo retângulo com o ângulo reto arredondado, percorrido anti-horário.
    const contorno = [
      { x: raioCanto, y: 0 },
      { x: catetoA, y: 0 },
      { x: 0, y: catetoB },
      { x: 0, y: raioCanto },
    ];

    if (raioCanto > 0) {
      const steps = 12;
      const arc: { x: number; y: number }[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const angle = Math.PI + (Math.PI / 2) * (i / steps);
        arc.push({
          x: raioCanto + raioCanto * Math.cos(angle),
          y: raioCanto + raioCanto * Math.sin(angle),
        });
      }
      contorno.splice(3, 0, ...arc.reverse());
    }

    const list = [contorno];
    const notes: string[] = [];

    if (furoDiametro > 0) {
      const r = furoDiametro / 2;
      if (recuo <= r) return fail('O recuo precisa ser maior que o raio do furo.');
      if (recuo >= Math.min(catetoA, catetoB) * 0.6) {
        return fail('O recuo é grande demais e joga os furos para fora da cartela.');
      }
      list.push(circleRing(recuo * 1.6, recuo, r), circleRing(recuo, recuo * 1.6, r));
      notes.push('Os furos ficam sobre os catetos, afastados da hipotenusa.');
    }

    return ok(rings(list), notes);
  },
};

const barraFurada: PartTemplate = {
  id: 'barra-furada',
  name: 'Barra com furação linear',
  category: 'Placas',
  description: 'Barra chata com furos ou rasgos igualmente espaçados ao longo do comprimento.',
  params: [
    { id: 'comprimento', label: 'Comprimento', type: 'number', unit: 'mm', min: 20, max: 2500, step: 1, default: 300, group: 'Contorno' },
    { id: 'largura', label: 'Largura', type: 'number', unit: 'mm', min: 8, max: 500, step: 1, default: 40, group: 'Contorno' },
    { id: 'pontas', label: 'Pontas arredondadas', type: 'boolean', default: 1, group: 'Contorno' },
    { id: 'quantidade', label: 'Número de furos', type: 'integer', unit: 'un.', min: 1, max: 60, step: 1, default: 6, group: 'Furação' },
    { id: 'furoDiametro', label: 'Diâmetro / largura', type: 'number', unit: 'mm', min: 1, max: 100, step: 0.5, default: 8, group: 'Furação' },
    {
      id: 'rasgo',
      label: 'Usar rasgo oblongo',
      type: 'boolean',
      default: 0,
      hint: 'Rasgo permite ajuste na montagem.',
      group: 'Furação',
    },
    {
      id: 'rasgoCurso',
      label: 'Curso do rasgo',
      type: 'number',
      unit: 'mm',
      min: 1,
      max: 200,
      step: 0.5,
      default: 12,
      group: 'Furação',
      visibleWhen: (values) => values.rasgo === 1,
    },
    { id: 'margem', label: 'Margem nas pontas', type: 'number', unit: 'mm', min: 3, max: 300, step: 1, default: 20, group: 'Furação' },
  ],
  build: (values) => {
    const { comprimento, largura, pontas, quantidade, furoDiametro, rasgo, rasgoCurso, margem } = values;

    if (furoDiametro >= largura) return fail('O furo é mais largo que a barra.');
    if (margem * 2 >= comprimento) return fail('As margens consomem todo o comprimento.');

    const raioContorno = pontas === 1 ? largura / 2 : 0;
    const list = [roundedRectRing(0, 0, comprimento, largura, raioContorno)];
    const cy = largura / 2;

    const util = comprimento - margem * 2;
    const passo = quantidade > 1 ? util / (quantidade - 1) : 0;
    const larguraFuro = rasgo === 1 ? furoDiametro + rasgoCurso : furoDiametro;

    if (quantidade > 1 && passo <= larguraFuro) {
      return fail(
        `Os furos se sobrepõem: passo de ${passo.toFixed(1)} mm para elementos de ` +
          `${larguraFuro.toFixed(1)} mm.`,
      );
    }

    for (let i = 0; i < quantidade; i += 1) {
      const cx = quantidade === 1 ? comprimento / 2 : margem + passo * i;
      list.push(
        rasgo === 1
          ? slotRing(cx, cy, rasgoCurso, furoDiametro)
          : circleRing(cx, cy, furoDiametro / 2),
      );
    }

    const notes: string[] = [];
    if (quantidade > 1) notes.push(`Passo entre centros: ${passo.toFixed(2)} mm.`);
    if (rasgo === 1) notes.push(`Cada rasgo permite ${rasgoCurso} mm de ajuste.`);

    return ok(rings(list), notes);
  },
};

const placaPoligonal: PartTemplate = {
  id: 'placa-poligonal',
  name: 'Placa poligonal',
  category: 'Placas',
  description: 'Polígono regular com furo central opcional — base de mesa, tampa, gabarito.',
  params: [
    { id: 'lados', label: 'Número de lados', type: 'integer', unit: 'un.', min: 3, max: 24, step: 1, default: 6 },
    { id: 'diametro', label: 'Diâmetro circunscrito', type: 'number', unit: 'mm', min: 15, max: 2000, step: 1, default: 120 },
    { id: 'rotacao', label: 'Rotação', type: 'number', unit: '°', min: 0, max: 360, step: 1, default: 0 },
    { id: 'furoCentral', label: 'Furo central', type: 'number', unit: 'mm', min: 0, max: 1900, step: 0.5, default: 20, hint: '0 remove o furo.' },
  ],
  build: (values) => {
    const { lados, diametro, rotacao, furoCentral } = values;
    const raio = diametro / 2;
    // Apótema: distância do centro ao meio do lado, o ponto mais estreito.
    const apotema = raio * Math.cos(Math.PI / lados);

    if (furoCentral / 2 >= apotema) {
      return fail('O furo central ultrapassa a face mais próxima do polígono.');
    }

    const list = [regularPolygonRing(0, 0, raio, lados, (rotacao * Math.PI) / 180)];
    if (furoCentral > 0) list.push(circleRing(0, 0, furoCentral / 2));

    const notes = [
      `Distância entre faces opostas: ${(apotema * 2).toFixed(1)} mm. ` +
        `Lado: ${(2 * raio * Math.sin(Math.PI / lados)).toFixed(1)} mm.`,
    ];
    return ok(rings(list), notes);
  },
};

const perfilU: PartTemplate = {
  id: 'perfil-u',
  name: 'Perfil U',
  category: 'Dobrados',
  description: 'Canal em U com duas dobras. O plano já sai com o desenvolvimento correto.',
  params: [
    { id: 'base', label: 'Base', type: 'number', unit: 'mm', min: 10, max: 1000, step: 1, default: 80, hint: 'Medida externa.', group: 'Geometria' },
    { id: 'aba', label: 'Altura das abas', type: 'number', unit: 'mm', min: 5, max: 500, step: 1, default: 30, group: 'Geometria' },
    { id: 'comprimento', label: 'Comprimento', type: 'number', unit: 'mm', min: 10, max: 2400, step: 1, default: 200, group: 'Geometria' },
    { id: 'espessura', label: 'Espessura', type: 'number', unit: 'mm', min: 0.5, max: 12, step: 0.1, default: 2, group: 'Dobra' },
    { id: 'raioInterno', label: 'Raio interno', type: 'number', unit: 'mm', min: 0.2, max: 50, step: 0.1, default: 2, group: 'Dobra' },
    { id: 'fatorK', label: 'Fator K', type: 'number', min: 0.25, max: 0.5, step: 0.01, default: 0.44, group: 'Dobra' },
  ],
  build: (values) => {
    const { base, aba, comprimento, espessura, raioInterno, fatorK } = values;
    const { deduction } = bendDeduction(espessura, raioInterno, 90, fatorK);

    // Duas dobras: cada uma consome uma dedução do desenvolvimento total.
    const larguraPlana = base + 2 * aba - 2 * deduction;
    if (larguraPlana <= 0) return fail('As medidas são pequenas demais para o raio de dobra.');

    const dobra1 = aba - deduction / 2;
    const dobra2 = larguraPlana - (aba - deduction / 2);
    if (dobra2 <= dobra1) return fail('As abas se encontram: aumente a base ou reduza as abas.');

    const polylines = rings([roundedRectRing(0, 0, larguraPlana, comprimento, 0)]);
    for (const x of [dobra1, dobra2]) {
      polylines.push({
        points: [
          { x, y: 0 },
          { x, y: comprimento },
        ],
        closed: false,
        linetype: 'CONTINUOUS',
        layer: 'DOBRA',
      });
    }

    const minFlange = espessura * 4 + raioInterno;
    const notes = [
      `Chapa plana: ${larguraPlana.toFixed(2)} × ${comprimento} mm ` +
        `(${deduction.toFixed(2)} mm de dedução por dobra).`,
    ];
    if (aba < minFlange) {
      notes.push(`Aba mínima recomendada: ${minFlange.toFixed(1)} mm para esta espessura.`);
    }

    return ok(polylines, notes, espessura);
  },
};

export const TEMPLATES: readonly PartTemplate[] = [
  placaRetangular,
  disco,
  flange,
  placaPoligonal,
  barraFurada,
  painelPerfurado,
  cantoneira,
  perfilU,
  cartela,
];

export function findTemplate(id: string): PartTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

export function templateCategories(): string[] {
  return [...new Set(TEMPLATES.map((template) => template.category))];
}

/** Aplica os limites declarados no parâmetro, evitando geometria inválida. */
export function clampParam(param: { min?: number; max?: number; type: string }, value: number): number {
  let next = Number.isFinite(value) ? value : 0;
  if (param.type === 'integer' || param.type === 'boolean') next = Math.round(next);
  if (param.min !== undefined) next = Math.max(param.min, next);
  if (param.max !== undefined) next = Math.min(param.max, next);
  return next;
}

export type { ParamValues };
