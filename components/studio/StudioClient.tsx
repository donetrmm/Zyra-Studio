'use client';

import { useState } from 'react';
import { SessionHeader } from './SessionHeader';
import { GalleryPanel } from './GalleryPanel';
import type { StudioClientProps, StudioTurn } from './types';

export function StudioClient(props: StudioClientProps) {
  const [items, setItems] = useState<StudioTurn[]>(props.initialItems);
  const [workingId, setWorkingId] = useState<string | null>(() => {
    const lastDone = [...props.initialItems].reverse().find((i) => i.status === 'done');
    return lastDone?.id ?? null;
  });
  // La sesión activa la fija la URL (?session); el cliente la conserva para saber
  // si crear una sesión nueva en el primer turno (Task 4).
  const [activeSessionId, setActiveSessionId] = useState<string | null>(props.activeSessionId);

  // Estos setters los consumen Composer (Task 4: appendItem, updateItem,
  // setWorkingId, setActiveSessionId) y las acciones de galería (Task 5).
  void setItems;
  void setWorkingId;
  void setActiveSessionId;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <SessionHeader
        assetId={props.assetId}
        assetName={props.assetName}
        sessions={props.sessions}
        activeSessionId={activeSessionId}
        defaultProvider="nano-banana"
        defaultModelId="gemini-3-pro-image-preview"
      />
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        <section className="flex h-full flex-col overflow-hidden">
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-zinc-500">
              {workingId
                ? 'Continúa iterando sobre la imagen de trabajo desde el compositor.'
                : 'Escribe un prompt para empezar a crear imágenes de este producto.'}
            </p>
          </div>
        </section>
        <GalleryPanel items={items} />
      </div>
    </div>
  );
}
