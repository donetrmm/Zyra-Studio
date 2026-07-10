'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import { Button } from '@/components/ui/button';
import { DownloadTurnButton } from './DownloadTurnButton';
import { StudioImage } from './StudioImage';
import type { StudioAssetType, StudioTurn } from './types';

const EMPTY_COPY: Record<StudioAssetType, string> = {
  product: 'Describe el producto que imaginas y el estudio lo genera. Cada versión aparece aquí.',
  location: 'Describe la locación que imaginas y el estudio la genera. Cada versión aparece aquí.',
  character: 'Describe al personaje que imaginas y el estudio lo genera. Cada versión aparece aquí.',
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
    <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {props.items.length === 0 ? (
        <div className="zyra-fade-in flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-border bg-card">
            <Sparkles className="size-6 text-brand" aria-hidden />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-heading text-base font-semibold text-foreground">Crea tu primera imagen</h2>
            <p className="mx-auto max-w-xs text-sm text-muted-foreground">{EMPTY_COPY[props.assetType]}</p>
          </div>
        </div>
      ) : null}
      {props.items.map((item) => (
        <div key={item.id} className="zyra-fade-up space-y-2">
          {item.prompt ? (
            <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-muted px-3 py-2 text-sm text-foreground">
              {item.prompt}
            </div>
          ) : null}
          <div className="max-w-[80%]">
            {item.status === 'done' && item.thumbPath ? (
              <div
                className={`zyra-fade-in overflow-hidden rounded-2xl rounded-bl-sm border transition-shadow ${
                  item.id === props.workingId
                    ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]'
                    : 'border-border'
                }`}
              >
                <StudioImage
                  thumbSrc={publicThumbnailUrlClient(item.thumbPath)}
                  generationId={item.id}
                  alt={item.prompt ?? 'Imagen generada'}
                  className="block w-full"
                  imgClassName="mx-auto block max-h-[65vh] w-auto max-w-full"
                />
                <div className="flex items-center gap-1 bg-card px-2 py-1.5">
                  {item.id === props.workingId ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-brand">
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
                  <DownloadTurnButton generationId={item.id} className="ml-auto h-7 gap-1 text-xs" />
                </div>
              </div>
            ) : item.status === 'failed' || item.status === 'canceled' ? (
              <div className="zyra-fade-in space-y-2 rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
              <PendingCard aspectRatio={item.aspectRatio} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Tarjeta "generando": reserva el espacio del aspecto pedido (sin salto al llegar
// la imagen) con shimmer + spinner orbital de acento — mismo lenguaje visual que
// PreviewArea. Cronómetro y aviso al pasar el minuto (gpt-image puede tardar).
function PendingCard(props: { aspectRatio: string | null }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const ratio = props.aspectRatio ? props.aspectRatio.replace(':', ' / ') : '1 / 1';
  return (
    <div className="overflow-hidden rounded-2xl rounded-bl-sm border border-border bg-card">
      <div className="relative w-full" style={{ aspectRatio: ratio }}>
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(105deg, transparent 30%, color-mix(in oklch, var(--color-brand) 14%, transparent) 50%, transparent 70%)',
            backgroundSize: '400px 100%',
            animation: 'zyra-shimmer 1.6s linear infinite',
          }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative size-11">
            <div className="absolute inset-0 rounded-full border-[1.5px] border-brand/20" aria-hidden />
            <div
              className="absolute inset-0 rounded-full border-[1.5px] border-transparent"
              aria-hidden
              style={{ borderTopColor: 'var(--color-brand)', animation: 'zyra-orbit 1.2s linear infinite' }}
            />
            <Sparkles className="absolute left-[15px] top-[15px] size-3.5 text-brand" aria-hidden />
          </div>
        </div>
      </div>
      <div className="space-y-0.5 px-3 py-2">
        <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.08em] text-brand">
          <span
            className="size-1.5 rounded-full bg-brand"
            style={{ animation: 'zyra-pulse-glow 1.4s ease infinite' }}
          />
          Generando{secs >= 3 ? ` · ${secs}s` : ''}
        </div>
        {secs >= 25 ? (
          <p className="text-2xs text-muted-foreground">
            Puede tardar un par de minutos. Puedes seguir trabajando.
          </p>
        ) : null}
      </div>
    </div>
  );
}
