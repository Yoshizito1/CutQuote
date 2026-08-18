/**
 * Varredura de parâmetros dos templates.
 *
 * Existe por causa de um padrão de falha, não de um bug isolado: a validação de
 * cada template é escrita à mão, condição por condição, e sempre sobra uma
 * combinação que ninguém previu. Foi assim que uma placa com raio de canto 48 e
 * recuo 12 gerou furos 15 mm fora da peça — os parâmetros passavam em todas as
 * checagens, e mesmo assim a geometria era impossível.
 *
 * Aqui não se testa caso conhecido. Testa-se o INVARIANTE, sobre milhares de
 * combinações que ninguém escolheu a dedo:
 *
 *   ou o template recusa, ou a geometria gerada é válida.
 *
 * "Válida" quer dizer: nenhum contorno se cruza, nada fica aberto, e a peça é
 * um corpo só. Qualquer combinação que escape disso aparece aqui antes de
 * chegar no cliente.
 */

import { buildTemplateGeometry } from '../src/lib/templates';
import { TEMPLATES } from '../src/lib/templates/catalog';
import { defaultValues, type ParamValues, type PartTemplate } from '../src/lib/templates/types';

export interface Harness {
  checkTrue: (name: string, condition: boolean, detail?: string) => void;
  section: (title: string) => void;
}

/** Gerador determinístico: a mesma falha reaparece na mesma execução. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function quantize(param: PartTemplate['params'][number], raw: number): number {
  let value = raw;
  if (param.type === 'integer' || param.type === 'boolean') value = Math.round(value);
  else if (param.step) value = Math.round(value / param.step) * param.step;
  if (param.min !== undefined) value = Math.max(param.min, value);
  if (param.max !== undefined) value = Math.min(param.max, value);
  return Number(value.toFixed(4));
}

/** Combinações: extremos, padrão e amostras aleatórias reprodutíveis. */
function combinations(template: PartTemplate, samples: number): ParamValues[] {
  const random = makeRandom(0x5eed + template.id.length * 7919);
  const out: ParamValues[] = [defaultValues(template)];

  // Todos no mínimo e todos no máximo: os cantos do espaço de parâmetros.
  for (const extreme of ['min', 'max'] as const) {
    const values: ParamValues = {};
    for (const param of template.params) {
      const bound = extreme === 'min' ? param.min : param.max;
      values[param.id] = quantize(param, bound ?? param.default);
    }
    out.push(values);
  }

  // Um parâmetro no extremo, o resto no padrão — isola o efeito de cada um.
  for (const target of template.params) {
    for (const extreme of ['min', 'max'] as const) {
      const values = defaultValues(template);
      const bound = extreme === 'min' ? target.min : target.max;
      values[target.id] = quantize(target, bound ?? target.default);
      out.push(values);
    }
  }

  for (let i = 0; i < samples; i += 1) {
    const values: ParamValues = {};
    for (const param of template.params) {
      const low = param.min ?? param.default * 0.5;
      const high = param.max ?? param.default * 2;
      values[param.id] = quantize(param, low + random() * (high - low));
    }
    out.push(values);
  }

  return out;
}

interface Offender {
  values: ParamValues;
  reason: string;
}

export function runTemplateSweep({ checkTrue, section }: Harness, samples = 300): void {
  section('44. Varredura de parâmetros: nenhuma combinação produz geometria impossível');

  let totalTested = 0;
  let totalRejected = 0;

  for (const template of TEMPLATES) {
    const offenders: Offender[] = [];
    const cases = combinations(template, samples);

    for (const values of cases) {
      totalTested += 1;
      let built: ReturnType<typeof buildTemplateGeometry>;

      try {
        built = buildTemplateGeometry(template, values);
      } catch (error) {
        offenders.push({
          values,
          reason: `exceção: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      // Recusar é sempre resposta aceitável — o template pode ser conservador.
      if (!built.geometry) {
        totalRejected += 1;
        continue;
      }

      const g = built.geometry;
      if (g.quality.intersections > 0) {
        offenders.push({ values, reason: `${g.quality.intersections} cruzamento(s) de contorno` });
      } else if (g.openChains.length > 0) {
        offenders.push({ values, reason: `${g.openChains.length} contorno(s) aberto(s)` });
      } else if (g.bodyCount !== 1) {
        offenders.push({ values, reason: `${g.bodyCount} corpos soltos` });
      } else if (!Number.isFinite(g.cutLength) || g.cutLength <= 0) {
        offenders.push({ values, reason: `comprimento de corte inválido (${g.cutLength})` });
      } else if (!Number.isFinite(g.netArea) || g.netArea <= 0) {
        offenders.push({ values, reason: `área inválida (${g.netArea})` });
      }
    }

    const detail =
      offenders.length > 0
        ? offenders
            .slice(0, 3)
            .map((o) => `${o.reason} em ${JSON.stringify(o.values)}`)
            .join(' || ')
        : '';

    checkTrue(
      `${template.id}: ${cases.length} combinações, nenhuma geometria impossível`,
      offenders.length === 0,
      `${offenders.length} falha(s). Primeiras: ${detail}`,
    );
  }

  console.log(
    `       ${totalTested} combinações testadas · ${totalRejected} recusadas pelo template · ` +
      `${totalTested - totalRejected} geradas e validadas`,
  );

  // --- Regressão do caso que motivou a varredura ---------------------------
  section('45. Regressão: furo fora do canto arredondado é recusado');
  {
    const impossivel = buildTemplateGeometry(TEMPLATES.find((t) => t.id === 'placa-retangular')!, {
      largura: 142,
      altura: 261,
      raio: 48,
      furos: 1,
      furoDiametro: 23.5,
      recuo: 12,
    });
    checkTrue(
      'raio 48 + recuo 12 + furo Ø23,5 é recusado',
      impossivel.geometry === null,
      JSON.stringify(impossivel.errors),
    );
    checkTrue(
      'a mensagem diz o que ajustar',
      impossivel.errors.some((e) => /recuo de pelo menos|reduza o raio/i.test(e)),
      JSON.stringify(impossivel.errors),
    );

    // O mesmo raio com recuo suficiente tem de continuar funcionando.
    const viavel = buildTemplateGeometry(TEMPLATES.find((t) => t.id === 'placa-retangular')!, {
      largura: 142,
      altura: 261,
      raio: 48,
      furos: 1,
      furoDiametro: 6,
      recuo: 40,
    });
    checkTrue(
      'recuo folgado com o mesmo raio é aceito',
      viavel.geometry !== null && viavel.geometry.holeCount === 4,
      JSON.stringify(viavel.errors),
    );

    // E o padrão do template, que é raio pequeno, não pode ter regredido.
    const padrao = buildTemplateGeometry(
      TEMPLATES.find((t) => t.id === 'placa-retangular')!,
      defaultValues(TEMPLATES.find((t) => t.id === 'placa-retangular')!),
    );
    checkTrue(
      'valores padrão seguem válidos',
      padrao.geometry !== null && padrao.geometry.holeCount === 4,
      JSON.stringify(padrao.errors),
    );
  }
}
