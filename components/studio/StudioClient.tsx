'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { createStudioSessionAction, submitStudioTurnAction } from '@/server-actions/studio';
import { SessionHeader } from './SessionHeader';
import { GalleryPanel } from './GalleryPanel';
import { ChatPanel } from './ChatPanel';
import { Composer, type ComposerSubmit } from './Composer';
import { GenerationStatusWatcher } from './GenerationStatusWatcher';
import type { StudioClientProps, StudioTurn } from './types';

export function StudioClient(props: StudioClientProps) {
  const router = useRouter();
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [items, setItems] = useState<StudioTurn[]>(props.initialItems);
  const [workingId, setWorkingId] = useState<string | null>(() => {
    const lastDone = [...props.initialItems].reverse().find((i) => i.status === 'done');
    return lastDone?.id ?? null;
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(props.activeSessionId);
  const [submitting, startSubmit] = useTransition();
  const submitLock = useRef(false);

  function onResolved(
    id: string,
    patch: { status: 'done' | 'failed' | 'canceled'; thumbPath: string | null; errorMessage: string | null },
  ) {
    setItems((cur) =>
      cur.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
    // Al completar, ese turno pasa a ser la imagen de trabajo.
    if (patch.status === 'done') setWorkingId(id);
    if (patch.status === 'failed') toast.error('La generación falló. Se reembolsaron los créditos.');
  }

  function handleSubmit(input: ComposerSubmit) {
    if (submitLock.current) return;
    submitLock.current = true;
    startSubmit(async () => {
      try {
        // Sesión: usa la activa; si no hay, crea una y fija la URL.
        let sessionId = activeSessionId;
        if (!sessionId) {
          const created = await createStudioSessionAction({
            assetType: 'product',
            assetId: props.assetId,
            provider: input.provider,
            modelId: input.model,
          });
          if (!created.ok) {
            toast.error('No se pudo crear la sesión');
            return;
          }
          sessionId = created.data.id;
          setActiveSessionId(sessionId);
          router.replace(`/app/studio/product/${props.assetId}?session=${sessionId}`);
        }

        const res = await submitStudioTurnAction({
          sessionId,
          assetType: 'product',
          provider: input.provider,
          model: input.model,
          variant: input.variant,
          prompt: input.prompt,
          aspectRatio: input.aspectRatio,
          keepIdentical: input.keepIdentical,
          referenceIds: input.referenceIds,
          parentGenerationId: workingId,
        });
        if (!res.ok) {
          toast.error(
            res.error === 'insufficient_credits'
              ? 'Créditos insuficientes'
              : res.message ?? 'No se pudo enviar el turno',
          );
          return;
        }

        // Turno optimista: aparece como "generando…" y se resuelve por Realtime.
        const optimistic: StudioTurn = {
          id: res.data.generationId,
          prompt: input.prompt,
          status: 'queued',
          provider: input.provider,
          modelId: input.model,
          thumbPath: null,
          createdAt: new Date().toISOString(),
          errorMessage: null,
        };
        setItems((cur) => [...cur, optimistic]);
      } finally {
        submitLock.current = false;
      }
    });
  }

  const pending = items.filter((i) => i.status === 'queued' || i.status === 'processing');

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
          <ChatPanel items={items} workingId={workingId} onUseAsBase={setWorkingId} />
          <Composer
            pricing={props.pricing}
            balance={balance}
            availableReferences={props.availableReferences}
            hasWorkingImage={workingId !== null}
            disabled={submitting}
            onSubmit={handleSubmit}
          />
        </section>
        <GalleryPanel items={items} />
      </div>
      {pending.map((it) => (
        <GenerationStatusWatcher key={it.id} generationId={it.id} onResolved={onResolved} />
      ))}
    </div>
  );
}
