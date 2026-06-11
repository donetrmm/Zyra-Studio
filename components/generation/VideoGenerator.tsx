'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { submitVideoGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import type { PricingRow } from '@/lib/credits/types';
import { KLING_T2V_MODELS, VEO_MODELS } from '@/lib/schemas/video';
import { estimateVideoEta } from '@/lib/generation/video-meta';
import type { SelectedCampaign } from './CampaignSelector';
import {
  VideoControlsPanel,
  VIDEO_STYLES,
  type ModelKey,
  type ReferenceImage,
  type SeedanceResolutionUi,
  type VideoAspectRatio,
} from './VideoControlsPanel';
import type { SeedanceRef } from './SeedanceRefsPanel';
import { VideoPreview } from './VideoPreview';
import { useGenerationStatus } from './use-generation-status';

// Slug real de fal según tier + operación (un slug por endpoint).
function seedanceSlug(model: ModelKey, operation: 'text' | 'image' | 'reference'): string {
  const base = model === 'seedance-2.0-fast' ? 'bytedance/seedance-2.0/fast' : 'bytedance/seedance-2.0';
  return `${base}/${operation}-to-video`;
}

function calcCost(
  pricing: PricingRow[],
  model: ModelKey,
  durationSeconds: number,
  seedanceResolution: SeedanceResolutionUi,
): number {
  if (model.startsWith('seedance')) {
    // Mismo precio por segundo para t2v/i2v/r2v dentro del tier (migración 024).
    const slug = seedanceSlug(model, 'reference');
    const row = pricing.find(
      (p) => p.provider === 'seedance' && p.model_id === slug && p.variant === `per_second_${seedanceResolution}`,
    );
    return row ? durationSeconds * Number(row.credits_cost) : 0;
  }
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
  const [model, setModel] = useState<ModelKey>('seedance-2.0');
  const [prompt, setPrompt] = useState(props.initialPrompt ?? '');
  const [duration, setDuration] = useState(5);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(8);
  const [veoResolution, setVeoResolution] = useState<'720p' | '1080p'>('720p');
  const [seedanceDuration, setSeedanceDuration] = useState(8);
  const [seedanceResolution, setSeedanceResolution] = useState<SeedanceResolutionUi>('720p');
  const [seedanceSeed, setSeedanceSeed] = useState('');
  const [seedanceRefs, setSeedanceRefs] = useState<SeedanceRef[]>([]);
  const [seedanceStartFrame, setSeedanceStartFrame] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
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
    const dur = model.startsWith('seedance')
      ? seedanceDuration
      : model.startsWith('veo-')
        ? veoDuration
        : duration;
    return calcCost(props.pricing, model, dur, seedanceResolution);
  }, [props.pricing, model, duration, veoDuration, seedanceDuration, seedanceResolution]);
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
      const isSeedance = model.startsWith('seedance');
      const maxLen = isSeedance ? 4000 : model.startsWith('veo-') ? 1024 : 2000;
      const raw = styleSuffix ? `${prompt.trimEnd()}, ${styleSuffix}` : prompt;
      const finalPrompt = raw.slice(0, maxLen);

      if (isSeedance) {
        const images = seedanceRefs.filter((r) => r.kind === 'image').map((r) => r.storagePath);
        const videos = seedanceRefs.filter((r) => r.kind === 'video').map((r) => r.storagePath);
        const audios = seedanceRefs.filter((r) => r.kind === 'audio').map((r) => r.storagePath);
        const useStartFrame =
          seedanceStartFrame && images.length > 0 && images.length <= 2 && videos.length === 0 && audios.length === 0;
        const operation = useStartFrame
          ? 'image'
          : seedanceRefs.length > 0
            ? 'reference'
            : 'text';
        const seed = seedanceSeed.trim() === '' ? undefined : Number(seedanceSeed);
        const res = await submitVideoGenerationAction({
          kind: 'seedance' as const,
          model: seedanceSlug(model, operation),
          prompt: finalPrompt,
          aspectRatio,
          resolution: seedanceResolution,
          duration: seedanceDuration,
          generateAudio,
          ...(seed !== undefined && Number.isInteger(seed) ? { seed } : {}),
          ...(useStartFrame
            ? {
                referenceStoragePath: images[0],
                ...(images[1] ? { endReferenceStoragePath: images[1] } : {}),
              }
            : {
                referenceImagePaths: images,
                referenceVideoPaths: videos,
                referenceAudioPaths: audios,
              }),
          campaignId: campaign?.id,
        });
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
        return;
      }

      const input = model.startsWith('veo-')
        ? {
            kind: 'veo' as const,
            model: model as (typeof VEO_MODELS)[number],
            prompt: finalPrompt,
            aspectRatio: (aspectRatio === '9:16' ? '9:16' : '16:9') as '16:9' | '9:16',
            resolution: veoResolution,
            durationSeconds: veoDuration,
            referenceStoragePath: referenceImages[0]?.storagePath,
            campaignId: campaign?.id,
          }
        : {
            kind: 'kling' as const,
            model: model as (typeof KLING_T2V_MODELS)[number],
            prompt: finalPrompt,
            aspectRatio: (['16:9', '9:16', '1:1'].includes(aspectRatio)
              ? aspectRatio
              : '16:9') as '16:9' | '9:16' | '1:1',
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
      seedanceDuration={seedanceDuration}
      setSeedanceDuration={setSeedanceDuration}
      seedanceResolution={seedanceResolution}
      setSeedanceResolution={setSeedanceResolution}
      seedanceSeed={seedanceSeed}
      setSeedanceSeed={setSeedanceSeed}
      seedanceRefs={seedanceRefs}
      setSeedanceRefs={setSeedanceRefs}
      seedanceStartFrame={seedanceStartFrame}
      setSeedanceStartFrame={setSeedanceStartFrame}
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

  const previewEtaSeconds = estimateVideoEta(model, duration, veoDuration, veoResolution, seedanceDuration);

  const preview = (
    <VideoPreview
      generation={live}
      generationId={activeId}
      resolvedOutputUrl={resolvedOutputUrl}
      resolvedThumbnailUrl={resolvedThumbnailUrl}
      model={model}
      aspectRatio={aspectRatio}
      etaSeconds={previewEtaSeconds}
      prompt={prompt}
      veoResolution={veoResolution}
      veoDuration={veoDuration}
      klingDuration={duration}
      onRetry={handleGenerate}
      canRetry={canGenerate}
    />
  );

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      <div className="hidden lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
        <div className="min-h-0 overflow-hidden">{controls}</div>
        <div className="min-h-0 overflow-hidden">{preview}</div>
      </div>

      <div className="lg:hidden">
        <Tabs defaultValue="controls" className="flex h-[calc(100dvh-7rem)] flex-col">
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
