'use client';

import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import { Button } from '@/components/ui/button';
import type { StudioTurn } from './types';

export function ChatPanel(props: {
  items: StudioTurn[];
  workingId: string | null;
  onUseAsBase: (id: string) => void;
}) {
  return (
    <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
      {props.items.length === 0 ? (
        <p className="mx-auto max-w-sm pt-12 text-center text-sm text-muted-foreground">
          Escribe un prompt abajo para crear la primera imagen del producto.
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicThumbnailUrlClient(item.thumbPath)}
                  alt={item.prompt ?? 'Imagen generada'}
                  className="w-full object-cover"
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
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{item.errorMessage ?? 'La generación falló. Se reembolsaron los créditos.'}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generando…
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
