import { AssetHeaderSkeleton } from '@/components/assets/AssetGrid';

export default function ReferencesLoading() {
  return (
    <div>
      <AssetHeaderSkeleton />
      <div className="mt-5 h-[92px] w-full animate-pulse rounded-xl bg-muted/60" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-border bg-card/50">
            <div className="aspect-square w-full animate-pulse bg-muted" />
            <div className="space-y-1.5 px-2.5 py-2">
              <div className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
