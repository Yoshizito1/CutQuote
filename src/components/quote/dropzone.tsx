'use client';

import { useCallback, useRef, useState } from 'react';

import { SUPPORTED_EXTENSIONS } from '@/lib/geometry';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** Layout compacto para quando já existem peças na lista. */
  compact?: boolean;
  disabled?: boolean;
}

export function Dropzone({ onFiles, compact = false, disabled = false }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles],
  );

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'relative rounded-xl border-2 border-dashed transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-border bg-card',
        disabled && 'pointer-events-none opacity-60',
        compact ? 'p-4' : 'p-10',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SUPPORTED_EXTENSIONS.join(',')}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = '';
        }}
      />

      <div className={cn('flex flex-col items-center text-center', compact ? 'gap-1.5' : 'gap-3')}>
        {!compact && (
          <div className="rounded-full bg-primary/10 p-3 text-primary" aria-hidden>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
            </svg>
          </div>
        )}

        <div>
          <p className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>
            Arraste seus arquivos aqui
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            DXF ou SVG · o preço aparece assim que o desenho for lido
          </p>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Selecionar arquivos
        </button>

        {!compact && (
          <p className="max-w-md text-xs text-muted-foreground">
            Linhas em layer <code className="rounded bg-muted px-1 py-0.5">DOBRA</code> viram
            operação de prensa e layers <code className="rounded bg-muted px-1 py-0.5">GRAVACAO</code>{' '}
            viram marcação superficial — nenhuma das duas é cobrada como corte.
          </p>
        )}
      </div>
    </div>
  );
}
