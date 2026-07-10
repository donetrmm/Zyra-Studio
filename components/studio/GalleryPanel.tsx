'use client';

import { ImageOff } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import { StudioImage } from './StudioImage';
import { cn } from '@/lib/utils';
import type { StudioTurn } from './types';

export function GalleryPanel(props: {
  items: StudioTurn[];
  renderActions?: (item: StudioTurn) => React.ReactNode;
  className?: string;
}) {
  const done = props.items.filter(
    (i): i is StudioTurn & { thumbPath: string } => Boolean(i.thumbPath) && i.status === 'done',
  );

  return (
    <aside
      className={cn(
        // min-h-0 + overflow-hidden: sin esto el <aside> toma su tamaño mínimo
        // automático (= su contenido) en la celda del grid y NO se encoge a la
        // altura disponible, así que crece con las imágenes en vez de dejar que
        // el div interno (flex-1 overflow-y-auto) scrollee. Mismo patrón que el
        // <section> del chat en StudioClient.
        'flex h-full min-h-0 flex-col overflow-hidden border-border lg:border-l',
        props.className,
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-heading text-2sm font-semibold text-foreground">Galería</h2>
        <p className="text-xs text-muted-foreground">
          {done.length === 0
            ? 'Sin imágenes aún'
            : `${done.length} ${done.length === 1 ? 'imagen' : 'imágenes'}`}
        </p>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {done.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <p className="text-xs">Aún no hay imágenes en esta sesión.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[...done].reverse().map((item) => (
              <div
                key={item.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-brand/40"
              >
                <StudioImage
                  thumbSrc={publicThumbnailUrlClient(item.thumbPath)}
                  generationId={item.id}
                  alt={item.prompt ?? 'Imagen generada'}
                  className="absolute inset-0 h-full w-full"
                  imgClassName="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
                />
                {props.renderActions ? (
                  <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    {props.renderActions(item)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
