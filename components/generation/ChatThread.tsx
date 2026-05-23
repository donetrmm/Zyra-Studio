'use client';

import { useEffect, useRef } from 'react';
import {
  Download,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
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
  thread: SessionItem[]; // más reciente primero
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
    setPrompt(text);
    queueMicrotask(send);
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        background: 'var(--zyra-bg-deep)',
        fontFamily: 'var(--zyra-font-sans)',
        color: 'var(--zyra-text-1)',
      }}
    >
      <ChatHeader providerLabel={providerLabel} count={ordered.length} onExit={onExit} />

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-[18px]">
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
    <div
      className="flex items-center justify-between px-5 py-3.5"
      style={{ borderBottom: '1px solid var(--zyra-hairline)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="grid size-7 place-items-center rounded-[9px]"
          style={{
            background: 'var(--zyra-accent-soft)',
            border: '1px solid var(--zyra-accent-rim)',
            color: 'var(--zyra-accent-2)',
          }}
        >
          <MessageSquareText className="size-3.5" aria-hidden />
        </div>
        <div>
          <div className="text-[13px] font-medium" style={{ color: 'var(--zyra-text-1)' }}>
            Edición conversacional
          </div>
          <div className="text-[11px]" style={{ color: 'var(--zyra-text-3)' }}>
            {count === 0
              ? 'Inicia el hilo generando una imagen'
              : `${count} ${count === 1 ? 'iteración' : 'iteraciones'} · ${providerLabel}`}
          </div>
        </div>
      </div>
      <div className="flex gap-1.5">
        <HeaderIconBtn title="Nueva conversación" onClick={onExit}>
          <Plus className="size-3.5" aria-hidden />
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
      className="grid size-[30px] place-items-center rounded-lg"
      style={{
        background: 'var(--zyra-bg-2)',
        border: '1px solid var(--zyra-hairline)',
        color: 'var(--zyra-text-2)',
      }}
    >
      {children}
    </button>
  );
}

function EmptyChat() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 text-center">
      <span
        className="grid size-12 place-items-center rounded-full"
        style={{
          border: '1px dashed var(--zyra-hairline-strong)',
          background: 'var(--zyra-bg-2)',
          color: 'var(--zyra-text-3)',
        }}
      >
        <MessageSquareText className="size-5" aria-hidden />
      </span>
      <div>
        <p
          className="text-[14px] font-medium"
          style={{ color: 'var(--zyra-text-1)' }}
        >
          Sin imágenes aún
        </p>
        <p
          className="mt-1 text-[12.5px]"
          style={{ color: 'var(--zyra-text-2)', lineHeight: 1.5 }}
        >
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
      <div className="zyra-fade-up mb-3.5 flex justify-end">
        <div
          className="max-w-[76%] rounded-[14px] rounded-tr-[4px] px-3.5 py-2.5 text-[13.5px] leading-[1.5]"
          style={{
            background: 'var(--zyra-accent-soft)',
            border: '1px solid var(--zyra-accent-rim)',
            color: 'var(--zyra-text-1)',
          }}
        >
          {item.prompt}
          <div
            className="mt-1 text-right text-[10px]"
            style={{ fontFamily: 'var(--zyra-font-mono)', color: 'var(--zyra-text-3)' }}
          >
            {t}
          </div>
        </div>
      </div>

      <div className="zyra-fade-up mb-[18px] flex gap-2.5">
        <div
          className="grid size-6 shrink-0 place-items-center rounded-lg"
          style={{
            background:
              'radial-gradient(circle at 30% 30%, rgba(123, 97, 255, 0.4), transparent 60%), var(--zyra-bg-3)',
            border: '1px solid var(--zyra-hairline)',
            color: 'var(--zyra-accent-2)',
          }}
        >
          <Sparkles className="size-3" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span
              className="text-[12px] font-medium"
              style={{ color: 'var(--zyra-text-1)' }}
            >
              Zyra
            </span>
            <span
              className="text-[10px]"
              style={{
                fontFamily: 'var(--zyra-font-mono)',
                color: 'var(--zyra-text-3)',
              }}
            >
              {t} · −{item.credits} cr.
            </span>
          </div>
          {item.outputUrl && (
            <div
              className="relative mb-2 overflow-hidden rounded-xl"
              style={{
                width: 220,
                aspectRatio: String(ratio),
                border: '1px solid var(--zyra-hairline)',
                background: 'var(--zyra-bg-2)',
              }}
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
    <span
      className="grid size-[22px] place-items-center rounded-md backdrop-blur"
      style={{
        background: 'rgba(11, 15, 25, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#fff',
      }}
    >
      {children}
    </span>
  );
}

function PendingBubble() {
  return (
    <div className="zyra-fade-up mb-[18px] flex gap-2.5">
      <div
        className="grid size-6 shrink-0 place-items-center rounded-lg"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(123, 97, 255, 0.4), transparent 60%), var(--zyra-bg-3)',
          border: '1px solid var(--zyra-hairline)',
          color: 'var(--zyra-accent-2)',
        }}
      >
        <Loader2 className="size-3 animate-spin" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span
            className="text-[12px] font-medium"
            style={{ color: 'var(--zyra-text-1)' }}
          >
            Zyra
          </span>
          <span
            className="text-[10px]"
            style={{
              fontFamily: 'var(--zyra-font-mono)',
              color: 'var(--zyra-text-3)',
            }}
          >
            Aplicando cambio…
          </span>
        </div>
        <div
          className="rounded-xl px-3 py-2 text-[12.5px]"
          style={{
            background: 'var(--zyra-bg-2)',
            border: '1px solid var(--zyra-hairline)',
            color: 'var(--zyra-text-2)',
          }}
        >
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
    <div
      style={{
        padding: '10px 16px 14px',
        borderTop: '1px solid var(--zyra-hairline)',
        background:
          'linear-gradient(to top, var(--zyra-bg-deep), rgba(11, 15, 25, 0.5))',
      }}
    >
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_EDITS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onQuick(q)}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]"
            style={{
              background: 'var(--zyra-bg-2)',
              border: '1px solid var(--zyra-hairline)',
              color: 'var(--zyra-text-2)',
            }}
          >
            <Sparkles className="size-2.5" aria-hidden /> {q}
          </button>
        ))}
      </div>
      <div
        className="flex items-end gap-2 rounded-xl"
        style={{
          padding: '8px 8px 8px 12px',
          background: 'var(--zyra-bg-2)',
          border: '1px solid var(--zyra-hairline)',
        }}
      >
        <button
          type="button"
          title="Adjuntar referencia"
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{ color: 'var(--zyra-text-2)' }}
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
          className="min-w-0 flex-1 resize-none border-0 bg-transparent py-1 outline-none"
          style={{
            color: 'var(--zyra-text-1)',
            fontSize: 13.5,
            lineHeight: 1.5,
            maxHeight: 140,
          }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canGenerate}
          className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors"
          style={{
            background: canGenerate
              ? 'var(--zyra-accent)'
              : 'rgba(255, 255, 255, 0.06)',
            color: canGenerate ? '#fff' : 'var(--zyra-text-3)',
            boxShadow: canGenerate
              ? '0 0 16px -2px var(--zyra-accent-glow)'
              : 'none',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
          }}
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
