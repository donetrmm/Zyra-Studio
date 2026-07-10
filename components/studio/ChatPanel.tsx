'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import { Lightbox } from '@/components/generation/Lightbox';
import { Button } from '@/components/ui/button';
import type { StudioAssetType, StudioTurn } from './types';

const EMPTY_COPY: Record<StudioAssetType, string> = {
  product: 'Escribe un prompt abajo para crear la primera imagen del producto.',
  location: 'Escribe un prompt abajo para crear la primera imagen de la locación.',
  character: 'Escribe un prompt abajo para crear la primera imagen del personaje.',
};

export function ChatPanel(props: {
  items: StudioTurn[];
  workingId: string | null;
  assetType: StudioAssetType;
  onUseAsBase: (id: string) => void;
  onRetry: (prompt: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Al aparecer un turno nuevo, pega el scroll al final (donde escribes). Solo con
  // el conteo: cuando un pendiente se resuelve (mismo conteo) no arrastra la vista
  // si estabas leyendo arriba.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items.length]);

  return (
    <div ref={scrollRef} className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
      {props.items.length === 0 ? (
        <p className="mx-auto max-w-sm pt-12 text-center text-sm text-muted-foreground">
          {EMPTY_COPY[props.assetType]}
        </p>
      ) : null}
      {props.items.map((item) => (
        <div key={item.id} className="space-y-2">
          {item.prompt ? (
            <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-muted px-3 py-2 text-sm text-foreground">
              {item.prompt}
            </div>
          ) : null}
          <div className="max-w-[80%]">
            {item.status === 'done' && item.thumbPath ? (
              <div
                className={`overflow-hidden rounded-2xl rounded-bl-sm border ${
                  item.id === props.workingId ? 'border-brand' : 'border-border'
                }`}
              >
                <ChatImage
                  src={publicThumbnailUrlClient(item.thumbPath)}
                  alt={item.prompt ?? 'Imagen generada'}
                />
                <div className="flex items-center gap-2 bg-card px-2 py-1.5">
                  {item.id === props.workingId ? (
                    <span className="flex items-center gap-1 text-xs text-brand">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Imagen de trabajo
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => props.onUseAsBase(item.id)}
                    >
                      Usar como base
                    </Button>
                  )}
                </div>
              </div>
            ) : item.status === 'failed' || item.status === 'canceled' ? (
              <div className="space-y-2 rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{item.errorMessage ?? 'La generación falló. Se reembolsaron los créditos.'}</span>
                </div>
                {item.prompt ? (
                  <button
                    type="button"
                    onClick={() => props.onRetry(item.prompt as string)}
                    className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reintentar
                  </button>
                ) : null}
              </div>
            ) : (
              <PendingCard />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Imagen del chat: altura natural (no recorta el encuadre) y click para ampliar.
function ChatImage(props: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ampliar imagen: ${props.alt}`}
        title="Ampliar"
        className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={props.src} alt={props.alt} loading="lazy" decoding="async" className="w-full" />
      </button>
      {open && <Lightbox src={props.src} alt={props.alt} onClose={() => setOpen(false)} />}
    </>
  );
}

// Tarjeta "generando": cronómetro + aviso al pasar el minuto, porque gpt-image
// puede tardar un par de minutos y un spinner mudo se lee como "colgado".
function PendingCard() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-1 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generando…{secs >= 3 ? ` ${secs}s` : ''}
      </div>
      {secs >= 25 ? (
        <p className="pl-6 text-xs text-muted-foreground/80">
          Puede tardar un par de minutos. Puedes seguir trabajando mientras tanto.
        </p>
      ) : null}
    </div>
  );
}
