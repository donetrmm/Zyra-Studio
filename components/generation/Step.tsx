'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Step({
  index,
  title,
  hint,
  done,
  badge,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  done?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <header className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
            done
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border text-muted-foreground',
          )}
          aria-hidden
        >
          {done ? <Check className="size-3" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-sm font-medium">{title}</h3>
            {badge}
          </div>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
