'use client';

import { Info, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type GenerateBarProps = {
  modelLabel: string;
  cost: number;
  balance: number;
  etaSeconds?: number;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
  hint?: string | null;
  idleLabel?: string;
  pendingLabel?: string;
};

export function GenerateBar({
  modelLabel,
  cost,
  balance,
  etaSeconds,
  disabled,
  pending,
  onClick,
  hint,
  idleLabel = 'Generar',
  pendingLabel = 'Generando…',
}: GenerateBarProps) {
  const insufficient = cost > balance;
  return (
    <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3.5 backdrop-blur">
      {hint && (
        <div className="mb-2.5 flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
          <Info className="mt-px size-3 shrink-0 text-primary/80" aria-hidden />
          <span>{hint}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'relative flex w-full items-center justify-center gap-2 rounded-xl px-3.5 py-3 text-[14px] font-semibold transition-colors',
          disabled
            ? 'cursor-not-allowed bg-muted/40 text-muted-foreground/60'
            : 'bg-primary text-primary-foreground shadow-[0_8px_28px_-10px_color-mix(in_oklch,var(--color-primary)_55%,transparent)] hover:bg-primary/90',
        )}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="size-3.5" aria-hidden />
        )}
        {pending ? pendingLabel : idleLabel}
        <span className="ml-1 inline-flex items-center gap-1 border-l border-primary-foreground/25 pl-2.5 font-mono text-[12px] opacity-90">
          −{cost} cr
        </span>
      </button>
      <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground/80">
        <span className="truncate">{modelLabel}</span>
        {etaSeconds !== undefined && <span className="shrink-0">~{etaSeconds}s</span>}
      </div>
      {insufficient && !disabled && (
        <div className="mt-1.5 text-center text-[11px] text-amber-400">
          Te faltan {(cost - balance).toLocaleString('es-MX')} créditos.
        </div>
      )}
    </div>
  );
}
