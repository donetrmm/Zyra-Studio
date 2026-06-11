'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Download,
  Library,
  Loader2,
  RefreshCw,
  Sparkles,
  Video as VideoIcon,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cancelGenerationAction } from '@/server-actions/generations';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { cn } from '@/lib/utils';
import type { LiveGeneration } from './use-generation-status';
import type { ModelKey } from './VideoControlsPanel';
import { MODEL_LABEL } from '@/lib/generation/video-meta';
import {
  GhostBtn,
  PreviewToolbar,
  PrimaryGhost,
  RotatingTips,
  aspectToRatio,
} from './preview-shared';

const ROTATING_TIPS = [
  'Animando la escena',
  'Renderizando frames',
  'Componiendo movimiento de cámara',
  'Generando audio y efectos',
] as const;

const SAMPLE_PROMPTS = [
  'Plano cenital de una cafetería al amanecer',
  'Travelling lateral por un bosque nevado',
  'Cierre lento sobre el rostro de un astronauta',
];

export type VideoPreviewProps = {
  generation: LiveGeneration | null;
  generationId: string | null;
  resolvedOutputUrl: string | null;
  resolvedThumbnailUrl: string | null;
  model: ModelKey;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  etaSeconds: number;
  prompt: string;
  veoResolution: '720p' | '1080p';
  veoDuration: 4 | 6 | 8;
  klingDuration: number;
  onRetry: () => void;
  canRetry: boolean;
};

export function VideoPreview(props: VideoPreviewProps) {
  const status = props.generation?.status;
  const generating = status === 'queued' || status === 'processing';
  const failed = status === 'failed' || status === 'canceled';
  const ready = status === 'done' && !!props.resolvedOutputUrl;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PreviewToolbar ready={ready} />
      <div className="relative min-h-0 flex-1">
        {!props.generation ? (
          <EmptyState />
        ) : generating ? (
          <GeneratingState
            modelLabel={MODEL_LABEL[props.model]}
            aspectRatio={props.aspectRatio}
            etaSeconds={props.etaSeconds}
            generationId={props.generationId}
          />
        ) : failed ? (
          <ErrorState
            kind={status === 'failed' ? 'failed' : 'canceled'}
            errorMessage={props.generation.errorMessage ?? null}
            onRetry={props.onRetry}
            canRetry={props.canRetry}
          />
        ) : ready ? (
          <ResultState
            url={props.resolvedOutputUrl!}
            poster={props.resolvedThumbnailUrl}
            aspectRatio={props.aspectRatio}
            modelLabel={MODEL_LABEL[props.model]}
            promptText={props.prompt}
            credits={props.generation.creditsCharged}
            durationSec={props.model.startsWith('veo-') ? props.veoDuration : props.klingDuration}
            resolution={props.model.startsWith('veo-') ? props.veoResolution : null}
          />
        ) : (
          <PreparingState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-[420px] text-center">
        <div className="relative mx-auto mb-[22px] grid size-[88px] place-items-center rounded-[22px] border border-border bg-card">
          <span
            className="pointer-events-none absolute -inset-px rounded-[22px]"
            style={{
              background:
                'conic-gradient(from 0deg, color-mix(in oklch, var(--color-primary) 45%, transparent), transparent 30%, transparent 70%, color-mix(in oklch, var(--color-primary) 45%, transparent))',
              opacity: 0.45,
              animation: 'zyra-orbit 8s linear infinite',
            }}
            aria-hidden
          />
          <VideoIcon className="relative size-7 text-primary" aria-hidden />
        </div>
        <h2 className="font-heading text-[22px] font-medium tracking-tight">
          Describe la escena que quieres animar
        </h2>
        <p className="mt-2.5 text-[13.5px] leading-[1.55] text-muted-foreground">
          Detalla cámara, movimiento y atmósfera. Puedes añadir una imagen de
          referencia para fijar el frame inicial.
        </p>
        <div className="mt-[22px] flex flex-wrap justify-center gap-1.5">
          {SAMPLE_PROMPTS.map((s) => (
            <span
              key={s}
              className="rounded-full border border-border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GeneratingState({
  modelLabel,
  aspectRatio,
  etaSeconds,
  generationId,
}: {
  modelLabel: string;
  aspectRatio: string;
  etaSeconds: number;
  generationId: string | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [canceling, startCancel] = useTransition();
  useEffect(() => {
    const e = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(e);
  }, []);
  const ratio = aspectToRatio(aspectRatio);
  const pct = Math.min(95, (elapsed / Math.max(etaSeconds, 1)) * 100);

  function handleCancel() {
    if (!generationId) return;
    startCancel(async () => {
      const res = await cancelGenerationAction(generationId);
      if (!res.ok) toast.error('No se pudo cancelar');
    });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div
        className="relative overflow-hidden rounded-[18px] border border-border bg-card"
        style={{ width: 'min(72%, 520px)', aspectRatio: String(ratio) }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(105deg, transparent 30%, color-mix(in oklch, var(--color-primary) 12%, transparent) 50%, transparent 70%)',
            backgroundSize: '400px 100%',
            animation: 'zyra-shimmer 1.6s linear infinite',
          }}
          aria-hidden
        />
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative size-16">
            <div className="absolute inset-0 rounded-full border-[1.5px] border-primary/20" aria-hidden />
            <div
              className="absolute inset-0 rounded-full border-[1.5px] border-transparent"
              style={{
                borderTopColor: 'var(--color-primary)',
                animation: 'zyra-orbit 1.2s linear infinite',
              }}
              aria-hidden
            />
            <Sparkles
              className="absolute left-[22px] top-[22px] size-5 text-primary"
              aria-hidden
            />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-muted/40">
          <div
            className="h-full bg-primary transition-[width] duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-6 min-h-[60px] text-center">
        <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-primary">
          <span
            className="size-1.5 rounded-full bg-primary"
            style={{ animation: 'zyra-pulse-glow 1.4s ease infinite' }}
          />
          Generando con {modelLabel}
        </div>
        <RotatingTips tips={ROTATING_TIPS} />
        <div className="mt-2.5 font-mono text-[11.5px] text-muted-foreground/80">
          {String(elapsed).padStart(2, '0')}s · estimado ~{etaSeconds}s
        </div>
      </div>

      <button
        type="button"
        onClick={handleCancel}
        disabled={canceling || !generationId}
        className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
      >
        <XCircle className="size-3.5" aria-hidden />
        {canceling ? 'Cancelando…' : 'Cancelar'}
      </button>
    </div>
  );
}

function PreparingState() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="flex flex-col items-center gap-2.5 text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <p className="text-[13px]">Preparando el video…</p>
        <p className="font-mono text-[11px] text-muted-foreground/70">
          subiendo a Storage
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  kind,
  errorMessage,
  onRetry,
  canRetry,
}: {
  kind: 'failed' | 'canceled';
  errorMessage: string | null;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const isFailed = kind === 'failed';
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-[420px] text-center">
        <div
          className={cn(
            'mx-auto mb-4 grid size-14 place-items-center rounded-2xl border',
            isFailed
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          )}
        >
          <XCircle className="size-6" aria-hidden />
        </div>
        <h3 className="font-heading text-[17px] font-medium text-foreground">
          {isFailed ? 'No se pudo generar el video' : 'Generación cancelada'}
        </h3>
        {errorMessage && (
          <p className="mt-2 font-mono text-[12px] leading-relaxed text-muted-foreground/80">
            {errorMessage}
          </p>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

function ResultState({
  url,
  poster,
  aspectRatio,
  modelLabel,
  promptText,
  credits,
  durationSec,
  resolution,
}: {
  url: string;
  poster: string | null;
  aspectRatio: string;
  modelLabel: string;
  promptText: string;
  credits: number | null;
  durationSec: number;
  resolution: '720p' | '1080p' | null;
}) {
  const [downloading, setDownloading] = useState(false);
  const ratio = aspectToRatio(aspectRatio);

  async function handleDownload() {
    if (!url) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(url, 'zyra-video');
    } catch (e) {
      toast.error(`No se pudo descargar${e instanceof Error ? `: ${e.message}` : ''}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-5">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-[14px] border border-border bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: String(ratio),
            height: ratio < 1 ? '100%' : 'auto',
            width: ratio >= 1 ? '100%' : 'auto',
          }}
        >
          <video
            controls
            autoPlay
            muted
            playsInline
            src={url}
            poster={poster ?? undefined}
            className="block size-full object-contain"
          />
          <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/70 px-2.5 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
            {modelLabel} · {aspectRatio}
            {resolution && ` · ${resolution}`}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] text-foreground">{promptText}</div>
          <div className="mt-1 flex flex-wrap gap-3.5 font-mono text-[11px] text-muted-foreground/80">
            {credits !== null && <span>−{credits} cr.</span>}
            <span>{durationSec}s</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <GhostBtn href="/app/library">
            <Library className="size-3.5" aria-hidden /> Biblioteca
          </GhostBtn>
          <PrimaryGhost onClick={handleDownload} disabled={downloading}>
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}{' '}
            Descargar
          </PrimaryGhost>
        </div>
      </div>
    </div>
  );
}
