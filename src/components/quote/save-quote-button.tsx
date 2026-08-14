'use client';

import { useState } from 'react';

import { useAuth } from '@/components/auth-provider';
import type { PartGeometry } from '@/lib/geometry';
import type { Catalog } from '@/lib/quote/catalog';
import { saveQuote, type PersistedItemInput } from '@/lib/quote/persistence';
import type { PartConfig, PartQuote } from '@/lib/quote/types';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

interface WorkspaceItem {
  id: string;
  filename: string;
  geometry: PartGeometry;
  config: PartConfig;
  origin: 'arquivo' | 'template';
}

interface Entry {
  id: string;
  quote: PartQuote;
}

/**
 * Salva o orçamento na conta do usuário.
 *
 * Quem não está logado vê um convite para entrar, não um botão que falha — o
 * orçamentista funciona inteiro sem conta, e salvar é o único ponto em que a
 * conta passa a ser necessária.
 */
export function SaveQuoteButton({
  items,
  entries,
  catalog,
  blocked,
}: {
  items: WorkspaceItem[];
  entries: Entry[];
  catalog: Catalog;
  blocked: boolean;
}) {
  const { user, enabled } = useAuth();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ id: string; reference: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return (
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed rounded-lg border border-border px-4 py-2.5 text-sm font-medium opacity-60"
        title="Configure o Supabase para salvar orçamentos"
      >
        Salvar (indisponível em modo local)
      </button>
    );
  }

  if (!user) {
    return (
      <a
        href="/entrar"
        className="block w-full rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Entrar para salvar este orçamento
      </a>
    );
  }

  const handleSave = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusy(true);
    setError(null);

    try {
      const payload: PersistedItemInput[] = items
        .map((item) => {
          const entry = entries.find((candidate) => candidate.id === item.id);
          if (!entry?.quote.ok) return null;
          return {
            filename: item.filename,
            origin: item.origin,
            geometry: item.geometry,
            config: item.config,
            quote: entry.quote,
          } satisfies PersistedItemInput;
        })
        .filter((item): item is PersistedItemInput => item !== null);

      if (payload.length === 0) {
        setError('Nenhuma peça orçável para salvar.');
        return;
      }

      const result = await saveQuote(supabase, {
        title: payload.length === 1 ? payload[0].filename : `${payload.length} peças`,
        catalog,
        items: payload,
      });
      setSaved(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm">
          Salvo como <strong className="font-semibold">{saved.reference}</strong>.
        </p>
        <div className="flex gap-2">
          <a
            href={`/orcamentos/${saved.id}`}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Abrir orçamento
          </a>
          <button
            type="button"
            onClick={() => setSaved(null)}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Salvar de novo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleSave}
        disabled={blocked || busy}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Salvando…' : blocked ? 'Resolva os bloqueios para salvar' : 'Salvar orçamento'}
      </button>
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
