'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { submitAudioGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PricingRow } from '@/lib/credits/types';
import { TTS_LANGUAGES, TTS_MODELS } from '@/lib/schemas/audio';
import { AudioControlsPanel, OFFICIAL_VOICES } from './AudioControlsPanel';
import { AudioPreview } from './AudioPreview';
import { useGenerationStatus } from './use-generation-status';

function calcCost(pricing: PricingRow[], modelId: (typeof TTS_MODELS)[number], chars: number): number {
  const row = pricing.find(
    (p) => p.provider === 'elevenlabs' && p.model_id === modelId && p.variant === 'default',
  );
  if (!row || !row.unit_size) return 0;
  const units = Math.max(1, Math.ceil(chars / row.unit_size));
  return units * Number(row.credits_cost);
}

export function AudioGenerator(props: {
  userId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState<string>(OFFICIAL_VOICES[0].id);
  const [modelId, setModelId] = useState<(typeof TTS_MODELS)[number]>('eleven_multilingual_v2');
  const [languageCode, setLanguageCode] = useState<(typeof TTS_LANGUAGES)[number]>('es');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolvedOutputUrl, setResolvedOutputUrl] = useState<string | null>(null);

  const live = useGenerationStatus(activeId);

  const cost = useMemo(
    () => calcCost(props.pricing, modelId, text.length || 1),
    [props.pricing, modelId, text.length],
  );

  const canGenerate = text.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  function handleGenerate() {
    if (!canGenerate) return;
    startTransition(async () => {
      const res = await submitAudioGenerationAction({
        kind: 'tts',
        voiceId,
        modelId,
        text,
        voiceSettings: { stability, similarity_boost: similarityBoost, style },
        languageCode,
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
      .then((data: { outputUrl?: string } | null) => {
        if (active && data?.outputUrl) setResolvedOutputUrl(data.outputUrl);
      });
    return () => {
      active = false;
    };
  }, [liveStatus, activeId]);

  const controls = (
    <AudioControlsPanel
      text={text}
      setText={setText}
      voiceId={voiceId}
      setVoiceId={setVoiceId}
      modelId={modelId}
      setModelId={setModelId}
      languageCode={languageCode}
      setLanguageCode={setLanguageCode}
      stability={stability}
      setStability={setStability}
      similarityBoost={similarityBoost}
      setSimilarityBoost={setSimilarityBoost}
      style={style}
      setStyle={setStyle}
      cost={cost}
      balance={balance}
      pending={pending}
      canGenerate={canGenerate}
      onGenerate={handleGenerate}
    />
  );

  const preview = <AudioPreview generation={live} generationId={activeId} resolvedOutputUrl={resolvedOutputUrl} />;

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8">
      {/* Desktop: 2 columnas flush bajo el topbar global. */}
      <div className="hidden lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
        <div className="min-h-0 overflow-hidden">{controls}</div>
        <div className="min-h-0 overflow-hidden">{preview}</div>
      </div>

      {/* Mobile / tablet: tabs. */}
      <div className="lg:hidden">
        <Tabs
          defaultValue="controls"
          className="flex h-[calc(100dvh-7.5rem)] flex-col"
        >
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
