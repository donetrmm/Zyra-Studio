'use client';

import { Loader2, Video, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useTransition } from 'react';
import { cancelGenerationAction } from '@/server-actions/generations';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { cn } from '@/lib/utils';
import type { LiveGeneration } from './use-generation-status';

export function VideoPreview({
  generation,
  generationId,
  resolvedOutputUrl,
  resolvedThumbnailUrl,
}: {
  generation: LiveGeneration | null;
  generationId: string | null;
  resolvedOutputUrl: string | null;
  resolvedThumbnailUrl: string | null;
}) {
  const [downloading, setDownloading] = useState(false);
  const [canceling, startCancel] = useTransition();

  async function handleDownload() {
    if (!resolvedOutputUrl) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(resolvedOutputUrl, `zyra-video`);
    } catch (e) {
      toast.error(
        `No se pudo descargar${e instanceof Error ? `: ${e.message}` : ''}`,
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleCancel() {
    if (!generationId) return;
    startCancel(async () => {
      const res = await cancelGenerationAction(generationId);
      if (!res.ok) toast.error('No se pudo cancelar');
    });
  }

  if (!generation) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground/60">
        <div className="text-center">
          <Video className="mx-auto size-10" aria-hidden />
          <p className="mt-2 text-[13px]">Describe la escena y genera tu video</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'queued' || generation.status === 'processing') {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
          <p className="text-[13.5px] text-foreground">Generando video...</p>
          <p className="text-[11.5px] text-muted-foreground/80">Esto puede tomar hasta 3 minutos</p>
          <button
            type="button"
            onClick={handleCancel}
            disabled={canceling}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
          >
            <XCircle className="size-3.5" aria-hidden />
            {canceling ? 'Cancelando...' : 'Cancelar'}
          </button>
        </div>
      </div>
    );
  }

  if (generation.status === 'failed' || generation.status === 'canceled') {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-[13.5px] text-foreground">
            {generation.status === 'failed' ? 'No se pudo generar el video' : 'Generación cancelada'}
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

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      {resolvedOutputUrl ? (
        <>
          <video
            controls
            autoPlay
            muted
            playsInline
            src={resolvedOutputUrl}
            poster={resolvedThumbnailUrl ?? undefined}
            className="max-h-[70vh] max-w-full rounded-lg border border-border bg-black"
          />
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12.5px]',
              downloading ? 'opacity-60' : 'hover:bg-muted',
            )}
          >
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : 'Descargar video'}
          </button>
        </>
      ) : (
        <p className="text-muted-foreground">Video listo, cargando URL...</p>
      )}
    </div>
  );
}
