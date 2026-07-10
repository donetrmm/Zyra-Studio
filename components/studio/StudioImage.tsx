'use client';

import { useState } from 'react';
import { Lightbox } from '@/components/generation/Lightbox';
import { cn } from '@/lib/utils';

// Imagen del estudio: muestra el thumbnail público (rápido) inline y, al
// ampliar, carga el ORIGINAL a resolución completa (signed URL de
// /api/generations/[id]). Antes el zoom mostraba el thumbnail de 512px y salía
// borroso; ahora el thumbnail solo sirve de placeholder hasta que llega el
// original. El caller controla el layout (className del botón, imgClassName de
// la <img>) para no reescalar el thumbnail más allá de su tamaño nativo.
export function StudioImage({
  thumbSrc,
  generationId,
  alt,
  className,
  imgClassName,
}: {
  thumbSrc: string;
  generationId: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fullSrc, setFullSrc] = useState<string | null>(null);

  async function openZoom() {
    setOpen(true);
    if (fullSrc) return;
    try {
      const res = await fetch(`/api/generations/${generationId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { outputUrl: string | null };
      if (data.outputUrl) setFullSrc(data.outputUrl);
    } catch {
      // Sin original: el Lightbox se queda con el thumbnail como fallback.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openZoom}
        aria-label={`Ampliar imagen${alt ? `: ${alt}` : ''}`}
        title="Ampliar"
        className={cn(
          'block cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbSrc} alt={alt} loading="lazy" decoding="async" className={imgClassName} />
      </button>
      {open && <Lightbox src={fullSrc ?? thumbSrc} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
