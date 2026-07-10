'use client';

import { Loader2, ImageOff } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import type { StudioTurn } from './types';

export function GalleryPanel(props: {
  items: StudioTurn[];
  renderActions?: (item: StudioTurn) => React.ReactNode;
}) {
  const done = props.items.filter((i) => i.thumbPath && i.status === 'done');

  return (
    <aside className="flex h-full flex-col border-l border-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-100">Galería de la sesión</h2>
        <p className="text-xs text-zinc-500">{done.length} imagen(es)</p>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {done.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
            <ImageOff className="h-8 w-8" />
            <p className="text-xs">Aún no hay imágenes en esta sesión.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[...done].reverse().map((item) => (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
              >
                {item.thumbPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={publicThumbnailUrlClient(item.thumbPath)}
                    alt={item.prompt ?? 'Imagen generada'}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                  </div>
                )}
                {props.renderActions ? (
                  <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
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
