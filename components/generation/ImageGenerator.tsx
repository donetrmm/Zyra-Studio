'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PricingRow } from '@/lib/credits/types';
import { estimateCredits } from '@/lib/credits/estimator';
import { selectImageModel } from '@/lib/router/model-selector';
import { submitGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { ControlsPanel } from './ControlsPanel';
import { ChatThread } from './ChatThread';
import { PreviewArea } from './PreviewArea';
import type { ReferenceClient } from './ReferencesPanel';
import type { ModelKey, Selection, SessionItem } from './types';

export function ImageGenerator(props: {
  userId: string;
  workspaceId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);

  const [modelKey, setModelKey] = useState<ModelKey>('nano-pro');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('2k');
  const [hasTextInImage, setHasTextInImage] = useState(false);
  const [conversational, setConversational] = useState(false);
  const [useGrounding, setUseGrounding] = useState(false);
  const [photoreal, setPhotoreal] = useState(false);
  const [megapixels, setMegapixels] = useState<1 | 2 | 4>(1);
  const [references, setReferences] = useState<ReferenceClient[]>([]);
  const [session, setSession] = useState<SessionItem[]>([]);
  const [activeResult, setActiveResult] = useState<SessionItem | null>(null);
  const [pending, startTransition] = useTransition();

  const selection = useMemo<Selection>(() => {
    if (modelKey === 'auto') {
      return selectImageModel({
        hasTextInImage,
        references,
        useGrounding,
        resolution,
        priority: 'quality',
      });
    }
    if (modelKey === 'nano-pro') {
      return {
        provider: 'nano-banana',
        model: 'gemini-3-pro-image-preview',
        variant: resolution,
      };
    }
    if (modelKey === 'nano-flash') {
      return {
        provider: 'nano-banana',
        model: 'gemini-3.1-flash-image-preview',
        variant: resolution === '4k' ? '2k' : resolution,
      };
    }
    return {
      provider: 'flux',
      model: 'flux-2-pro-preview',
      variant: 'default',
    };
  }, [modelKey, hasTextInImage, references, useGrounding, resolution]);

  // FLUX no soporta conversational — auto-apagar al cambiar a FLUX.
  const effectiveConversational =
    selection.provider === 'nano-banana' && conversational;

  const breakdown = useMemo(() => {
    try {
      return estimateCredits(props.pricing, {
        provider: selection.provider,
        model: selection.model,
        variant: selection.variant,
        params:
          selection.provider === 'flux'
            ? { megapixels, references: references.length }
            : { conversational: effectiveConversational, useGrounding },
      });
    } catch {
      return null;
    }
  }, [
    props.pricing,
    selection,
    effectiveConversational,
    useGrounding,
    megapixels,
    references.length,
  ]);

  const cost = breakdown?.total ?? 0;
  const canGenerate =
    prompt.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  const etaSeconds = useMemo(() => {
    if (selection.provider === 'flux') return megapixels === 4 ? 28 : 14;
    if (selection.model === 'gemini-3.1-flash-image-preview') return 6;
    if (resolution === '4k') return 50;
    return 18;
  }, [selection, megapixels, resolution]);

  const buildInput = useCallback(() => {
    if (selection.provider === 'nano-banana') {
      return {
        provider: 'nano-banana' as const,
        model: selection.model as
          | 'gemini-3-pro-image-preview'
          | 'gemini-3.1-flash-image-preview',
        variant: selection.variant as '1k' | '2k' | '4k',
        prompt,
        negativePrompt: negativePrompt.trim() || undefined,
        aspectRatio,
        references: references.map((r) => ({ id: r.id, storagePath: r.storagePath })),
        hasTextInImage,
        conversational: effectiveConversational,
        useGrounding,
        parentGenerationId:
          effectiveConversational && activeResult ? activeResult.id : undefined,
      };
    }
    return {
      provider: 'flux' as const,
      model: 'flux-2-pro-preview' as const,
      variant: 'default' as const,
      prompt,
      negativePrompt: negativePrompt.trim() || undefined,
      aspectRatio,
      megapixels,
      references: references.map((r) => ({ id: r.id, storagePath: r.storagePath })),
      photoreal,
    };
  }, [
    selection,
    prompt,
    negativePrompt,
    aspectRatio,
    references,
    hasTextInImage,
    effectiveConversational,
    useGrounding,
    megapixels,
    photoreal,
    activeResult,
  ]);

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    const input = buildInput();
    startTransition(async () => {
      const res = await submitGenerationAction(input);
      if (!res.ok) {
        const msg =
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes para esta generación.'
            : res.error === 'safety'
              ? 'El proveedor rechazó el contenido por políticas de seguridad.'
              : res.error === 'validation_error'
                ? 'Parámetros inválidos. Revisa el prompt y los ajustes.'
                : res.message || 'No se pudo generar la imagen.';
        toast.error(msg);
        return;
      }
      const detail = await fetchGenerationDetail(res.data.generationId);
      if (detail) {
        setSession((prev) => [detail, ...prev].slice(0, 24));
        setActiveResult(detail);
        // En modo chat limpiamos el prompt; en normal lo mantenemos para iterar.
        if (effectiveConversational) setPrompt('');
        toast.success('Imagen lista');
      }
    });
  }, [canGenerate, buildInput, effectiveConversational]);

  const providerLabel = labelForSelection(selection);

  // Hilo conversacional: solo las generaciones encadenadas por parent.
  // Como hoy guardamos parent en el server pero no lo devolvemos al cliente
  // por ítem, usamos un proxy razonable: cuando conversational está ON, todo
  // lo de la sesión que comparte modelo cuenta. Mejor que nada para demo.
  const threadItems = useMemo(() => {
    if (!effectiveConversational) return session;
    return session.filter((s) => s.model === selection.model);
  }, [session, effectiveConversational, selection.model]);

  const controls = (
    <ControlsPanel
      modelKey={modelKey}
      setModelKey={setModelKey}
      selection={selection}
      prompt={prompt}
      setPrompt={setPrompt}
      negativePrompt={negativePrompt}
      setNegativePrompt={setNegativePrompt}
      aspectRatio={aspectRatio}
      setAspectRatio={setAspectRatio}
      resolution={resolution}
      setResolution={setResolution}
      hasTextInImage={hasTextInImage}
      setHasTextInImage={setHasTextInImage}
      conversational={conversational}
      setConversational={setConversational}
      useGrounding={useGrounding}
      setUseGrounding={setUseGrounding}
      photoreal={photoreal}
      setPhotoreal={setPhotoreal}
      megapixels={megapixels}
      setMegapixels={setMegapixels}
      references={references}
      setReferences={setReferences}
      activeResult={activeResult}
      cost={cost}
      balance={balance}
      etaSeconds={etaSeconds}
      pending={pending}
      canGenerate={canGenerate}
      onGenerate={handleGenerate}
      hideCta={effectiveConversational}
    />
  );

  const main = effectiveConversational ? (
    <ChatThread
      thread={threadItems}
      prompt={prompt}
      setPrompt={setPrompt}
      pending={pending}
      canGenerate={canGenerate}
      onGenerate={handleGenerate}
      onExit={() => setConversational(false)}
      providerLabel={providerLabel}
      aspectRatio={aspectRatio}
    />
  ) : (
    <PreviewArea
      pending={pending}
      result={activeResult}
      providerLabel={providerLabel}
      session={session}
      onSelect={setActiveResult}
      aspectRatio={aspectRatio}
      promptEcho={prompt}
      etaSeconds={etaSeconds}
    />
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      {/* Desktop: 2 columnas flush bajo el topbar global. */}
      <div className="hidden lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px,1fr]">
        <div className="min-h-0 overflow-hidden">{controls}</div>
        <div className="min-h-0 overflow-hidden">{main}</div>
      </div>

      {/* Mobile / tablet: tabs. */}
      <div className="lg:hidden">
        <Tabs
          defaultValue="controls"
          className="flex h-[calc(100dvh-7.5rem)] flex-col"
        >
          <TabsList className="mx-3 mt-3 grid w-auto grid-cols-2">
            <TabsTrigger value="controls">Controles</TabsTrigger>
            <TabsTrigger value="preview">
              {effectiveConversational ? 'Hilo' : 'Vista previa'}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="controls" className="mt-3 flex-1 overflow-hidden">
            <div className="h-full">{controls}</div>
          </TabsContent>
          <TabsContent value="preview" className="mt-3 flex-1 overflow-hidden">
            <div className="h-full">{main}</div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function labelForSelection(sel: Selection) {
  if (sel.provider === 'flux') return 'FLUX 2 Pro';
  if (sel.model === 'gemini-3-pro-image-preview')
    return `Nano Banana Pro · ${sel.variant.toUpperCase()}`;
  return `Nano Banana Flash · ${sel.variant.toUpperCase()}`;
}

async function fetchGenerationDetail(id: string): Promise<SessionItem | null> {
  try {
    const res = await fetch(`/api/generations/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data as SessionItem;
  } catch {
    return null;
  }
}
