'use client';
import { Loader2, Music } from 'lucide-react';
import { modelLabel, shortTime } from '@/lib/library/format';
import { MiniAudioPlayer } from './MiniAudioPlayer';
import type { LibraryGeneration } from '@/lib/library/types';

export function DetailMediaPreview({ generation, outputUrl, loading, ratio }: {
  generation: LibraryGeneration; outputUrl: string | null; loading: boolean; ratio: number;
}) {
  return generation.type === 'audio' ? (
    <div className="mb-3.5 overflow-hidden rounded-[14px] border border-border bg-gradient-to-b from-primary/[0.06] to-muted/40">
      {loading ? (
        <div className="grid h-[160px] place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : outputUrl ? (
        <div className="flex flex-col items-center px-4 pb-4 pt-6">
          {/* Icono con glow */}
          <div className="relative mb-4">
            <div className="absolute -inset-3 rounded-full bg-primary/20 blur-xl" />
            <div className="relative grid size-14 place-items-center rounded-full border border-primary/30 bg-primary/10">
              <Music className="size-6 text-primary" aria-hidden />
            </div>
          </div>
          {/* Meta del audio */}
          <div className="mb-1 text-center text-[12px] font-medium text-foreground/80">
            {modelLabel(generation)}
          </div>
          <div className="mb-4 font-mono text-[11px] text-muted-foreground/60">
            {generation.credits > 0 && `−${generation.credits} cr · `}
            {shortTime(generation.createdAt)}
          </div>
          {/* Onda decorativa estática */}
          <div className="mb-3 flex h-8 w-full items-end justify-center gap-[3px]">
            {Array.from({ length: 32 }, (_, i) => {
              const h = 20 + 80 * Math.abs(Math.sin((i * 0.45) + 1.2)) * Math.sin((i * 0.12) + 0.8);
              return (
                <div
                  key={i}
                  className="w-[3px] rounded-full bg-primary/40"
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          <MiniAudioPlayer src={outputUrl} />
        </div>
      ) : (
        <div className="grid h-[160px] place-items-center text-[12px] text-muted-foreground">
          Sin audio
        </div>
      )}
    </div>
  ) : generation.type === 'video' ? (
    <div className="mb-3.5 overflow-hidden rounded-lg border border-border bg-muted/40">
      {loading ? (
        <div className="grid place-items-center" style={{ aspectRatio: String(ratio) }}>
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : outputUrl ? (
        <video
          controls
          playsInline
          muted
          src={outputUrl}
          poster={generation.thumbnailUrl ?? undefined}
          className="w-full rounded-lg"
          style={{ aspectRatio: String(ratio) }}
        />
      ) : (
        <div className="grid place-items-center text-[12px] text-muted-foreground" style={{ aspectRatio: String(ratio) }}>
          Sin video
        </div>
      )}
    </div>
  ) : (
    <div
      style={{ aspectRatio: String(ratio) }}
      className="mb-3.5 overflow-hidden rounded-lg border border-border bg-muted/40"
    >
      {loading ? (
        <div className="grid h-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : outputUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={outputUrl}
          alt={generation.prompt}
          className="size-full object-contain"
        />
      ) : generation.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={generation.thumbnailUrl}
          alt={generation.prompt}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
          Sin output
        </div>
      )}
    </div>
  );
}
