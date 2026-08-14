/** Primitivas visuais compartilhadas pelo orçamentista. */

import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-xl border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </header>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

const controlClasses =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ' +
  'transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClasses, 'appearance-none pr-8', className)} {...props} />;
}

export function NumberInput({ className, ...props }: ComponentProps<'input'>) {
  return <input type="number" className={cn(controlClasses, 'tabular', className)} {...props} />;
}

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-destructive/12 text-destructive',
    accent: 'bg-primary/15 text-primary',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Par rótulo/valor usado nas fichas técnicas da peça. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-sm font-medium">{value}</dd>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
