'use client';

import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  Download,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionItem } from './types';

const QUICK_EDITS = [
  'Más luz cálida',
  'Sin fondo',
  'Estilo film grain',
  'Acerca al sujeto',
  'Otra variación',
];

export function ChatThread({
  thread,
  prompt,
  setPrompt,
  pending,
  canGenerate,
  onGenerate,
  onExit,
  providerLabel,
  aspectRatio,
}: {
  thread: SessionItem[];
  prompt: string;
  setPrompt: (v: string) => void;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  onExit: () => void;
  providerLabel: string;
  aspectRatio: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ordered = [...thread].reverse();
  const ratio = aspectToRatio(aspectRatio);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thread.length, pending]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [prompt]);

  function send() {
    if (!canGenerate) return;
    onGenerate();
  }

  function handleQuick(text: string) {
    // flushSync fuerza que el setState del prompt (que vive en el parent) se
    // committee antes de seguir, así send() → onGenerate() del parent lee el
    // prompt actualizado en su buildInput. Sin esto, queueMicrotask corría
    // antes del flush de React y se enviaba el prompt anterior.
    flushSync(() => setPrompt(text));
    send();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ChatHeader providerLabel={providerLabel} count={ordered.length} onExit={onExit} />

      <div
        ref={scrollRef}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-[18px]"
      >
        {ordered.length === 0 ? (
          <EmptyChat />
        ) : (
          <>
            {ordered.map((item, i) => (
              <ConvMessage
                key={item.id}
                item={item}
                isLast={i === ordered.length - 1}
                ratio={ratio}
              />
            ))}
            {pending && <PendingBubble />}
          </>
        )}
      </div>

      <ChatComposer
        value={prompt}
        onChange={setPrompt}
        onSend={send}
        onQuick={handleQuick}
        pending={pending}
        canGenerate={canGenerate}
        textareaRef={textareaRef}
      />
    </div>
  );
}

function ChatHeader({
  providerLabel,
  count,
  onExit,
}: {
  providerLabel: string;
  count: number;
  onExit: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
      <div className="flex items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary">
          <MessageSquareText className="size-3.5" aria-hidden />
        </div>
        <div>
          <div className="text-[13px] font-medium text-foreground">
            Edición conversacional
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            {count === 0
              ? 'Inicia el hilo generando una imagen'
              : `${count} ${count === 1 ? 'iteración' : 'iteraciones'} · ${providerLabel}`}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5">
        <HeaderIconBtn title="Salir del hilo" onClick={onExit}>
          <Plus className="size-3.5 rotate-45" aria-hidden />
        </HeaderIconBtn>
        <HeaderIconBtn title="Más">
          <MoreHorizontal className="size-3.5" aria-hidden />
        </HeaderIconBtn>
      </div>
    </div>
  );
}

function HeaderIconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid size-[30px] place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}

function EmptyChat() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
      <span className="grid size-12 place-items-center rounded-full border border-dashed border-border bg-muted/40 text-muted-foreground/70">
        <MessageSquareText className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-heading text-[14px] font-medium text-foreground">
          Sin imágenes aún
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          Escribe el prompt inicial abajo y la primera imagen abrirá el hilo. Después
          puedes pedir cambios en frases cortas.
        </p>
      </div>
    </div>
  );
}

function ConvMessage({
  item,
  isLast,
  ratio,
}: {
  item: SessionItem;
  isLast: boolean;
  ratio: number;
}) {
  const t = relativeShort(item.createdAt);
  return (
    <>
      <div className="mb-3.5 flex justify-end">
        <div className="max-w-[76%] rounded-[14px] rounded-tr-[4px] border border-primary/40 bg-primary/10 px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-foreground">
          {item.prompt}
          <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground/80">
            {t}
          </div>
        </div>
      </div>

      <div className="mb-[18px] flex gap-2.5">
        <div className="grid size-6 shrink-0 place-items-center rounded-lg border border-border bg-card text-primary">
          <Sparkles className="size-3" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-[12px] font-medium text-foreground">Zyra</span>
            <span className="font-mono text-[10px] text-muted-foreground/80">
              {t} · −{item.credits} cr.
            </span>
          </div>
          {item.outputUrl && (
            <div
              className="relative mb-2 overflow-hidden rounded-xl border border-border bg-muted"
              style={{ width: 220, aspectRatio: String(ratio) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.outputUrl}
                alt={item.prompt}
                className="size-full object-cover"
              />
              {isLast && (
                <div className="absolute right-1.5 top-1.5 flex gap-1">
                  <BubbleChip>
                    <a
                      href={item.outputUrl}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="grid size-full place-items-center"
                    >
                      <Download className="size-3" aria-hidden />
                    </a>
                  </BubbleChip>
                  <BubbleChip>
                    <MoreHorizontal className="size-3" aria-hidden />
                  </BubbleChip>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function BubbleChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid size-[22px] place-items-center rounded-md border border-border/40 bg-background/70 text-foreground backdrop-blur">
      {children}
    </span>
  );
}

function PendingBubble() {
  return (
    <div className="mb-[18px] flex gap-2.5">
      <div className="grid size-6 shrink-0 place-items-center rounded-lg border border-border bg-card text-primary">
        <Loader2 className="size-3 animate-spin" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-foreground">Zyra</span>
          <span className="font-mono text-[10px] text-muted-foreground/80">
            Aplicando cambio…
          </span>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
          Refinando luz, color y composición sobre la última imagen…
        </div>
      </div>
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSend,
  onQuick,
  pending,
  canGenerate,
  textareaRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onQuick: (text: string) => void;
  pending: boolean;
  canGenerate: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="border-t border-border bg-card/50 px-4 py-3 backdrop-blur">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_EDITS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onQuick(q)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
          >
            <Sparkles className="size-2.5" aria-hidden /> {q}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2">
        <button
          type="button"
          title="Adjuntar referencia"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canGenerate) onSend();
            }
          }}
          placeholder="Describe el cambio que quieres…"
          rows={1}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent py-1 text-[13.5px] leading-[1.5] text-foreground outline-none"
          style={{ maxHeight: 140 }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canGenerate}
          className={cn(
            'inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors',
            canGenerate
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'cursor-not-allowed bg-muted/40 text-muted-foreground/60',
          )}
        >
          {pending ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <Send className="size-3" aria-hidden />
          )}
          Editar
        </button>
      </div>
    </div>
  );
}

function aspectToRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return h > 0 ? w / h : 1;
}

function relativeShort(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
