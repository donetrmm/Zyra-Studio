'use client';

export function BucketHeader({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2.5 pb-3 pt-5">
      <span className="text-[11px] font-medium uppercase tracking-[0.10em] text-muted-foreground">
        {name}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground/60">{count}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
