'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  ChevronRight,
  Download,
  Library,
  Loader2,
  Maximize2,
  Shield,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { Lightbox } from './Lightbox';
import type { SessionItem } from './types';

const ROTATING_TIPS = [
  'Construyendo composición y encuadre',
  'Refinando luz y materiales',
  'Aplicando estilo y textura',
  'Equilibrando color y contraste',
];

const SAMPLE_PROMPTS = [
  'Retrato editorial luz suave',
  'Producto sobre mármol',
  'Paisaje cinemático al atardecer',
];

export function PreviewArea({
  pending,
  result,
  providerLabel,
  session,
  onSelect,
  aspectRatio,
  promptEcho,
  etaSeconds,
  onUseAsReference,
  canAddReference,
}: {
  pending: boolean;
  result: SessionItem | null;
  providerLabel: string;
  session: SessionItem[];
  onSelect: (item: SessionItem) => void;
  aspectRatio: string;
  promptEcho: string;
  etaSeconds: number;
  onUseAsReference: (item: SessionItem) => Promise<void>;
  canAddReference: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PreviewToolbar ready={!pending && !!result} />
      <div className="relative min-h-0 flex-1">
        {pending ? (
          <GeneratingState
            aspectRatio={aspectRatio}
            providerLabel={providerLabel}
            etaSeconds={etaSeconds}
          />
        ) : result ? (
          <ResultState
            result={result}
            aspectRatio={aspectRatio}
            providerLabel={providerLabel}
            session={session}
            onSelect={onSelect}
            promptEcho={promptEcho}
            onUseAsReference={onUseAsReference}
            canAddReference={canAddReference}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function PreviewToolbar({ ready }: { ready: boolean }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card px-5">
      <div className="flex items-center gap-2">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          Vista previa
        </div>
        {ready && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] text-emerald-400">
            <span className="size-[5px] rounded-full bg-emerald-400" />
            Lista
          </span>
        )}
      </div>
    </div>
  );
}

function aspectToRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return h > 0 ? w / h : 1;
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
          <Sparkles className="relative size-7 text-primary" aria-hidden />
        </div>
        <h2 className="font-heading text-[22px] font-medium tracking-tight">
          Empieza describiendo tu imagen
        </h2>
        <p className="mt-2.5 text-[13.5px] leading-[1.55] text-muted-foreground">
          Cuanto más específico seas con la atmósfera, la luz y los materiales, mejor
          será el resultado. Puedes añadir hasta 11 referencias para guiar el estilo.
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
  aspectRatio,
  providerLabel,
  etaSeconds,
}: {
  aspectRatio: string;
  providerLabel: string;
  etaSeconds: number;
}) {
  const [tipIdx, setTipIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setTipIdx((i) => (i + 1) % ROTATING_TIPS.length),
      2400,
    );
    const e = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(e);
    };
  }, []);
  const ratio = aspectToRatio(aspectRatio);
  const pct = Math.min(95, (elapsed / Math.max(etaSeconds, 1)) * 100);

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
            <div
              className="absolute inset-0 rounded-full border-[1.5px] border-primary/20"
              aria-hidden
            />
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
          Generando con {providerLabel}
        </div>
        <div className="relative h-[22px]">
          {ROTATING_TIPS.map((t, i) => (
            <div
              key={t}
              className="absolute inset-x-0 text-sm text-foreground transition-all duration-[400ms]"
              style={{
                opacity: i === tipIdx ? 1 : 0,
                transform: i === tipIdx ? 'translateY(0)' : 'translateY(6px)',
              }}
            >
              {t}…
            </div>
          ))}
        </div>
        <div className="mt-2.5 font-mono text-[11.5px] text-muted-foreground/80">
          {String(elapsed).padStart(2, '0')}s · estimado ~{etaSeconds}s
        </div>
      </div>
    </div>
  );
}

function ResultState({
  result,
  aspectRatio,
  providerLabel,
  session,
  onSelect,
  promptEcho,
  onUseAsReference,
  canAddReference,
}: {
  result: SessionItem;
  aspectRatio: string;
  providerLabel: string;
  session: SessionItem[];
  onSelect: (item: SessionItem) => void;
  promptEcho: string;
  onUseAsReference: (item: SessionItem) => Promise<void>;
  canAddReference: boolean;
}) {
  const ratio = aspectToRatio(aspectRatio);
  const promptText = result.prompt || promptEcho;
  const [downloading, setDownloading] = useState(false);
  const [adding, startAdd] = useTransition();
  const [lightbox, setLightbox] = useState(false);

  // ESC cierra el lightbox.
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightbox(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  async function handleDownload() {
    if (!result.outputUrl) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(result.outputUrl, `zyra-${result.id.slice(0, 8)}`);
    } catch (e) {
      toast.error(
        `No se pudo descargar la imagen${e instanceof Error ? `: ${e.message}` : ''}`,
      );
    } finally {
      setDownloading(false);
    }
  }

  function handleUseAsReference() {
    if (!canAddReference || adding) return;
    startAdd(async () => {
      await onUseAsReference(result);
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-5">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: String(ratio),
            height: ratio < 1 ? '100%' : 'auto',
            width: ratio >= 1 ? '100%' : 'auto',
          }}
        >
          {result.outputUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.outputUrl}
              alt={promptText}
              onDoubleClick={() => setLightbox(true)}
              className="block size-full cursor-zoom-in object-contain"
            />
          )}
          {result.outputUrl && (
            <button
              type="button"
              onClick={() => setLightbox(true)}
              title="Ver en grande"
              className="absolute right-3 top-3 grid size-[30px] place-items-center rounded-lg border border-border/40 bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90"
            >
              <Maximize2 className="size-3.5" aria-hidden />
            </button>
          )}
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/70 px-2.5 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
            {providerLabel} · {aspectRatio}
          </div>
        </div>
      </div>

      {lightbox && result.outputUrl && (
        <Lightbox src={result.outputUrl} alt={promptText} onClose={() => setLightbox(false)} />
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] text-foreground">{promptText}</div>
          <div className="mt-1 flex gap-3.5 font-mono text-[11px] text-muted-foreground/80">
            <span>−{result.credits} cr.</span>
            <span>{relativeTime(result.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <GhostBtn
            onClick={() => setLightbox(true)}
            disabled={!result.outputUrl}
            title="Abrir en grande (doble-click sobre la imagen)"
          >
            <Maximize2 className="size-3.5" aria-hidden /> Ver en grande
          </GhostBtn>
          <GhostBtn
            onClick={handleUseAsReference}
            disabled={!canAddReference || adding}
            title={
              !canAddReference
                ? 'Alcanzaste el máximo de referencias'
                : 'Usar como referencia'
            }
          >
            {adding ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}{' '}
            Usar como ref.
          </GhostBtn>
          <GhostBtn href="/app/library">
            <Library className="size-3.5" aria-hidden /> Biblioteca
          </GhostBtn>
          {result.outputUrl && (
            <PrimaryGhost onClick={handleDownload} disabled={downloading}>
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="size-3.5" aria-hidden />
              )}{' '}
              Descargar
            </PrimaryGhost>
          )}
        </div>
      </div>

      {session.length > 0 && (
        <div className="mt-3.5 border-t border-border pt-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
              De esta sesión · {session.length}
            </div>
            <a
              href="/app/library"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Ver biblioteca <ChevronRight className="size-3" aria-hidden />
            </a>
          </div>
          <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
            {session.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  'relative size-16 shrink-0 overflow-hidden rounded-lg border bg-muted transition-colors',
                  item.id === result.id ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30',
                )}
              >
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="grid h-full place-items-center text-[10px] text-muted-foreground/70">
                    …
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GhostBtn({
  children,
  href,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors';
  const className = cn(
    base,
    disabled
      ? 'cursor-not-allowed opacity-50'
      : 'hover:border-muted-foreground/30',
  );
  if (href) {
    return (
      <a href={href} className={className} title={title}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function PrimaryGhost({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = cn(
    'inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors',
    disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary/15',
  );
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function SafetyErrorState({ refunded }: { refunded: number }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-[420px] text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <Shield className="size-6" aria-hidden />
        </div>
        <h3 className="font-heading text-[17px] font-medium text-foreground">
          El contenido no pasó la revisión de seguridad
        </h3>
        <p className="mb-4 mt-2 text-[13px] leading-[1.55] text-muted-foreground">
          El modelo rechazó este prompt. Intenta reformular evitando contenido
          sensible, personas reales o violencia explícita.
        </p>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-400">
          <span className="font-mono">+{refunded}</span> créditos devueltos a tu balance
        </div>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.floor(m / 60)}h`;
}
