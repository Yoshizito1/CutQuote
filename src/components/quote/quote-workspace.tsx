'use client';

import { useCallback, useMemo, useState } from 'react';

import { loadDrawing } from '@/lib/geometry';
import { formatCurrency, formatNumber, quotePart } from '@/lib/quote/pricing';
import type { Catalog } from '@/lib/quote/catalog';
import type { PartConfig } from '@/lib/quote/types';
import type { PartGeometry } from '@/lib/geometry';

import { ConfigPanel } from './config-panel';
import { DfmPanel } from './dfm-panel';
import { Dropzone } from './dropzone';
import { PartPreview } from './part-preview';
import { PartList, type PartListEntry } from './part-list';
import { PriceBreakdown } from './price-breakdown';
import { QuantityLadder } from './quantity-ladder';
import { SaveQuoteButton } from './save-quote-button';
import { TemplateConfigurator } from './template-configurator';
import { TemplateGallery } from './template-gallery';
import { Badge, Card, CardHeader, Stat } from '@/components/ui/primitives';
import { useCatalog } from '@/components/catalog-provider';
import { findMaterial } from '@/lib/quote/catalog';
import type { PartTemplate } from '@/lib/templates';
import { cn } from '@/lib/utils';

interface QuoteItem {
  id: string;
  filename: string;
  geometry: PartGeometry;
  config: PartConfig;
  /** Marca as peças criadas por template, para diferenciar na lista. */
  origin: 'arquivo' | 'template';
}

type SourceMode = 'arquivo' | 'template';

interface LoadError {
  id: string;
  filename: string;
  message: string;
}

/**
 * Configuração inicial de uma peça nova.
 *
 * Depende do catálogo ativo: o primeiro material e a espessura disponível mais
 * próxima de 1,5 mm. Uma constante fixa quebraria assim que o admin renomeasse
 * ou removesse um material no banco.
 */
function defaultConfig(catalog: Catalog): PartConfig {
  const material = catalog.materials[0];
  const available = material?.thicknesses.filter((thickness) => thickness.available) ?? [];
  const thickness =
    available.length > 0
      ? available.reduce((best, candidate) =>
          Math.abs(candidate.mm - 1.5) < Math.abs(best.mm - 1.5) ? candidate : best,
        )
      : undefined;

  return {
    materialId: material?.id ?? '',
    thicknessMm: thickness?.mm ?? 1.5,
    finishId: material?.finishes[0] ?? 'nenhum',
    quantity: 10,
    tappedHoles: 0,
    hardwareInserts: 0,
  };
}

type DetailTab = 'preco' | 'faixas' | 'analise';

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function QuoteWorkspace() {
  const { catalog } = useCatalog();
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [errors, setErrors] = useState<LoadError[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('preco');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SourceMode>('arquivo');
  const [activeTemplate, setActiveTemplate] = useState<PartTemplate | null>(null);

  const money = (value: number): string => formatCurrency(value, catalog);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setBusy(true);
      const loaded: QuoteItem[] = [];
      const failed: LoadError[] = [];

      for (const file of files) {
        const id = newId(file.name);
        try {
          const content = await file.text();
          const geometry = loadDrawing(file.name, content);
          loaded.push({
            id,
            filename: file.name,
            geometry,
            config: defaultConfig(catalog),
            origin: 'arquivo',
          });
        } catch (error) {
          failed.push({
            id,
            filename: file.name,
            message: error instanceof Error ? error.message : 'Falha ao ler o arquivo.',
          });
        }
      }

      setItems((current) => [...current, ...loaded]);
      setErrors((current) => [...current, ...failed]);
      if (loaded.length > 0) setSelectedId((current) => current ?? loaded[0].id);
      setBusy(false);
    },
    [catalog],
  );

  /**
   * Adiciona uma peça vinda de template.
   *
   * Quando o template calculou desenvolvimento de dobra, ele depende de uma
   * espessura específica — aqui essa espessura é ancorada na opção real mais
   * próxima do material escolhido, para o plano não deixar de bater com a peça
   * dobrada.
   */
  const addFromTemplate = useCallback(
    (payload: { geometry: PartGeometry; filename: string; suggestedThicknessMm?: number }) => {
      const config: PartConfig = defaultConfig(catalog);

      if (payload.suggestedThicknessMm !== undefined) {
        const material = findMaterial(config.materialId, catalog);
        const closest = material?.thicknesses
          .filter((thickness) => thickness.available)
          .reduce((best, candidate) =>
            Math.abs(candidate.mm - payload.suggestedThicknessMm!) <
            Math.abs(best.mm - payload.suggestedThicknessMm!)
              ? candidate
              : best,
          );
        if (closest) config.thicknessMm = closest.mm;
      }

      const id = newId('tpl');
      setItems((current) => [
        ...current,
        { id, filename: payload.filename, geometry: payload.geometry, config, origin: 'template' },
      ]);
      setSelectedId(id);
      setActiveTemplate(null);
      setMode('arquivo');
    },
    [catalog],
  );

  const updateConfig = useCallback((id: string, config: PartConfig) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, config } : item)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      setSelectedId((selected) => (selected === id ? (next[0]?.id ?? null) : selected));
      return next;
    });
  }, []);

  // Recalcula tudo a cada mudança: o motor é síncrono e barato o suficiente
  // para rodar no render, o que mantém o preço sempre coerente com a tela.
  const entries: PartListEntry[] = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        filename: item.filename,
        origin: item.origin,
        quote: quotePart(item.geometry, item.config, catalog),
      })),
    [items, catalog],
  );

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;

  const summary = useMemo(() => {
    const priced = entries.filter((entry) => entry.quote.ok);
    return {
      total: priced.reduce((sum, entry) => sum + entry.quote.totalPrice, 0),
      pieces: priced.reduce((sum, entry) => sum + entry.quote.config.quantity, 0),
      mass: priced.reduce(
        (sum, entry) => sum + entry.quote.unitMassKg * entry.quote.config.quantity,
        0,
      ),
      leadDays: priced.reduce((max, entry) => Math.max(max, entry.quote.leadDays), 0),
      blocked: entries.length - priced.length,
    };
  }, [entries]);

  const modeSwitch = (
    <ModeSwitch
      mode={mode}
      itemCount={items.length}
      onChange={(next) => {
        setMode(next);
        if (next === 'arquivo') setActiveTemplate(null);
      }}
    />
  );

  if (mode === 'template') {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6">
        <div className="mb-5">{modeSwitch}</div>

        {activeTemplate ? (
          <TemplateConfigurator
            template={activeTemplate}
            baseConfig={selected?.config ?? defaultConfig(catalog)}
            onBack={() => setActiveTemplate(null)}
            onAdd={addFromTemplate}
          />
        ) : (
          <>
            <div className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight">Templates paramétricos</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Escolha uma peça, ajuste as medidas e veja o preço mudar em tempo real. A geometria
                gerada passa exatamente pelo mesmo motor de um arquivo importado — e pode ser
                baixada em DXF.
              </p>
            </div>
            <TemplateGallery onPick={setActiveTemplate} />
          </>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        busy={busy}
        errors={errors}
        onFiles={handleFiles}
        onDismiss={setErrors}
        modeSwitch={modeSwitch}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <div className="mb-4">{modeSwitch}</div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_380px]">
        {/* Coluna 1 — peças do pedido */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader
              title="Peças do pedido"
              hint={`${items.length} arquivo(s)`}
              action={
                summary.blocked > 0 ? (
                  <Badge tone="danger">{summary.blocked} com bloqueio</Badge>
                ) : null
              }
            />
            <PartList
              entries={entries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemove={removeItem}
            />
          </Card>

          <Dropzone compact onFiles={handleFiles} disabled={busy} />

          <ErrorList errors={errors} onDismiss={setErrors} />

          <Card>
            <CardHeader title="Resumo do pedido" />
            <div className="space-y-3 p-4">
              <dl className="grid grid-cols-2 gap-3">
                <Stat label="Peças" value={summary.pieces} />
                <Stat label="Massa total" value={`${formatNumber(summary.mass, 2, catalog)} kg`} />
                <Stat
                  label="Prazo"
                  value={summary.leadDays > 0 ? `${summary.leadDays} dias úteis` : '—'}
                />
                <Stat label="Itens" value={entries.length} />
              </dl>

              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="tabular text-xl font-semibold">{money(summary.total)}</span>
              </div>

              <SaveQuoteButton
                items={items}
                entries={entries}
                catalog={catalog}
                blocked={summary.blocked > 0 || summary.total === 0}
              />

              <p className="text-center text-xs text-muted-foreground">
                Pedido mínimo de {money(catalog.orderConfig.minimumOrderValue)}. Impostos e frete
                não inclusos.
              </p>
            </div>
          </Card>
        </div>

        {/* Coluna 2 — desenho */}
        <div className="space-y-4">
          {selected && selectedEntry && (
            <>
              <Card className="overflow-hidden">
                <CardHeader
                  title={selected.filename}
                  hint={`${selected.geometry.source.format.toUpperCase()} · unidade de origem: ${selected.geometry.source.sourceUnit}`}
                  action={
                    selectedEntry.quote.ok ? (
                      <Badge tone="success">Fabricável</Badge>
                    ) : (
                      <Badge tone="danger">Bloqueado</Badge>
                    )
                  }
                />
                <PartPreview
                  geometry={selected.geometry}
                  thickness={selected.config.thicknessMm}
                  defaultRadius={
                    // Raio interno padrão da espessura escolhida. Cai na própria
                    // espessura quando o catálogo não define — é a regra de bolso
                    // da prensa (raio ≈ espessura).
                    findMaterial(selected.config.materialId, catalog)
                      ?.thicknesses.find(
                        (option) => Math.abs(option.mm - selected.config.thicknessMm) < 1e-6,
                      )?.bendRadius ?? selected.config.thicknessMm
                  }
                />
              </Card>

              <Card>
                <CardHeader
                  title="Ficha do desenho"
                  hint="Números extraídos do arquivo, que alimentam o preço"
                />
                <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
                  <Stat
                    label="Dimensões"
                    value={`${formatNumber(selected.geometry.bbox.width)} × ${formatNumber(selected.geometry.bbox.height)} mm`}
                  />
                  <Stat
                    label="Área da peça"
                    value={`${formatNumber(selected.geometry.netArea / 100, 2)} cm²`}
                    hint={
                      // O fecho convexo mostra quanto da sobra vem do FORMATO da
                      // peça, e não dos furos — é o que o cliente consegue mudar.
                      selected.geometry.quality.hullArea > 0
                        ? `${(selectedEntry.quote.materialUtilization * 100).toFixed(0)}% da chapa · ` +
                          `${((selected.geometry.netArea / selected.geometry.quality.hullArea) * 100).toFixed(0)}% do contorno`
                        : `${(selectedEntry.quote.materialUtilization * 100).toFixed(0)}% de aproveitamento`
                    }
                  />
                  <Stat
                    label="Corte"
                    value={`${formatNumber(selected.geometry.cutLength / 1000, 3)} m`}
                  />
                  <Stat label="Perfurações" value={selected.geometry.pierces} />
                  <Stat label="Recortes internos" value={selected.geometry.holeCount} />
                  <Stat label="Dobras" value={selected.geometry.bendLines.length} />
                  <Stat
                    label="Gravação"
                    value={
                      selected.geometry.etchLength > 0
                        ? `${formatNumber(selected.geometry.etchLength / 1000, 3)} m`
                        : '—'
                    }
                  />
                  <Stat
                    label="Massa unitária"
                    value={`${formatNumber(selectedEntry.quote.unitMassKg, 3)} kg`}
                  />
                </dl>
              </Card>
            </>
          )}
        </div>

        {/* Coluna 3 — configuração e preço */}
        <div className="space-y-4">
          {selected && selectedEntry && (
            <>
              <Card>
                <CardHeader title="Configuração" hint="O preço recalcula a cada mudança" />
                <ConfigPanel
                  config={selected.config}
                  holeCount={selected.geometry.holeCount}
                  onChange={(config) => updateConfig(selected.id, config)}
                />
              </Card>

              <Card className="overflow-hidden">
                <div className="flex border-b border-border">
                  {(
                    [
                      ['preco', 'Preço'],
                      ['faixas', 'Faixas'],
                      ['analise', `Análise${selectedEntry.quote.issues.length > 0 ? ` (${selectedEntry.quote.issues.length})` : ''}`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTab(key)}
                      className={cn(
                        'flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                        tab === key
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === 'preco' &&
                  (selectedEntry.quote.ok ? (
                    <PriceBreakdown quote={selectedEntry.quote} />
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      O preço só é calculado depois que os bloqueios da aba{' '}
                      <strong className="font-medium text-foreground">Análise</strong> forem
                      resolvidos.
                    </p>
                  ))}

                {tab === 'faixas' &&
                  (selectedEntry.quote.ok ? (
                    <QuantityLadder
                      geometry={selected.geometry}
                      config={selected.config}
                      onSelect={(quantity) =>
                        updateConfig(selected.id, { ...selected.config, quantity })
                      }
                    />
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">
                      Indisponível enquanto houver bloqueio.
                    </p>
                  ))}

                {tab === 'analise' && <DfmPanel issues={selectedEntry.quote.issues} />}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Alterna entre importar arquivo e partir de um template pronto. */
function ModeSwitch({
  mode,
  itemCount,
  onChange,
}: {
  mode: SourceMode;
  itemCount: number;
  onChange: (mode: SourceMode) => void;
}) {
  const options: readonly { id: SourceMode; label: string; hint: string }[] = [
    { id: 'arquivo', label: 'Meu arquivo', hint: 'DXF ou SVG' },
    { id: 'template', label: 'Template pronto', hint: 'Sem CAD' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-border bg-card p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              mode === option.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
            <span
              className={cn(
                'ml-1.5 text-xs font-normal',
                mode === option.id ? 'opacity-75' : 'opacity-60',
              )}
            >
              {option.hint}
            </span>
          </button>
        ))}
      </div>

      {mode === 'template' && itemCount > 0 && (
        <button
          type="button"
          onClick={() => onChange('arquivo')}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Voltar ao orçamento ({itemCount} peça{itemCount > 1 ? 's' : ''})
        </button>
      )}
    </div>
  );
}

function EmptyState({
  busy,
  errors,
  onFiles,
  onDismiss,
  modeSwitch,
}: {
  busy: boolean;
  errors: LoadError[];
  onFiles: (files: File[]) => void;
  onDismiss: (errors: LoadError[]) => void;
  modeSwitch: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Envie o desenho, receba o preço
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-muted-foreground">
          O arquivo é lido no seu navegador: a geometria é medida, as restrições de fabricação são
          verificadas e o custo sai aberto, linha por linha. Nada é enviado para servidor.
        </p>
        <div className="mt-6 flex justify-center">{modeSwitch}</div>
      </div>

      <Dropzone onFiles={onFiles} disabled={busy} />
      <ErrorList errors={errors} onDismiss={onDismiss} className="mt-4" />

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          {
            title: 'Geometria medida de verdade',
            body: 'Arcos, splines e blocos são interpretados como o CAD desenhou — não aproximados pelo polígono de controle.',
          },
          {
            title: 'Custo por tempo de máquina',
            body: 'Comprimento dividido pela velocidade de corte, multiplicado pelo custo-hora. Sem tabela de preço arbitrária.',
          },
          {
            title: 'Restrição antes do orçamento',
            body: 'Furo pequeno demais, contorno aberto ou peça maior que a chapa aparecem antes de você fechar o pedido.',
          },
        ].map((feature) => (
          <div key={feature.title} className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">{feature.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorList({
  errors,
  onDismiss,
  className,
}: {
  errors: LoadError[];
  onDismiss: (errors: LoadError[]) => void;
  className?: string;
}) {
  if (errors.length === 0) return null;

  return (
    <ul className={cn('space-y-2', className)}>
      {errors.map((error) => (
        <li
          key={error.id}
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{error.filename}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{error.message}</p>
          </div>
          <button
            type="button"
            aria-label="Dispensar aviso"
            onClick={() => onDismiss(errors.filter((item) => item.id !== error.id))}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
