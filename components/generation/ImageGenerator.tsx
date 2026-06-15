'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PricingRow } from '@/lib/credits/types';
import { estimateCredits } from '@/lib/credits/estimator';
import { applyBrandKit } from '@/lib/brand-kit/apply';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import { selectImageModel, type ImageIntent } from '@/lib/router/model-selector';
import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { ControlsPanel } from './ControlsPanel';
import { ChatThread } from './ChatThread';
import { PreviewArea, type GenError } from './PreviewArea';
import type { SelectedBrandKit } from './BrandKitSelector';
import type { SelectedCampaign } from './CampaignSelector';
import type { ReferenceClient } from './ReferencesPanel';
import type { ModelKey, Selection, SessionItem } from './types';

export type AvailableReference = {
  id: string;
  storagePath: string;
  previewUrl: string | null;
  filename: string;
  source: string;
};

export function ImageGenerator(props: {
  userId: string;
  workspaceId: string;
  initialBalance: number;
  pricing: PricingRow[];
  availableReferences: AvailableReference[];
  initialPrompt?: string;
  initialAspect?: string;
  initialModelKey?: ModelKey;
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);

  // Costo de "Mejorar prompt" desde model_pricing (provider='internal').
  // Fallback a 5 si la fila no existe aún (migration 009 sin aplicar).
  const enhanceCost = useMemo(() => {
    const row = props.pricing.find(
      (p) => p.provider === 'internal' && p.model_id === 'prompt-enhance',
    );
    return row?.credits_cost ?? 5;
  }, [props.pricing]);

  const [modelKey, setModelKey] = useState<ModelKey>(
    props.initialModelKey ?? 'nano-pro',
  );
  const [prompt, setPrompt] = useState(props.initialPrompt ?? '');
  const [aspectRatio, setAspectRatio] = useState<string>(
    props.initialAspect ?? '1:1',
  );
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('2k');
  const [hasTextInImage, setHasTextInImage] = useState(false);
  const [noBackground, setNoBackground] = useState(false);
  const [conversational, setConversational] = useState(false);
  const [useGrounding, setUseGrounding] = useState(false);
  const [photoreal, setPhotoreal] = useState(false);
  const [megapixels, setMegapixels] = useState<1 | 2 | 4>(1);
  const [intent, setIntent] = useState<ImageIntent | null>(null);
  const [references, setReferences] = useState<ReferenceClient[]>([]);
  const [brandKit, setBrandKit] = useState<SelectedBrandKit>(null);
  const [campaign, setCampaign] = useState<SelectedCampaign>(null);
  const [session, setSession] = useState<SessionItem[]>([]);
  const [activeResult, setActiveResult] = useState<SessionItem | null>(null);
  const [genError, setGenError] = useState<GenError | null>(null);
  const [pending, startTransition] = useTransition();

  const selection = useMemo<Selection>(() => {
    if (modelKey === 'auto') {
      return selectImageModel({
        intent,
        hasTextInImage,
        photoreal,
        references,
        useGrounding,
        conversational,
        resolution,
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
  }, [
    modelKey,
    intent,
    hasTextInImage,
    photoreal,
    references,
    useGrounding,
    conversational,
    resolution,
  ]);

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
    const finalPrompt = brandKit ? applyBrandKit(prompt, brandKit, 'image') : prompt;
    if (selection.provider === 'nano-banana') {
      return {
        provider: 'nano-banana' as const,
        model: selection.model as
          | 'gemini-3-pro-image-preview'
          | 'gemini-3.1-flash-image-preview',
        variant: selection.variant as '1k' | '2k' | '4k',
        prompt: finalPrompt,
        aspectRatio,
        references: references.map((r) => ({ id: r.id, storagePath: r.storagePath })),
        hasTextInImage,
        noBackground,
        conversational: effectiveConversational,
        useGrounding,
        parentGenerationId:
          effectiveConversational && activeResult ? activeResult.id : undefined,
        campaignId: campaign?.id,
      };
    }
    return {
      provider: 'flux' as const,
      model: 'flux-2-pro-preview' as const,
      variant: 'default' as const,
      prompt: finalPrompt,
      aspectRatio,
      megapixels,
      references: references.map((r) => ({ id: r.id, storagePath: r.storagePath })),
      photoreal,
      campaignId: campaign?.id,
    };
  }, [
    selection,
    prompt,
    aspectRatio,
    references,
    hasTextInImage,
    noBackground,
    effectiveConversational,
    useGrounding,
    megapixels,
    photoreal,
    activeResult,
    brandKit,
    campaign,
  ]);

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    const input = buildInput();
    setGenError(null); // limpia el error previo al reintentar/generar
    startTransition(async () => {
      const res = await submitGenerationAction(input);
      if (!res.ok) {
        // Estado de error PERSISTENTE en el preview (no toast efímero): el
        // usuario invirtió la espera y necesita causa + recuperación.
        // insufficient_credits ocurre antes de cobrar (refunded=0); los demás
        // fallos sí refundan el costo estimado.
        const kind: GenError['kind'] =
          res.error === 'safety' ? 'safety' : res.error === 'insufficient_credits' ? 'credits' : 'generic';
        const message =
          res.error === 'insufficient_credits'
            ? 'No tienes saldo para esta generación. Compra créditos y vuelve a intentar.'
            : res.error === 'validation_error'
              ? 'Parámetros inválidos. Revisa el prompt y los ajustes, y reintenta.'
              : res.message || 'Hubo un problema al generar. Reintenta en un momento.';
        setGenError({ kind, message, refunded: kind === 'credits' ? 0 : cost });
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
  }, [canGenerate, buildInput, effectiveConversational, cost]);

  const providerLabel = labelForSelection(selection);

  // Cap de refs según el modelo activo (igual lógica que ReferencesPanel).
  const maxRefs =
    selection.provider === 'nano-banana'
      ? selection.model === 'gemini-3.1-flash-image-preview'
        ? 14
        : 11
      : 8;
  const canAddReference = references.length < maxRefs;

  // Atajo del botón + dentro del chat composer: sube un archivo local y lo
  // agrega al array de references. Respeta el cap del modelo activo.
  const handleAttachFromChat = useCallback(
    async (file: File) => {
      if (references.length >= maxRefs) {
        toast.error(`Máximo ${maxRefs} referencias para este modelo`);
        return;
      }
      const res = await uploadReferenceFile(file);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setReferences((prev) => [...prev, res.ref]);
      toast.success('Referencia agregada');
    },
    [references.length, maxRefs],
  );

  const handleUseAsReference = useCallback(
    async (item: SessionItem) => {
      if (references.length >= maxRefs) {
        toast.error(`Máximo ${maxRefs} referencias para este modelo`);
        return;
      }
      const res = await addGenerationAsReferenceAction({ generationId: item.id });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo usar como referencia');
        return;
      }
      setReferences((prev) => [
        ...prev,
        {
          id: res.data.id,
          storagePath: res.data.storagePath,
          previewUrl: res.data.previewUrl || item.thumbnailUrl || item.outputUrl || '',
          filename: res.data.filename,
        },
      ]);
      toast.success('Agregada como referencia');
    },
    [references.length, maxRefs],
  );

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
      aspectRatio={aspectRatio}
      setAspectRatio={setAspectRatio}
      resolution={resolution}
      setResolution={setResolution}
      hasTextInImage={hasTextInImage}
      setHasTextInImage={setHasTextInImage}
      noBackground={noBackground}
      setNoBackground={setNoBackground}
      conversational={conversational}
      setConversational={setConversational}
      useGrounding={useGrounding}
      setUseGrounding={setUseGrounding}
      photoreal={photoreal}
      setPhotoreal={setPhotoreal}
      megapixels={megapixels}
      setMegapixels={setMegapixels}
      intent={intent}
      setIntent={setIntent}
      references={references}
      setReferences={setReferences}
      availableReferences={props.availableReferences}
      activeResult={activeResult}
      cost={cost}
      balance={balance}
      etaSeconds={etaSeconds}
      pending={pending}
      canGenerate={canGenerate}
      onGenerate={handleGenerate}
      hideCta={effectiveConversational}
      enhanceCost={enhanceCost}
      brandKit={brandKit}
      setBrandKit={setBrandKit}
      campaign={campaign}
      setCampaign={setCampaign}
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
      onAttach={handleAttachFromChat}
      canAttach={canAddReference}
    />
  ) : (
    <PreviewArea
      pending={pending}
      result={activeResult}
      error={genError}
      onRetry={handleGenerate}
      providerLabel={providerLabel}
      session={session}
      onSelect={(item) => { setGenError(null); setActiveResult(item); }}
      aspectRatio={aspectRatio}
      promptEcho={prompt}
      etaSeconds={etaSeconds}
      onUseAsReference={handleUseAsReference}
      canAddReference={canAddReference}
    />
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      {/* Desktop: 2 columnas flush bajo el topbar global. */}
      <div className="hidden lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
        <div className="min-h-0 overflow-hidden">{controls}</div>
        <div className="min-h-0 overflow-hidden">{main}</div>
      </div>

      {/* Mobile / tablet: tabs. */}
      <div className="lg:hidden">
        <Tabs
          defaultValue="controls"
          className="flex h-[calc(100dvh-7rem)] flex-col"
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
