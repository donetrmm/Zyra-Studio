import { cn } from '@/lib/utils';

// Grilla unificada de tarjetas de activo. Mismo ritmo en todas las vistas
// (Cast, Locaciones, Productos, Kits): 1 col en móvil, 2 en sm, 3 en lg.
export function AssetGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>{children}</div>;
}

// Encabezado en carga: título + descripción + acción, en pulso.
export function AssetHeaderSkeleton() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-3 w-72 max-w-[60vw] animate-pulse rounded bg-muted/70" />
      </div>
      <div className="h-9 w-32 shrink-0 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

// Skeleton de una tarjeta image-hero, para los loading.tsx de Cast/Locaciones.
export function AssetCardSkeleton({ aspect = 'portrait' }: { aspect?: 'portrait' | 'landscape' | 'square' }) {
  const aspectClass =
    aspect === 'landscape' ? 'aspect-[16/9]' : aspect === 'square' ? 'aspect-square' : 'aspect-[4/5]';
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className={cn('w-full animate-pulse bg-muted', aspectClass)} />
      <div className="space-y-2 p-3.5">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="flex gap-1.5 border-t border-border/40 p-2.5">
        <div className="h-8 flex-1 animate-pulse rounded-lg bg-muted" />
        <div className="h-8 flex-1 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}

// Skeleton de tarjeta sin imagen (Kits/Voces): título + fila de detalles + pie.
export function AssetTextCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className="space-y-3 p-4">
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, j) => (
            <div key={j} className="size-5 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="flex gap-1.5 border-t border-border/40 p-2.5">
        <div className="h-8 flex-1 animate-pulse rounded-lg bg-muted" />
        <div className="h-8 flex-1 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}

// Grilla de skeletons image-hero lista para un loading.tsx (header + N tarjetas).
export function AssetGridSkeleton({
  count = 6,
  aspect = 'portrait',
}: {
  count?: number;
  aspect?: 'portrait' | 'landscape' | 'square';
}) {
  return (
    <div>
      <AssetHeaderSkeleton />
      <AssetGrid className="mt-6">
        {Array.from({ length: count }).map((_, i) => (
          <AssetCardSkeleton key={i} aspect={aspect} />
        ))}
      </AssetGrid>
    </div>
  );
}

// Grilla de skeletons de tarjetas sin imagen (Kits/Voces).
export function AssetTextGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div>
      <AssetHeaderSkeleton />
      <AssetGrid className="mt-6">
        {Array.from({ length: count }).map((_, i) => (
          <AssetTextCardSkeleton key={i} />
        ))}
      </AssetGrid>
    </div>
  );
}
