'use client';
import { Download, Heart, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SavePresetButton } from './SavePresetButton';
import type { LibraryGeneration } from '@/lib/library/types';

export function DetailActions({
  generation, outputUrl, isFavorite, onToggleFav, onDownload, downloading, onUseAsRef, addingRef, onDelete,
}: {
  generation: LibraryGeneration; outputUrl: string | null; isFavorite: boolean;
  onToggleFav: (id: string) => void; onDownload: () => void; downloading: boolean;
  onUseAsRef: () => void; addingRef: boolean; onDelete: () => void;
}) {
  return (
    <div className="mb-3.5 grid gap-1.5 grid-cols-1">
      <button
        type="button"
        onClick={() => onToggleFav(generation.id)}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
          isFavorite
            ? 'border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/15'
            : 'border-border bg-muted/30 text-foreground hover:border-muted-foreground/30',
        )}
      >
        <Heart className={cn('size-3.5', isFavorite && 'fill-rose-400')} aria-hidden />
        {isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
      </button>
      <button
        type="button"
        onClick={onDownload}
        disabled={!outputUrl || downloading}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {downloading ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="size-3.5" aria-hidden />
        )}{' '}
        Descargar
      </button>
      {generation.type === 'image' && generation.status === 'done' && (
        <button
          type="button"
          onClick={onUseAsRef}
          disabled={addingRef}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {addingRef ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <ImagePlus className="size-3.5" aria-hidden />
          )}{' '}
          Usar como referencia
        </button>
      )}
      {generation.status === 'done' && generation.prompt && (
        <SavePresetButton generation={generation} />
      )}
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        <Trash2 className="size-3.5" aria-hidden /> Eliminar
      </button>
    </div>
  );
}
