'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { submitVideoGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import type { PricingRow } from '@/lib/credits/types';
import { KLING_MODELS, VEO_MODELS } from '@/lib/schemas/video';
import { VideoControlsPanel, type ModelKey } from './VideoControlsPanel';
import { VideoPreview } from './VideoPreview';
import { useGenerationStatus } from './use-generation-status';

function calcCost(
  pricing: PricingRow[],
  model: ModelKey,
  durationSeconds: number,
): number {
  if (model.startsWith('veo-')) {
    const row = pricing.find(
      (p) => p.provider === 'veo' && p.model_id === model && p.variant === '1080p',
    );
    return row ? durationSeconds * Number(row.credits_cost) : 0;
  }
  // Kling
  const isPro = model.includes('/pro/');
  let variant: string;
  if (isPro) variant = 'pro';
  else variant = durationSeconds === 10 ? 'long' : 'standard';
  const row = pricing.find(
    (p) => p.provider === 'kling' && p.model_id === model && p.variant === variant,
  );
  return row ? Number(row.credits_cost) : 0;
}

export function VideoGenerator(props: {
  userId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [model, setModel] = useState<ModelKey>(
    'fal-ai/kling-video/v2.6/standard/text-to-video',
  );
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);
  const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(8);
  const [veoResolution, setVeoResolution] = useState<'720p' | '1080p'>('1080p');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolvedOutputUrl, setResolvedOutputUrl] = useState<string | null>(null);
  const [resolvedThumbnailUrl, setResolvedThumbnailUrl] = useState<string | null>(null);

  const live = useGenerationStatus(activeId);

  const cost = useMemo(() => {
    const dur = model.startsWith('veo-') ? veoDuration : duration;
    return calcCost(props.pricing, model, dur);
  }, [props.pricing, model, duration, veoDuration]);
  const canGenerate = prompt.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  function handleGenerate() {
    if (!canGenerate) return;
    startTransition(async () => {
      const input = model.startsWith('veo-')
        ? {
            kind: 'veo' as const,
            model: model as (typeof VEO_MODELS)[number],
            prompt,
            negativePrompt: negativePrompt || undefined,
            // Veo no soporta 1:1; mapeamos defensivamente al fallback 16:9.
            aspectRatio: (aspectRatio === '1:1' ? '16:9' : aspectRatio) as '16:9' | '9:16',
            resolution: veoResolution,
            durationSeconds: veoDuration,
          }
        : {
            kind: 'kling' as const,
            model: model as (typeof KLING_MODELS)[number],
            prompt,
            negativePrompt: negativePrompt || undefined,
            aspectRatio,
            duration,
            cfgScale: 0.5,
          };
      const res = await submitVideoGenerationAction(input);
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes'
            : res.message || 'No se pudo enviar el job',
        );
        return;
      }
      setActiveId(res.data.generationId);
      setResolvedOutputUrl(null);
      setResolvedThumbnailUrl(null);
    });
  }

  // Cuando llega 'done', resolver la signed URL desde el API route.
  // Solo dependemos del status para no re-fetchear si live cambia por otra razón.
  const liveStatus = live?.status;
  useEffect(() => {
    if (liveStatus !== 'done' || !activeId) return;
    let active = true;
    fetch(`/api/generations/${activeId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string; thumbnailUrl?: string } | null) => {
        if (!active || !data) return;
        if (data.outputUrl) setResolvedOutputUrl(data.outputUrl);
        if (data.thumbnailUrl) setResolvedThumbnailUrl(data.thumbnailUrl);
      });
    return () => {
      active = false;
    };
  }, [liveStatus, activeId]);

  const controls = (
    <VideoControlsPanel
      prompt={prompt}
      setPrompt={setPrompt}
      negativePrompt={negativePrompt}
      setNegativePrompt={setNegativePrompt}
      model={model}
      setModel={setModel}
      duration={duration}
      setDuration={setDuration}
      veoDuration={veoDuration}
      setVeoDuration={setVeoDuration}
      veoResolution={veoResolution}
      setVeoResolution={setVeoResolution}
      aspectRatio={aspectRatio}
      setAspectRatio={setAspectRatio}
      cost={cost}
      balance={balance}
      pending={pending}
      canGenerate={canGenerate}
      onGenerate={handleGenerate}
    />
  );

  const preview = (
    <VideoPreview
      generation={live}
      resolvedOutputUrl={resolvedOutputUrl}
      resolvedThumbnailUrl={resolvedThumbnailUrl}
    />
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      {/* Desktop: 2 columnas flush bajo el topbar global. */}
      <div className="hidden lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
        <div className="min-h-0 overflow-hidden">{controls}</div>
        <div className="min-h-0 overflow-hidden">{preview}</div>
      </div>

      {/* Mobile / tablet: tabs. */}
      <div className="lg:hidden">
        <Tabs defaultValue="controls" className="flex h-[calc(100dvh-7.5rem)] flex-col">
          <TabsList className="mx-3 mt-3 grid w-auto grid-cols-2">
            <TabsTrigger value="controls">Controles</TabsTrigger>
            <TabsTrigger value="preview">Vista previa</TabsTrigger>
          </TabsList>
          <TabsContent value="controls" className="mt-3 flex-1 overflow-hidden">
            <div className="h-full">{controls}</div>
          </TabsContent>
          <TabsContent value="preview" className="mt-3 flex-1 overflow-hidden">
            <div className="h-full">{preview}</div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
