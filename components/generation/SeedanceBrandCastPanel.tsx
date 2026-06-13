'use client';

import Link from 'next/link';
import { Check, Package, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SeedanceRef } from './SeedanceRefsPanel';

// Activos reutilizables del workspace que se inyectan como @referencias de
// Seedance: imágenes de producto/empaque del Brand Kit y hojas maestras del
// Cast. La selección se deriva de refs (no hay estado propio): un kit o
// personaje está "activo" si sus rutas siguen en la lista de referencias.
export type BrandKitAsset = {
  storagePath: string;
  previewUrl: string;
  role: 'producto' | 'empaque';
};

export type BrandKitOption = {
  id: string;
  name: string;
  images: BrandKitAsset[];
};

export type CastOption = {
  id: string;
  name: string;
  storagePath: string;
  previewUrl: string;
};

const MAX_IMAGES = 9;
const MAX_TOTAL = 12;

export function SeedanceBrandCastPanel({
  brandKits,
  cast,
  refs,
  setRefs,
}: {
  brandKits: BrandKitOption[];
  cast: CastOption[];
  refs: SeedanceRef[];
  setRefs: (v: SeedanceRef[]) => void;
}) {
  const inRefs = new Set(refs.map((r) => r.storagePath));

  function addImages(items: Omit<SeedanceRef, 'kind'>[]) {
    const fresh = items.filter((it) => !inRefs.has(it.storagePath));
    if (!fresh.length) return;
    const imageCount = refs.filter((r) => r.kind === 'image').length;
    const slots = Math.min(MAX_IMAGES - imageCount, MAX_TOTAL - refs.length);
    if (slots <= 0) {
      toast.error(`Sin espacio: máximo ${MAX_IMAGES} imágenes de referencia`);
      return;
    }
    const accepted = fresh.slice(0, slots);
    if (accepted.length < fresh.length) {
      toast.warning(
        `Se agregaron ${accepted.length} de ${fresh.length} imágenes (tope de ${MAX_IMAGES})`,
      );
    }
    setRefs([...refs, ...accepted.map((it) => ({ ...it, kind: 'image' as const }))]);
  }

  function removePaths(paths: string[]) {
    const drop = new Set(paths);
    setRefs(refs.filter((r) => !drop.has(r.storagePath)));
  }

  function toggleKit(kit: BrandKitOption) {
    const paths = kit.images.map((i) => i.storagePath);
    const active = paths.some((p) => inRefs.has(p));
    if (active) {
      removePaths(paths);
      return;
    }
    addImages(
      kit.images.map((img) => ({
        storagePath: img.storagePath,
        previewUrl: img.previewUrl,
        filename: `${img.role} — ${kit.name}`,
        source: 'brand' as const,
        sourceLabel: `${img.role} · ${kit.name}`,
      })),
    );
  }

  function toggleCharacter(c: CastOption) {
    if (inRefs.has(c.storagePath)) {
      removePaths([c.storagePath]);
      return;
    }
    addImages([
      {
        storagePath: c.storagePath,
        previewUrl: c.previewUrl,
        filename: `hoja maestra — ${c.name}`,
        source: 'cast' as const,
        sourceLabel: `${c.name} · cast`,
      },
    ]);
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
          <Package className="size-3.5" aria-hidden />
          Brand Kit
        </div>
        {brandKits.length === 0 ? (
          <p className="px-0.5 text-[11px] text-muted-foreground/60">
            Sin Brand Kits con imágenes.{' '}
            <Link href="/app/brand/kits" className="text-primary/80 underline-offset-2 hover:underline">
              Crea uno
            </Link>{' '}
            para usar tu producto como referencia.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {brandKits.map((kit) => {
              const empty = kit.images.length === 0;
              const included = kit.images.filter((i) => inRefs.has(i.storagePath)).length;
              const active = included > 0;
              return (
                <button
                  key={kit.id}
                  type="button"
                  disabled={empty}
                  onClick={() => toggleKit(kit)}
                  title={
                    empty
                      ? 'Este Brand Kit no tiene imágenes de producto'
                      : active
                        ? 'Quitar sus imágenes de las referencias'
                        : 'Agregar producto y empaque como @referencias'
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                    empty
                      ? 'cursor-not-allowed border-border/50 text-muted-foreground/30'
                      : active
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  {active && <Check className="size-3 text-primary" aria-hidden />}
                  {kit.name}
                  <span className={cn('font-mono text-[11px]', active ? 'text-primary' : 'text-muted-foreground/50')}>
                    {active ? `${included}/${kit.images.length}` : kit.images.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
          <Users className="size-3.5" aria-hidden />
          Cast
        </div>
        {cast.length === 0 ? (
          <p className="px-0.5 text-[11px] text-muted-foreground/60">
            Sin personajes.{' '}
            <Link href="/app/brand/cast" className="text-primary/80 underline-offset-2 hover:underline">
              Crea tu Cast
            </Link>{' '}
            para mantener identidad consistente entre videos.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cast.map((c) => {
              const active = inRefs.has(c.storagePath);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCharacter(c)}
                  title={
                    active
                      ? 'Quitar su hoja maestra de las referencias'
                      : 'Agregar su hoja maestra como @referencia de identidad'
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[11.5px] transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.previewUrl}
                    alt={c.name}
                    className="size-5 rounded-full object-cover"
                  />
                  {c.name}
                  {active && <Check className="size-3 text-primary" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
