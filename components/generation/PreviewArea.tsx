'use client';

import { useEffect, useState } from 'react';
import { Coins, Download, ImagePlus, Loader2, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SessionItem } from './types';

const PENDING_HINTS = [
  'Encuadrando la composición…',
  'Aplicando iluminación y color…',
  'Refinando detalles finos…',
  'Casi listo…',
];

export function PreviewArea({
  pending,
  result,
  providerLabel,
  session,
  onSelect,
}: {
  pending: boolean;
  result: SessionItem | null;
  providerLabel: string;
  session: SessionItem[];
  onSelect: (item: SessionItem) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {pending ? (
        <PendingCard providerLabel={providerLabel} />
      ) : result ? (
        <ResultCard result={result} />
      ) : (
        <EmptyCard />
      )}
      {session.length > 0 && (
        <SessionStrip session={session} active={result?.id ?? null} onSelect={onSelect} />
      )}
    </div>
  );
}

function ResultCard({ result }: { result: SessionItem }) {
  return (
    <Card className="flex flex-1 flex-col overflow-hidden p-0">
      <div className="flex flex-1 items-center justify-center bg-muted/40 p-2">
        {result.outputUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.outputUrl}
            alt={result.prompt}
            className="max-h-full max-w-full rounded-md object-contain"
          />
        ) : (
          <Skeleton className="aspect-video w-full" />
        )}
      </div>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline">{result.model}</Badge>
          <Badge variant="outline" className="gap-1">
            <Coins className="size-3" aria-hidden /> {fmt(result.credits)}
          </Badge>
          <span className="text-muted-foreground">{relativeTime(result.createdAt)}</span>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{result.prompt}</p>
        <div className="flex gap-2">
          {result.outputUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={result.outputUrl} download target="_blank" rel="noreferrer">
                <Download className="size-4" aria-hidden /> Descargar
              </a>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <a href="/app/library">
              <ImagePlus className="size-4" aria-hidden /> Ver biblioteca
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PendingCard({ providerLabel }: { providerLabel: string }) {
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setHintIdx((i) => (i + 1) % PENDING_HINTS.length);
    }, 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className="flex flex-1 flex-col items-center justify-center gap-5 p-10">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" aria-hidden />
        <span className="relative flex size-14 items-center justify-center rounded-full bg-primary/15">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        </span>
      </div>
      <div className="space-y-1 text-center">
        <p className="font-heading text-base font-semibold">Generando con {providerLabel}</p>
        <p className="text-sm text-muted-foreground transition-opacity duration-300">
          {PENDING_HINTS[hintIdx]}
        </p>
      </div>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[indeterminate_1.6s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
    </Card>
  );
}

function EmptyCard() {
  return (
    <Card className="flex flex-1 flex-col items-center justify-center gap-4 border-dashed p-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-dashed border-border bg-muted/30">
        <Wand2 className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-heading text-base font-semibold">Lista para crear</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Describe la imagen, ajusta el modelo y los parámetros, y presiona Generar.
        </p>
      </div>
    </Card>
  );
}

function SessionStrip({
  session,
  active,
  onSelect,
}: {
  session: SessionItem[];
  active: string | null;
  onSelect: (item: SessionItem) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Esta sesión ({session.length})
      </p>
      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {session.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className={cn(
              'size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary/60',
              active === item.id && 'border-primary',
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
              <span className="text-xs text-muted-foreground">…</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.floor(m / 60)}h`;
}
