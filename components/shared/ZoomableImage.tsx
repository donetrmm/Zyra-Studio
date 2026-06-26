'use client';

import { useState } from 'react';
import { Lightbox } from '@/components/generation/Lightbox';
import { cn } from '@/lib/utils';

// Miniatura clickable que abre la imagen en grande (reusa Lightbox: overlay
// full-screen, ESC cierra). `className` define tamano/forma del contenedor;
// la imagen lo llena con object-cover.
export function ZoomableImage({
  src,
  alt,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ampliar imagen${alt ? `: ${alt}` : ''}`}
        title="Ampliar"
        className={cn(
          'block cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn('size-full object-cover', imgClassName)}
        />
      </button>
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
