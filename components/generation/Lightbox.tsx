'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal a document.body: el Lightbox es `position: fixed` y debe cubrir el
  // viewport. Si se renderiza dentro de un ancestro con `transform`/`filter`
  // (p. ej. `.zyra-fade-up` deja un `transform: translateY(0)` por su fill-mode
  // `both`), ese ancestro se vuelve el bloque contenedor del `fixed` y el overlay
  // queda anclado a una caja chica → la imagen a resolución completa desborda y
  // se recorta. Sacarlo al body lo desacopla de cualquier ancestro.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagen ampliada"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-background/90 p-4 backdrop-blur-sm sm:p-8"
      style={{ animation: 'zyra-fade-in 120ms ease-out' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      />
      <button
        type="button"
        onClick={onClose}
        title="Cerrar (ESC)"
        className="absolute right-4 top-4 grid size-9 place-items-center rounded-lg border border-border/40 bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
