'use client';

import { Loader2, Music4 } from 'lucide-react';
import type { LiveGeneration } from './use-generation-status';
import { WavePlayer } from './WavePlayer';

export function AudioPreview({
  generation,
  resolvedOutputUrl,
}: {
  generation: LiveGeneration | null;
  resolvedOutputUrl: string | null;
}) {
  if (!generation) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground/60">
        <div className="text-center">
          <Music4 className="mx-auto size-10" aria-hidden />
          <p className="mt-2 text-[13px]">Escribe un texto y genera tu primer audio</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'queued' || generation.status === 'processing') {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
          <p className="text-[13px]">Generando voz…</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'failed' || generation.status === 'canceled') {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-[13.5px] text-foreground">
            {generation.status === 'failed' ? 'No se pudo generar el audio' : 'Generación cancelada'}
          </p>
          {generation.errorMessage && (
            <p className="mt-1 font-mono text-[11.5px] text-muted-foreground/80">
              {generation.errorMessage}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!resolvedOutputUrl) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <p className="text-[13px]">Audio listo, cargando URL…</p>
      </div>
    );
  }

  return <WavePlayer src={resolvedOutputUrl} />;
}
