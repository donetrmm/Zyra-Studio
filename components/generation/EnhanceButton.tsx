'use client';

import { useRef, useState, useTransition } from 'react';
import { Loader2, Sparkles, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { enhancePromptAction } from '@/server-actions/prompt-enhancer';
import { cn } from '@/lib/utils';

export function EnhanceButton({
  prompt,
  onAccept,
  type,
  cost,
  balance,
}: {
  prompt: string;
  onAccept: (enhanced: string) => void;
  type: 'image' | 'video' | 'audio';
  cost: number;
  balance: number;
}) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [enhancing, startEnhance] = useTransition();
  const inFlight = useRef(false);

  const canEnhance = prompt.trim().length >= 3 && !enhancing && balance >= cost;

  function handleEnhance() {
    if (!canEnhance || inFlight.current) return;
    inFlight.current = true;
    startEnhance(async () => {
      const res = await enhancePromptAction({ prompt, type });
      inFlight.current = false;
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? `Necesitas ${cost} créditos`
            : res.message || 'No se pudo mejorar',
        );
        return;
      }
      setSuggestion(res.enhanced);
    });
  }

  if (suggestion) {
    return (
      <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center justify-between text-[11px] font-medium text-primary">
          <span className="flex items-center gap-1">
            <Sparkles className="size-3" aria-hidden />
            Sugerencia
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">-{cost} cr</span>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground">{suggestion}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              onAccept(suggestion);
              setSuggestion(null);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Check className="size-3" aria-hidden />
            Aceptar
          </button>
          <button
            type="button"
            onClick={() => setSuggestion(null)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
            Descartar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleEnhance}
      disabled={!canEnhance}
      title={
        prompt.trim().length < 3
          ? 'Escribe al menos 3 caracteres'
          : balance < cost
            ? `Necesitas ${cost} créditos`
            : `Mejorar prompt con IA · -${cost} cr`
      }
      className={cn(
        'mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors',
        canEnhance
          ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
          : 'cursor-not-allowed text-muted-foreground/40',
      )}
    >
      {enhancing ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-3" aria-hidden />
      )}
      Mejorar con IA
      <span className="font-mono text-[11px] opacity-70">-{cost} cr</span>
    </button>
  );
}
