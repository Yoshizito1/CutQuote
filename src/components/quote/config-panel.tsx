'use client';

import { useCatalog } from '@/components/catalog-provider';
import { findMaterial, materialFamilies } from '@/lib/quote/catalog';
import type { PartConfig } from '@/lib/quote/types';
import { Field, NumberInput, Select } from '@/components/ui/primitives';

interface ConfigPanelProps {
  config: PartConfig;
  onChange: (next: PartConfig) => void;
  /** Furos disponíveis no desenho — limita rosca e insertos. */
  holeCount: number;
}

export function ConfigPanel({ config, onChange, holeCount }: ConfigPanelProps) {
  const { catalog } = useCatalog();
  const material = findMaterial(config.materialId, catalog) ?? catalog.materials[0];
  const process = catalog.processes[material.process];
  const thicknesses = material.thicknesses.filter((thickness) => thickness.available);

  const patch = (partial: Partial<PartConfig>): void => onChange({ ...config, ...partial });

  /** Ao trocar de material, mantém a espessura mais próxima da atual. */
  const changeMaterial = (materialId: string): void => {
    const next = findMaterial(materialId, catalog);
    if (!next) return;

    const closest = next.thicknesses
      .filter((thickness) => thickness.available)
      .reduce((best, candidate) =>
        Math.abs(candidate.mm - config.thicknessMm) < Math.abs(best.mm - config.thicknessMm)
          ? candidate
          : best,
      );

    patch({
      materialId,
      thicknessMm: closest.mm,
      // O acabamento anterior pode não existir no material novo.
      finishId: next.finishes.includes(config.finishId) ? config.finishId : next.finishes[0],
    });
  };

  return (
    <div className="space-y-4 p-4">
      <Field label="Material">
        <Select value={config.materialId} onChange={(event) => changeMaterial(event.target.value)}>
          {materialFamilies(catalog).map((family) => (
            <optgroup key={family} label={family}>
              {catalog.materials.filter((item) => item.family === family).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{process.name}</span> — {process.description}
        {material.notes && <> {material.notes}</>}
      </p>

      <Field
        label="Espessura"
        hint={`Chapa útil de ${process.sheet.width} x ${process.sheet.height} mm`}
      >
        <Select
          value={config.thicknessMm}
          onChange={(event) => patch({ thicknessMm: Number(event.target.value) })}
        >
          {thicknesses.map((thickness) => (
            <option key={thickness.mm} value={thickness.mm}>
              {thickness.label}
              {!thickness.bendable ? ' · não dobrável' : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Acabamento">
        <Select value={config.finishId} onChange={(event) => patch({ finishId: event.target.value })}>
          {material.finishes.map((finishId) => (
            <option key={finishId} value={finishId}>
              {catalog.finishes[finishId]?.name ?? finishId}
            </option>
          ))}
        </Select>
        <span className="mt-1 block text-xs text-muted-foreground">
          {catalog.finishes[config.finishId]?.description}
        </span>
      </Field>

      <Field label="Quantidade">
        <NumberInput
          min={1}
          step={1}
          value={config.quantity}
          onChange={(event) => patch({ quantity: Math.max(1, Number(event.target.value) || 1) })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Roscas"
          hint={material.tappable ? `${holeCount} furo(s) no desenho` : 'Material não rosqueável'}
        >
          <NumberInput
            min={0}
            step={1}
            disabled={!material.tappable}
            value={config.tappedHoles}
            onChange={(event) => patch({ tappedHoles: Math.max(0, Number(event.target.value) || 0) })}
          />
        </Field>

        <Field label="Insertos" hint="Tipo PEM, prensados">
          <NumberInput
            min={0}
            step={1}
            value={config.hardwareInserts}
            onChange={(event) =>
              patch({ hardwareInserts: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </Field>
      </div>
    </div>
  );
}
