'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { submitVideoGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import type { PricingRow } from '@/lib/credits/types';
import { KLING_T2V_MODELS, VEO_MODELS } from '@/lib/schemas/video';
import type { SelectedCampaign } from './CampaignSelector';
import { VideoControlsPanel, VIDEO_STYLES, type ModelKey, type ReferenceImage } from './VideoControlsPanel';
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
  const row = pricing.find(
    (p) => p.provider === 'kling' && p.model_id === model && p.variant === 'per_second',
  );
  return row ? durationSeconds * Number(row.credits_cost) : 0;
}

export function VideoGenerator(props: {
  userId: string;
  initialBalance: number;
  pricing: PricingRow[];
  initialPrompt?: string;
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [model, setModel] = useState<ModelKey>(
    'fal-ai/kling-video/v3/standard/text-to-video',
  );
  const [prompt, setPrompt] = useState(props.initialPrompt ?? '');
  const [duration, setDuration] = useState(5);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(8);
  const [veoResolution, setVeoResolution] = useState<'720p' | '1080p'>('720p');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [campaign, setCampaign] = useState<SelectedCampaign>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolvedOutputUrl, setResolvedOutputUrl] = useState<string | null>(null);
  const [resolvedThumbnailUrl, setResolvedThumbnailUrl] = useState<string | null>(null);

  const live = useGenerationStatus(activeId);

  useEffect(() => {
    if (model.startsWith('veo-') && (veoResolution === '1080p' || referenceImages.length > 0)) {
      setVeoDuration(8);
    }
  }, [model, veoResolution, referenceImages.length]);

  const cost = useMemo(() => {
    const dur = model.startsWith('veo-') ? veoDuration : duration;
    return calcCost(props.pricing, model, dur);
  }, [props.pricing, model, duration, veoDuration]);
  const enhanceCost = useMemo(() => {
    const row = props.pricing.find(
      (p) => p.provider === 'internal' && p.model_id === 'prompt-enhance',
    );
    return row?.credits_cost ?? 5;
  }, [props.pricing]);
  const canGenerate = prompt.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  function handleGenerate() {
    if (!canGenerate) return;
    startTransition(async () => {
      const styleSuffix = selectedStyles
        .map((id) => VIDEO_STYLES.find((s) => s.id === id)?.suffix)
        .filter(Boolean)
        .join(', ');
      const maxLen = model.startsWith('veo-') ? 1024 : 2000;
      const raw = styleSuffix ? `${prompt.trimEnd()}, ${styleSuffix}` : prompt;
      const finalPrompt = raw.slice(0, maxLen);

      const input = model.startsWith('veo-')
        ? {
            kind: 'veo' as const,
            model: model as (typeof VEO_MODELS)[number],
            prompt: finalPrompt,
            aspectRatio: (aspectRatio === '1:1' ? '16:9' : aspectRatio) as '16:9' | '9:16',
            resolution: veoResolution,
            durationSeconds: veoDuration,
            referenceStoragePath: referenceImages[0]?.storagePath,
            campaignId: campaign?.id,
          }
        : {
            kind: 'kling' as const,
            model: model as (typeof KLING_T2V_MODELS)[number],
            prompt: finalPrompt,
            aspectRatio,
            duration,
            cfgScale: 0.5,
            generateAudio,
            referenceStoragePath: referenceImages[0]?.storagePath,
            endReferenceStoragePath: referenceImages[1]?.storagePath,
            campaignId: campaign?.id,
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
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [liveStatus, activeId]);

  const controls = (
    <VideoControlsPanel
      prompt={prompt}
      setPrompt={setPrompt}
      model={model}
      setModel={setModel}
      selectedStyles={selectedStyles}
      setSelectedStyles={setSelectedStyles}
      duration={duration}
      setDuration={setDuration}
      generateAudio={generateAudio}
      setGenerateAudio={setGenerateAudio}
      veoDuration={veoDuration}
      setVeoDuration={setVeoDuration}
      veoResolution={veoResolution}
      setVeoResolution={setVeoResolution}
      referenceImages={referenceImages}
      setReferenceImages={setReferenceImages}
      aspectRatio={aspectRatio}
      setAspectRatio={setAspectRatio}
      campaign={campaign}
      setCampaign={setCampaign}
      cost={cost}
      balance={balance}
      enhanceCost={enhanceCost}
      pending={pending}
      canGenerate={canGenerate}
      onGenerate={handleGenerate}
    />
  );

  const preview = (
    <VideoPreview
      generation={live}
      generationId={activeId}
      resolvedOutputUrl={resolvedOutputUrl}
      resolvedThumbnailUrl={resolvedThumbnailUrl}
    />
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      <div className="hidden lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
        <div className="min-h-0 overflow-hidden">{controls}</div>
        <div className="min-h-0 overflow-hidden">{preview}</div>
      </div>

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
