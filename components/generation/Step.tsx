'use client';

import { cn } from '@/lib/utils';

export function Step({
  index,
  title,
  subtitle,
  hint,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2.5 flex items-baseline gap-2">
        <span
          className={cn(
            'relative top-0.5 inline-grid size-[18px] shrink-0 place-items-center rounded-full',
            'border border-primary/40 bg-primary/10 text-[10.5px] font-medium tabular-nums text-primary',
          )}
        >
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-heading text-[13px] font-medium">{title}</span>
            {hint}
          </div>
          {subtitle && (
            <div className="mt-px text-[11.5px] text-muted-foreground/80">
              {subtitle}
            </div>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

export function SectionHeading({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        {children}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}
