'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, Download, Heart, ImagePlus, Music, Video as VideoIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { aspectRatioToNumber } from '@/lib/library/format';
import { downloadOne } from '@/lib/library/output';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import type { LibraryGeneration } from '@/lib/library/types';
import { TileBtn } from './TileBtn';

export function LibTile({
  gen,
  onClick,
  variantTag,
  compact,
  selected,
  onToggleSelect,
  isFavorite,
  onToggleFav,
}: {
  gen: LibraryGeneration;
  onClick: () => void;
  variantTag?: string;
  compact?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  isFavorite?: boolean;
  onToggleFav?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [addingRef, startAddRef] = useTransition();

  // En modo compact (dentro de SessionCard) usamos aspect cuadrado para evitar
  // que las cards se vuelvan enormes con aspect ratios como 16:9.
  const ratio = aspectRatioToNumber(compact ? '1:1' : gen.aspectRatio);

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (!gen.hasOutput || downloading) return;
    setDownloading(true);
    try {
      await downloadOne(gen.id, `1to1-${gen.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }

  // Solo imágenes: copia el output al bucket de referencias para reusarlo
  // como referencia en futuras generaciones.
  function handleUseAsRef(e: React.MouseEvent) {
    e.stopPropagation();
    if (addingRef) return;
    startAddRef(async () => {
      const res = await addGenerationAsReferenceAction({ generationId: gen.id });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo usar como referencia');
        return;
      }
      toast.success('Agregada a tus referencias');
    });
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{ aspectRatio: String(ratio) }}
      className="zyra-fade-in group relative cursor-pointer overflow-hidden rounded-lg border border-transparent bg-muted/40 shadow-[0_4px_14px_-8px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-px hover:border-muted-foreground/20"
    >
      {gen.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={gen.thumbnailUrl}
          alt={gen.prompt}
          className="size-full object-cover"
        />
      ) : gen.type === 'audio' ? (
        <div className="grid h-full place-items-center bg-gradient-to-b from-primary/[0.07] via-primary/[0.03] to-transparent">
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-9 place-items-center rounded-full border border-primary/25 bg-primary/10">
              <Music className="size-4 text-primary/70" aria-hidden />
            </div>
            {/* Mini waveform decorativa */}
            <div className="flex h-3 items-end gap-[2px]">
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className="w-[2px] rounded-full bg-primary/30"
                  style={{ height: `${25 + 75 * Math.abs(Math.sin(i * 0.7 + 0.5))}%` }}
                />
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground/50">
              {gen.status === 'done' ? 'Audio' : gen.status}
            </span>
          </div>
        </div>
      ) : gen.type === 'video' ? (
        <div className="grid h-full place-items-center bg-gradient-to-b from-primary/[0.07] via-primary/[0.03] to-transparent">
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-9 place-items-center rounded-full border border-primary/25 bg-primary/10">
              <VideoIcon className="size-4 text-primary/70" aria-hidden />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground/50">
              {gen.status === 'done' ? 'Video' : gen.status}
            </span>
          </div>
        </div>
      ) : (
        <div className="grid h-full place-items-center text-[11px] text-muted-foreground/70">
          {gen.status}
        </div>
      )}

      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity',
          hover ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          background:
            'linear-gradient(180deg, transparent 50%, color-mix(in oklch, var(--background) 80%, transparent) 100%)',
        }}
      />

      {variantTag && (
        <div
          className={cn(
            'absolute bottom-2 left-2 rounded-full border border-border/40 bg-background/70 px-2 py-0.5 font-mono text-[11px] text-foreground/85 backdrop-blur transition-opacity',
            hover ? 'opacity-100' : 'opacity-60',
          )}
        >
          {variantTag}
        </div>
      )}

      {(hover || isFavorite) && onToggleFav && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-background/70 backdrop-blur transition-colors hover:bg-background/90"
          title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        >
          <Heart className={cn('size-3', isFavorite ? 'fill-rose-400 text-rose-400' : 'text-foreground')} aria-hidden />
        </button>
      )}

      {hover && gen.hasOutput && (
        <div className="absolute right-2 bottom-2 flex gap-1">
          {gen.type === 'image' && (
            <TileBtn onClick={handleUseAsRef} title="Usar como referencia" busy={addingRef}>
              <ImagePlus className="size-3" aria-hidden />
            </TileBtn>
          )}
          <TileBtn onClick={handleDownload} title="Descargar" busy={downloading}>
            <Download className="size-3" aria-hidden />
          </TileBtn>
        </div>
      )}
      {onToggleSelect && (hover || selected) && gen.status === 'done' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={cn(
            'absolute left-2 top-2 grid size-5 place-items-center rounded border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-foreground/60 bg-background/60 backdrop-blur',
          )}
        >
          {selected && <Check className="size-3" aria-hidden />}
        </button>
      )}
    </div>
  );
}
