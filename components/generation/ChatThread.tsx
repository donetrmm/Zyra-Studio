'use client';

import { useEffect, useRef } from 'react';
import {
  Coins,
  Download,
  Loader2,
  MessageSquareText,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { SessionItem } from './types';

export function ChatThread({
  thread,
  prompt,
  setPrompt,
  pending,
  cost,
  balance,
  canGenerate,
  onGenerate,
  onExit,
  providerLabel,
}: {
  thread: SessionItem[]; // ordenado más reciente primero
  prompt: string;
  setPrompt: (v: string) => void;
  pending: boolean;
  cost: number;
  balance: number;
  canGenerate: boolean;
  onGenerate: () => void;
  onExit: () => void;
  providerLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll al fondo cuando llega una nueva imagen o cuando empieza a generar
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thread.length, pending]);

  // Auto-resize del textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [prompt]);

  // Orden cronológico para mostrar (más antiguo arriba)
  const ordered = [...thread].reverse();
  const isEmpty = ordered.length === 0 && !pending;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canGenerate) {
      e.preventDefault();
      onGenerate();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-primary">
            <MessageSquareText className="size-3.5" aria-hidden />
          </span>
          <div>
            <h2 className="font-heading text-sm font-semibold">
              Edición conversacional
            </h2>
            <p className="text-xs text-muted-foreground">
              {ordered.length === 0
                ? 'Inicia el hilo generando una imagen'
                : `${ordered.length} ${ordered.length === 1 ? 'iteración' : 'iteraciones'} · ${providerLabel}`}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <X className="size-4" aria-hidden /> Salir del hilo
        </Button>
      </header>

      <div
        ref={scrollRef}
        className="scroll-thin flex-1 overflow-y-auto px-5 py-6"
      >
        {isEmpty ? (
          <EmptyChat />
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-6">
            {ordered.map((item, i) => (
              <ChatTurn key={item.id} item={item} index={i} />
            ))}
            {pending && <PendingTurn />}
          </ol>
        )}
      </div>

      <footer className="shrink-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-5 py-3">
          <div className="rounded-lg border border-border bg-muted/30 p-2.5">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                ordered.length === 0
                  ? 'Describe la imagen inicial del hilo…'
                  : 'Pide un cambio: "quítale el casco", "fondo nocturno"…'
              }
              rows={2}
              maxLength={8000}
              className="resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Coins className="size-3" aria-hidden />
                <span
                  className={cn(
                    'font-medium tabular-nums',
                    cost > balance ? 'text-amber-400' : 'text-foreground',
                  )}
                >
                  {fmt(cost)}
                </span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden truncate sm:inline">{providerLabel}</span>
              </div>
              <Button
                size="sm"
                disabled={!canGenerate}
                onClick={onGenerate}
              >
                {pending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Generando
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" aria-hidden /> Enviar
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Cmd/Ctrl + Enter para enviar
          </p>
        </div>
      </footer>
    </div>
  );
}

function ChatTurn({ item, index }: { item: SessionItem; index: number }) {
  return (
    <li className="flex flex-col gap-3">
      <div className="ml-auto max-w-[85%]">
        <div className="rounded-2xl rounded-tr-sm bg-primary/15 px-4 py-2.5 text-sm">
          {item.prompt}
        </div>
        <div className="mt-1 flex justify-end text-[10px] text-muted-foreground">
          Iteración {index + 1}
        </div>
      </div>
      <div className="mr-auto max-w-[85%]">
        <Card className="overflow-hidden p-0">
          {item.outputUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.outputUrl}
              alt={item.prompt}
              className="block max-h-[60vh] w-full object-contain"
            />
          ) : (
            <Skeleton className="aspect-square w-full" />
          )}
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1 tabular-nums">
              <Coins className="size-2.5" aria-hidden /> {item.credits}
            </span>
            {item.outputUrl && (
              <a
                href={item.outputUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <Download className="size-3" aria-hidden /> Descargar
              </a>
            )}
          </div>
        </Card>
      </div>
    </li>
  );
}

function PendingTurn() {
  return (
    <li className="mr-auto max-w-[85%]">
      <Card className="flex items-center gap-3 p-4">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Aplicando cambio…</p>
          <p className="text-xs text-muted-foreground">
            Nano Banana respeta tu última imagen y aplica solo el ajuste.
          </p>
        </div>
      </Card>
    </li>
  );
}

function EmptyChat() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-dashed border-border bg-muted/30">
        <MessageSquareText className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div>
        <p className="font-heading text-sm font-medium">Sin imágenes aún</p>
        <p className="text-xs text-muted-foreground">
          Escribe el prompt inicial abajo y la primera imagen abrirá el hilo. Después
          puedes pedir cambios en frases cortas.
        </p>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}
