'use client';

import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Download,
  Library,
  MoreHorizontal,
  Pin,
  Search,
  Shield,
  Sliders,
  Sparkles,
  Square,
} from 'lucide-react';
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
}: {
  pending: boolean;
  result: SessionItem | null;
  providerLabel: string;
  session: SessionItem[];
  onSelect: (item: SessionItem) => void;
  aspectRatio: string;
  promptEcho: string;
  etaSeconds: number;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        background: 'var(--zyra-bg-deep)',
        fontFamily: 'var(--zyra-font-sans)',
        color: 'var(--zyra-text-1)',
      }}
    >
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
    <div
      className="flex h-11 shrink-0 items-center justify-between px-5"
      style={{
        background: 'var(--zyra-bg-1)',
        borderBottom: '1px solid var(--zyra-hairline)',
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="text-[11px] uppercase tracking-[0.08em]"
          style={{ color: 'var(--zyra-text-3)' }}
        >
          Vista previa
        </div>
        {ready && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px]"
            style={{
              background: 'var(--zyra-ok-soft)',
              border: '1px solid rgba(78, 205, 138, 0.2)',
              color: 'var(--zyra-ok)',
            }}
          >
            <span
              className="size-[5px] rounded-full"
              style={{ background: 'var(--zyra-ok)' }}
            />
            Lista
          </span>
        )}
      </div>
      <div className="flex gap-1">
        <ToolbarBtn title="Comparar">
          <Sliders className="size-3.5" aria-hidden />
        </ToolbarBtn>
        <ToolbarBtn title="Buscar en sesión">
          <Search className="size-3.5" aria-hidden />
        </ToolbarBtn>
        <ToolbarBtn title="Más">
          <MoreHorizontal className="size-3.5" aria-hidden />
        </ToolbarBtn>
      </div>
    </div>
  );
}

function ToolbarBtn({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className="grid size-7 place-items-center rounded-[7px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
      style={{ color: 'var(--zyra-text-2)' }}
    >
      {children}
    </button>
  );
}

function aspectToRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return h > 0 ? w / h : 1;
}

function EmptyState() {
  return (
    <div className="zyra-fade-in grid h-full place-items-center p-8">
      <div className="max-w-[420px] text-center">
        <div
          className="relative mx-auto mb-[22px] grid size-[88px] place-items-center rounded-[22px]"
          style={{
            background:
              'radial-gradient(circle at 30% 30%, rgba(123, 97, 255, 0.22), transparent 60%), var(--zyra-bg-2)',
            border: '1px solid var(--zyra-hairline)',
          }}
        >
          <span
            className="pointer-events-none absolute -inset-px rounded-[22px]"
            style={{
              background:
                'conic-gradient(from 0deg, rgba(123, 97, 255, 0.45), transparent 30%, transparent 70%, rgba(123, 97, 255, 0.45))',
              opacity: 0.45,
              animation: 'zyra-orbit 8s linear infinite',
            }}
            aria-hidden
          />
          <Sparkles
            className="relative size-7"
            style={{ color: 'var(--zyra-accent-2)' }}
            aria-hidden
          />
        </div>
        <h2
          className="m-0 text-[22px] font-medium"
          style={{ color: 'var(--zyra-text-1)', letterSpacing: '-0.015em' }}
        >
          Empieza describiendo tu imagen
        </h2>
        <p
          className="mt-2.5 text-[13.5px] leading-[1.55]"
          style={{ color: 'var(--zyra-text-2)' }}
        >
          Cuanto más específico seas con la atmósfera, la luz y los materiales, mejor
          será el resultado. Puedes añadir hasta 11 referencias para guiar el estilo.
        </p>
        <div className="mt-[22px] flex flex-wrap justify-center gap-1.5">
          {SAMPLE_PROMPTS.map((s) => (
            <span
              key={s}
              className="rounded-full px-2.5 py-1.5 text-[11.5px]"
              style={{
                background: 'var(--zyra-bg-2)',
                border: '1px solid var(--zyra-hairline)',
                color: 'var(--zyra-text-2)',
              }}
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
    <div className="zyra-fade-in flex h-full flex-col items-center justify-center p-6">
      <div
        className="relative overflow-hidden rounded-[18px]"
        style={{
          width: 'min(72%, 520px)',
          aspectRatio: String(ratio),
          background: 'var(--zyra-bg-2)',
          border: '1px solid var(--zyra-hairline)',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(105deg, transparent 30%, rgba(123, 97, 255, 0.12) 50%, transparent 70%)',
            backgroundSize: '400px 100%',
            animation: 'zyra-shimmer 1.6s linear infinite',
          }}
          aria-hidden
        />
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative size-16">
            <div
              className="absolute inset-0 rounded-full"
              style={{ border: '1.5px solid rgba(123, 97, 255, 0.18)' }}
              aria-hidden
            />
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: '1.5px solid transparent',
                borderTopColor: 'var(--zyra-accent)',
                animation: 'zyra-orbit 1.2s linear infinite',
              }}
              aria-hidden
            />
            <div
              className="absolute inset-3.5 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(123, 97, 255, 0.4), transparent 70%)',
                filter: 'blur(8px)',
              }}
              aria-hidden
            />
            <Sparkles
              className="absolute left-[22px] top-[22px] size-5"
              style={{ color: 'var(--zyra-accent-2)' }}
              aria-hidden
            />
          </div>
        </div>
        <div
          className="absolute inset-x-0 bottom-0 h-0.5"
          style={{ background: 'rgba(255, 255, 255, 0.04)' }}
        >
          <div
            className="h-full transition-[width] duration-1000"
            style={{
              width: `${pct}%`,
              background: 'var(--zyra-accent)',
              boxShadow: '0 0 12px var(--zyra-accent-glow)',
            }}
          />
        </div>
      </div>

      <div className="mt-6 min-h-[60px] text-center">
        <div
          className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em]"
          style={{ color: 'var(--zyra-accent-2)' }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{
              background: 'var(--zyra-accent)',
              boxShadow: '0 0 8px var(--zyra-accent-glow)',
              animation: 'zyra-pulse-glow 1.4s ease infinite',
            }}
          />
          Generando con {providerLabel}
        </div>
        <div className="relative h-[22px]">
          {ROTATING_TIPS.map((t, i) => (
            <div
              key={t}
              className="absolute inset-x-0 text-sm transition-all duration-[400ms]"
              style={{
                color: 'var(--zyra-text-1)',
                opacity: i === tipIdx ? 1 : 0,
                transform: i === tipIdx ? 'translateY(0)' : 'translateY(6px)',
              }}
            >
              {t}…
            </div>
          ))}
        </div>
        <div
          className="mt-2.5 text-[11.5px]"
          style={{ fontFamily: 'var(--zyra-font-mono)', color: 'var(--zyra-text-3)' }}
        >
          {String(elapsed).padStart(2, '0')}s · estimado ~{etaSeconds}s
        </div>
      </div>

      <button
        type="button"
        className="mt-[22px] inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px]"
        style={{
          background: 'transparent',
          border: '1px solid var(--zyra-hairline-strong)',
          color: 'var(--zyra-text-2)',
        }}
      >
        <Square className="size-3 fill-current" aria-hidden /> Cancelar
      </button>
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
}: {
  result: SessionItem;
  aspectRatio: string;
  providerLabel: string;
  session: SessionItem[];
  onSelect: (item: SessionItem) => void;
  promptEcho: string;
}) {
  const ratio = aspectToRatio(aspectRatio);
  const promptText = result.prompt || promptEcho;
  return (
    <div
      className="zyra-fade-in flex h-full flex-col overflow-hidden"
      style={{ padding: '20px 28px 18px' }}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-[14px]"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: String(ratio),
            height: ratio < 1 ? '100%' : 'auto',
            width: ratio >= 1 ? '100%' : 'auto',
            border: '1px solid var(--zyra-hairline)',
            boxShadow:
              '0 30px 80px -30px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--zyra-hairline)',
            background: 'var(--zyra-bg-2)',
          }}
        >
          {result.outputUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.outputUrl}
              alt={promptText}
              className="block size-full object-contain"
            />
          ) : null}
          <div className="absolute right-3 top-3 flex gap-1.5">
            <FloatingIconBtn title="Pin">
              <Pin className="size-3.5" aria-hidden />
            </FloatingIconBtn>
            <FloatingIconBtn title="Más">
              <MoreHorizontal className="size-3.5" aria-hidden />
            </FloatingIconBtn>
          </div>
          <div
            className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] backdrop-blur"
            style={{
              background: 'rgba(11, 15, 25, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--zyra-text-2)',
              fontFamily: 'var(--zyra-font-mono)',
            }}
          >
            {providerLabel} · {aspectRatio}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[12.5px]"
            style={{ color: 'var(--zyra-text-1)' }}
          >
            {promptText}
          </div>
          <div
            className="mt-1 flex gap-3.5 text-[11px]"
            style={{
              fontFamily: 'var(--zyra-font-mono)',
              color: 'var(--zyra-text-3)',
            }}
          >
            <span>−{result.credits} cr.</span>
            <span>{relativeTime(result.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <GhostBtn>
            <Sparkles className="size-3.5" aria-hidden /> Usar como ref.
          </GhostBtn>
          <GhostBtn href="/app/library">
            <Library className="size-3.5" aria-hidden /> Biblioteca
          </GhostBtn>
          {result.outputUrl && (
            <PrimaryGhost href={result.outputUrl} download>
              <Download className="size-3.5" aria-hidden /> Descargar
            </PrimaryGhost>
          )}
        </div>
      </div>

      {session.length > 0 && (
        <div
          className="mt-3.5 pt-3.5"
          style={{ borderTop: '1px solid var(--zyra-hairline)' }}
        >
          <div className="mb-2.5 flex items-center justify-between">
            <div
              className="text-[11px] uppercase tracking-[0.08em]"
              style={{ color: 'var(--zyra-text-3)' }}
            >
              De esta sesión · {session.length}
            </div>
            <a
              href="/app/library"
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: 'var(--zyra-text-2)' }}
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
                className="relative size-16 shrink-0 overflow-hidden rounded-lg"
                style={{
                  border:
                    item.id === result.id
                      ? '1.5px solid var(--zyra-accent)'
                      : '1.5px solid transparent',
                  background: 'var(--zyra-bg-2)',
                }}
              >
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <span
                    className="grid h-full place-items-center text-[10px]"
                    style={{ color: 'var(--zyra-text-3)' }}
                  >
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

function FloatingIconBtn({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className="grid size-[30px] place-items-center rounded-lg backdrop-blur"
      style={{
        background: 'rgba(11, 15, 25, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#fff',
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  href,
}: {
  children: React.ReactNode;
  href?: string;
}) {
  const className =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium';
  const style: React.CSSProperties = {
    background: 'var(--zyra-bg-2)',
    border: '1px solid var(--zyra-hairline)',
    color: 'var(--zyra-text-1)',
  };
  if (href) {
    return (
      <a href={href} className={className} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} style={style}>
      {children}
    </button>
  );
}

function PrimaryGhost({
  children,
  href,
  download,
}: {
  children: React.ReactNode;
  href?: string;
  download?: boolean;
}) {
  const className =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium';
  const style: React.CSSProperties = {
    background: 'var(--zyra-accent-soft)',
    border: '1px solid var(--zyra-accent-rim)',
    color: 'var(--zyra-text-1)',
  };
  if (href) {
    return (
      <a
        href={href}
        className={className}
        style={style}
        target="_blank"
        rel="noreferrer"
        download={download}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} style={style}>
      {children}
    </button>
  );
}

export function SafetyErrorState({ refunded }: { refunded: number }) {
  return (
    <div className="zyra-fade-in grid h-full place-items-center p-8">
      <div className="max-w-[420px] text-center">
        <div
          className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl"
          style={{
            background: 'rgba(245, 181, 68, 0.10)',
            border: '1px solid rgba(245, 181, 68, 0.25)',
            color: 'var(--zyra-warn)',
          }}
        >
          <Shield className="size-6" aria-hidden />
        </div>
        <h3
          className="m-0 text-[17px] font-medium"
          style={{ color: 'var(--zyra-text-1)' }}
        >
          El contenido no pasó la revisión de seguridad
        </h3>
        <p
          className="mb-4 mt-2 text-[13px] leading-[1.55]"
          style={{ color: 'var(--zyra-text-2)' }}
        >
          El modelo rechazó este prompt. Intenta reformular evitando contenido
          sensible, personas reales o violencia explícita.
        </p>
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
          style={{
            background: 'var(--zyra-ok-soft)',
            border: '1px solid rgba(78, 205, 138, 0.2)',
            color: 'var(--zyra-ok)',
          }}
        >
          <span style={{ fontFamily: 'var(--zyra-font-mono)' }}>+{refunded}</span>{' '}
          créditos devueltos a tu balance
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
