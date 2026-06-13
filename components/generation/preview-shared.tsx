'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function PreviewToolbar({ ready, label = 'Vista previa' }: { ready: boolean; label?: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-5">
      <div className="flex items-center gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          {label}
        </div>
        {ready && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
            <span className="size-[5px] rounded-full bg-emerald-400" />
            Lista
          </span>
        )}
      </div>
    </div>
  );
}

export function GhostBtn({
  children,
  href,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors';
  const className = cn(
    base,
    disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-muted-foreground/30',
  );
  if (href) {
    return (
      <a href={href} className={className} title={title}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function PrimaryGhost({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = cn(
    'inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors',
    disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary/15',
  );
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function RotatingTips({ tips, intervalMs = 2400 }: { tips: readonly string[]; intervalMs?: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (tips.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % tips.length), intervalMs);
    return () => clearInterval(t);
  }, [tips.length, intervalMs]);

  return (
    <div className="relative h-[22px]">
      {tips.map((t, i) => (
        <div
          key={t}
          className="absolute inset-x-0 text-sm text-foreground transition-all duration-[400ms]"
          style={{
            opacity: i === idx ? 1 : 0,
            transform: i === idx ? 'translateY(0)' : 'translateY(6px)',
          }}
        >
          {t}…
        </div>
      ))}
    </div>
  );
}

export function relativeTime(ts: number | string): string {
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = Date.now() - t;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.floor(m / 60)}h`;
}

export function aspectToRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return h > 0 ? w / h : 1;
}
