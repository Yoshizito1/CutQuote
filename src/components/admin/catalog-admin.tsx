'use client';

import { useCallback, useEffect, useState } from 'react';

import { loadCatalogVersion } from '@/lib/quote/catalog-repository';
import type { Catalog } from '@/lib/quote/catalog';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { CatalogVersionRow } from '@/lib/supabase/database.types';
import { Badge, Card, CardHeader, Field, NumberInput, Stat } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Administração do catálogo.
 *
 * Fluxo desenhado para nunca editar o que está no ar: clona-se a versão
 * publicada, edita-se o rascunho e publica-se. Publicar é atômico (RPC) e
 * arquiva a anterior na mesma transação.
 *
 * Escopo desta tela: os campos que de fato movem o preço — R$/kg, perda,
 * velocidade de corte, tempo de perfuração, margem, pedido mínimo e taxas.
 * Criar material novo ou mexer em processo ainda é feito por SQL.
 */
export function CatalogAdmin({ versions }: { versions: CatalogVersionRow[] }) {
  const [list, setList] = useState(versions);
  const [selectedId, setSelectedId] = useState<string | null>(
    versions.find((version) => version.status === 'rascunho')?.id ??
      versions.find((version) => version.status === 'publicado')?.id ??
      null,
  );
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const selected = list.find((version) => version.id === selectedId) ?? null;
  const editable = selected?.status === 'rascunho';

  const loadVersion = useCallback(async (versionId: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    setDirty(false);
    try {
      const result = await loadCatalogVersion(supabase, versionId);
      // fromDatabase false significa que o repositório recusou a versão e caiu
      // no estático — carregar isso no editor faria o admin editar no vazio.
      setCatalog(result.fromDatabase ? result.catalog : null);
      if (!result.fromDatabase) {
        setMessage({ tone: 'erro', text: result.reason ?? 'Versão inválida.' });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadVersion(selectedId);
  }, [selectedId, loadVersion]);

  const refreshVersions = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data } = await supabase
      .from('catalog_versions')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setList(data);
  };

  const cloneVersion = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !selectedId) return;

    setBusy(true);
    setMessage(null);
    try {
      const label = `Revisão de ${new Date().toLocaleDateString('pt-BR')}`;
      const { data, error } = await supabase.rpc('clone_catalog_version', {
        source: selectedId,
        new_label: label,
      });
      if (error) throw new Error(error.message);
      await refreshVersions();
      setSelectedId(data as unknown as string);
      setMessage({ tone: 'ok', text: `Rascunho "${label}" criado.` });
    } catch (caught) {
      setMessage({ tone: 'erro', text: caught instanceof Error ? caught.message : 'Falha ao clonar.' });
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !selectedId) return;

    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('publish_catalog_version', { target: selectedId });
      if (error) throw new Error(error.message);
      await refreshVersions();
      setMessage({
        tone: 'ok',
        text: 'Versão publicada. Orçamentos já salvos mantêm os preços antigos.',
      });
    } catch (caught) {
      setMessage({
        tone: 'erro',
        text: caught instanceof Error ? caught.message : 'Falha ao publicar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !catalog || !selectedId) return;

    setBusy(true);
    setMessage(null);
    try {
      // Materiais e espessuras são identificados por (version_id, code) e
      // (material_id, mm) — as chaves naturais do catálogo.
      const { data: materialRows, error: readError } = await supabase
        .from('materials')
        .select('id, code')
        .eq('version_id', selectedId);
      if (readError) throw new Error(readError.message);

      const idByCode = new Map((materialRows ?? []).map((row) => [row.code, row.id]));

      for (const material of catalog.materials) {
        const materialId = idByCode.get(material.id);
        if (!materialId) continue;

        const { error } = await supabase
          .from('materials')
          .update({
            price_per_kg: material.pricePerKg,
            scrap_factor: material.scrapFactor,
            density: material.density,
          })
          .eq('id', materialId);
        if (error) throw new Error(error.message);

        for (const thickness of material.thicknesses) {
          const { error: thicknessError } = await supabase
            .from('material_thicknesses')
            .update({
              cut_speed_m_per_min: thickness.cutSpeedMPerMin,
              pierce_seconds: thickness.pierceSeconds,
              available: thickness.available,
            })
            .eq('material_id', materialId)
            .eq('mm', thickness.mm);
          if (thicknessError) throw new Error(thicknessError.message);
        }
      }

      const { error: settingsError } = await supabase
        .from('catalog_settings')
        .update({
          margin_rate: catalog.orderConfig.marginRate,
          minimum_order_value: catalog.orderConfig.minimumOrderValue,
          order_handling_fee: catalog.orderConfig.orderHandlingFee,
          cut_setup_cost: catalog.orderConfig.cutSetupCost,
        })
        .eq('version_id', selectedId);
      if (settingsError) throw new Error(settingsError.message);

      setDirty(false);
      setMessage({ tone: 'ok', text: 'Rascunho salvo. Publique para colocar no ar.' });
    } catch (caught) {
      setMessage({ tone: 'erro', text: caught instanceof Error ? caught.message : 'Falha ao salvar.' });
    } finally {
      setBusy(false);
    }
  };

  const patchMaterial = (code: string, patch: Partial<Catalog['materials'][number]>) => {
    setCatalog((current) =>
      current
        ? {
            ...current,
            materials: current.materials.map((material) =>
              material.id === code ? { ...material, ...patch } : material,
            ),
          }
        : current,
    );
    setDirty(true);
  };

  const patchThickness = (code: string, mm: number, patch: Record<string, number | boolean>) => {
    setCatalog((current) =>
      current
        ? {
            ...current,
            materials: current.materials.map((material) =>
              material.id === code
                ? {
                    ...material,
                    thicknesses: material.thicknesses.map((thickness) =>
                      thickness.mm === mm ? { ...thickness, ...patch } : thickness,
                    ),
                  }
                : material,
            ),
          }
        : current,
    );
    setDirty(true);
  };

  const patchOrder = (patch: Partial<Catalog['orderConfig']>) => {
    setCatalog((current) =>
      current ? { ...current, orderConfig: { ...current.orderConfig, ...patch } } : current,
    );
    setDirty(true);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Catálogo de preços</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Versões publicadas são imutáveis. Para mudar preço, clone a versão no ar, edite o
          rascunho e publique. Orçamentos já salvos nunca mudam de valor — cada um carrega sua
          própria cópia do catálogo.
        </p>
      </div>

      {message && (
        <p
          className={cn(
            'mb-4 rounded-lg border px-3 py-2 text-sm',
            message.tone === 'ok'
              ? 'border-success/30 bg-success/5'
              : 'border-destructive/30 bg-destructive/5',
          )}
        >
          {message.text}
        </p>
      )}

      <Card className="mb-4">
        <CardHeader
          title="Versões"
          hint={`${list.length} no total`}
          action={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cloneVersion}
                disabled={busy || !selectedId}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Clonar
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={busy || !editable || dirty}
                title={dirty ? 'Salve o rascunho antes de publicar' : undefined}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Publicar
              </button>
            </div>
          }
        />
        <ul className="divide-y divide-border">
          {list.map((version) => (
            <li key={version.id}>
              <button
                type="button"
                onClick={() => setSelectedId(version.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  version.id === selectedId ? 'bg-primary/10' : 'hover:bg-muted/60',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{version.label}</span>
                <Badge
                  tone={
                    version.status === 'publicado'
                      ? 'success'
                      : version.status === 'rascunho'
                        ? 'accent'
                        : 'neutral'
                  }
                >
                  {version.status}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(version.created_at).toLocaleDateString('pt-BR')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {loading && <p className="text-sm text-muted-foreground">Carregando versão…</p>}

      {catalog && !loading && (
        <>
          {!editable && (
            <p className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
              Esta versão está {selected?.status}. Clone-a para poder editar.
            </p>
          )}

          <Card className="mb-4">
            <CardHeader title="Parâmetros do pedido" />
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Margem (0–1)">
                <NumberInput
                  step={0.01}
                  min={0}
                  disabled={!editable}
                  value={catalog.orderConfig.marginRate}
                  onChange={(event) => patchOrder({ marginRate: Number(event.target.value) })}
                />
              </Field>
              <Field label="Pedido mínimo (R$)">
                <NumberInput
                  step={1}
                  min={0}
                  disabled={!editable}
                  value={catalog.orderConfig.minimumOrderValue}
                  onChange={(event) => patchOrder({ minimumOrderValue: Number(event.target.value) })}
                />
              </Field>
              <Field label="Taxa de pedido (R$)">
                <NumberInput
                  step={1}
                  min={0}
                  disabled={!editable}
                  value={catalog.orderConfig.orderHandlingFee}
                  onChange={(event) => patchOrder({ orderHandlingFee: Number(event.target.value) })}
                />
              </Field>
              <Field label="Setup de corte (R$)">
                <NumberInput
                  step={1}
                  min={0}
                  disabled={!editable}
                  value={catalog.orderConfig.cutSetupCost}
                  onChange={(event) => patchOrder({ cutSetupCost: Number(event.target.value) })}
                />
              </Field>
            </div>
          </Card>

          <Card className="mb-4">
            <CardHeader
              title="Materiais"
              hint="R$/kg e perda definem o custo de matéria-prima"
            />
            <ul className="divide-y divide-border">
              {catalog.materials.map((material) => (
                <li key={material.id} className="p-4">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">{material.name}</h3>
                    <span className="text-xs text-muted-foreground">
                      {material.family} · {catalog.processes[material.process]?.name}
                    </span>
                  </div>

                  <div className="mb-3 grid gap-3 sm:grid-cols-3">
                    <Field label="R$/kg">
                      <NumberInput
                        step={0.5}
                        min={0}
                        disabled={!editable}
                        value={material.pricePerKg}
                        onChange={(event) =>
                          patchMaterial(material.id, { pricePerKg: Number(event.target.value) })
                        }
                      />
                    </Field>
                    <Field label="Perda (0–1)">
                      <NumberInput
                        step={0.01}
                        min={0}
                        max={0.9}
                        disabled={!editable}
                        value={material.scrapFactor}
                        onChange={(event) =>
                          patchMaterial(material.id, { scrapFactor: Number(event.target.value) })
                        }
                      />
                    </Field>
                    <Stat
                      label="Densidade"
                      value={`${material.density} g/cm³`}
                      hint={`${material.thicknesses.length} espessura(s)`}
                    />
                  </div>

                  <details className="rounded-lg border border-border">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                      Velocidades de corte por espessura
                    </summary>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-t border-border text-xs text-muted-foreground">
                          <th className="px-3 py-1.5 text-left font-medium">Espessura</th>
                          <th className="px-3 py-1.5 text-right font-medium">m/min</th>
                          <th className="px-3 py-1.5 text-right font-medium">s/furo</th>
                          <th className="px-3 py-1.5 text-right font-medium">Ativa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {material.thicknesses.map((thickness) => (
                          <tr key={thickness.mm} className="border-t border-border/60">
                            <td className="px-3 py-1.5">{thickness.label}</td>
                            <td className="px-3 py-1.5">
                              <NumberInput
                                step={0.1}
                                min={0.01}
                                disabled={!editable}
                                value={thickness.cutSpeedMPerMin}
                                onChange={(event) =>
                                  patchThickness(material.id, thickness.mm, {
                                    cutSpeedMPerMin: Number(event.target.value),
                                  })
                                }
                                className="text-right"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <NumberInput
                                step={0.1}
                                min={0}
                                disabled={!editable}
                                value={thickness.pierceSeconds}
                                onChange={(event) =>
                                  patchThickness(material.id, thickness.mm, {
                                    pierceSeconds: Number(event.target.value),
                                  })
                                }
                                className="text-right"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <input
                                type="checkbox"
                                disabled={!editable}
                                checked={thickness.available}
                                onChange={(event) =>
                                  patchThickness(material.id, thickness.mm, {
                                    available: event.target.checked,
                                  })
                                }
                                className="size-4 accent-[var(--primary)]"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </li>
              ))}
            </ul>
          </Card>

          {editable && (
            <div className="sticky bottom-4 flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={busy || !dirty}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Salvando…' : dirty ? 'Salvar rascunho' : 'Sem alterações'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
