'use client';

import { cn } from '@/lib/utils';

export function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-[12.5px]">
      <span className="text-muted-foreground/80">{label}</span>
      <span
        className={cn(
          'text-foreground',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </span>
    </div>
  );
}
