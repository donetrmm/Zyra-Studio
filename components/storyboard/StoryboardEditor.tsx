'use client';

import { useMemo, useState, useTransition } from 'react';
import { GripVertical, ImageIcon, Loader2, Plus, Trash2, Clapperboard } from 'lucide-react';
import { toast } from 'sonner';
import { submitGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import type { PricingRow } from '@/lib/credits/types';
import { cn } from '@/lib/utils';

type Frame = {
  id: string;
  prompt: string;
  status: 'idle' | 'generating' | 'done' | 'failed';
  thumbnailUrl?: string;
};

function makeFrame(): Frame {
  return { id: crypto.randomUUID(), prompt: '', status: 'idle' };
}

export function StoryboardEditor(props: {
  userId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [name, setName] = useState('Mi Storyboard');
  const [frames, setFrames] = useState<Frame[]>([makeFrame(), makeFrame(), makeFrame(), makeFrame()]);
  const [generating, startGenerate] = useTransition();

  const costPerFrame = useMemo(() => {
    const row = props.pricing.find(
      (p) => p.provider === 'nano-banana' && p.model_id === 'gemini-3-pro-image-preview' && p.variant === '2',
    );
    return row ? Number(row.credits_cost) : 30;
  }, [props.pricing]);

  const validFrames = frames.filter((f) => f.prompt.trim().length > 0);
  const totalCost = validFrames.length * costPerFrame;
  const canGenerate = validFrames.length >= 2 && totalCost <= balance && !generating;

  function updateFrame(id: string, prompt: string) {
    setFrames((fs) => fs.map((f) => (f.id === id ? { ...f, prompt } : f)));
  }

  function removeFrame(id: string) {
    setFrames((fs) => fs.filter((f) => f.id !== id));
  }

  function addFrame() {
    if (frames.length >= 8) return;
    setFrames((fs) => [...fs, makeFrame()]);
  }

  function moveFrame(from: number, to: number) {
    setFrames((fs) => {
      const next = [...fs];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function handleGenerate() {
    if (!canGenerate) return;
    startGenerate(async () => {
      const toGenerate = frames.filter((f) => f.prompt.trim().length > 0);
      setFrames((fs) =>
        fs.map((f) =>
          toGenerate.some((t) => t.id === f.id) ? { ...f, status: 'generating' } : f,
        ),
      );

      for (const frame of toGenerate) {
        try {
          const res = await submitGenerationAction({
            provider: 'nano-banana',
            model: 'nano-pro',
            prompt: frame.prompt,
            aspectRatio: '16:9',
            resolution: '2k',
            conversational: false,
            useGrounding: false,
            hasTextInImage: false,
            references: [],
          });
          setFrames((fs) =>
            fs.map((f) =>
              f.id === frame.id
                ? { ...f, status: res.ok ? 'done' : 'failed' }
                : f,
            ),
          );
        } catch {
          setFrames((fs) =>
            fs.map((f) => (f.id === frame.id ? { ...f, status: 'failed' } : f)),
          );
        }
      }
      toast.success(`${toGenerate.length} frames generados`);
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Storyboard</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Planea una secuencia de frames y genera todas de un golpe
          </p>
        </div>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-[14px] font-medium text-foreground outline-none"
      />

      <div className="mt-6 space-y-3">
        {frames.map((frame, i) => (
          <div
            key={frame.id}
            className={cn(
              'flex items-start gap-3 rounded-xl border bg-card/50 p-4 transition-colors',
              frame.status === 'done'
                ? 'border-emerald-500/30'
                : frame.status === 'failed'
                  ? 'border-red-500/30'
                  : frame.status === 'generating'
                    ? 'border-primary/30'
                    : 'border-border',
            )}
          >
            <div className="flex flex-col items-center gap-1 pt-2">
              <GripVertical className="size-4 text-muted-foreground/40" aria-hidden />
              <span className="font-mono text-[11px] text-muted-foreground/60">{i + 1}</span>
              {frame.status === 'generating' && (
                <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
              )}
              {frame.status === 'done' && (
                <ImageIcon className="size-3.5 text-emerald-400" aria-hidden />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <textarea
                value={frame.prompt}
                onChange={(e) => updateFrame(frame.id, e.target.value)}
                placeholder={`Frame ${i + 1}: describe la escena...`}
                disabled={generating}
                className="w-full resize-none rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none disabled:opacity-50"
                rows={2}
              />
            </div>

            <div className="flex flex-col gap-1 pt-2">
              {i > 0 && (
                <button type="button" onClick={() => moveFrame(i, i - 1)} disabled={generating} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30">
                  ↑
                </button>
              )}
              {i < frames.length - 1 && (
                <button type="button" onClick={() => moveFrame(i, i + 1)} disabled={generating} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30">
                  ↓
                </button>
              )}
              {frames.length > 2 && (
                <button type="button" onClick={() => removeFrame(frame.id)} disabled={generating} className="mt-1 text-muted-foreground/50 hover:text-destructive disabled:opacity-30">
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
          </div>
        ))}

        {frames.length < 8 && (
          <button
            type="button"
            onClick={addFrame}
            disabled={generating}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-4 text-[13px] text-muted-foreground transition-colors hover:border-muted-foreground/40 disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />
            Agregar frame (max 8)
          </button>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-card/30 px-5 py-3">
        <div className="text-[13px]">
          <span className="text-muted-foreground">{validFrames.length} frames</span>
          <span className="mx-2 text-muted-foreground/40">·</span>
          <span className="font-mono text-foreground">-{totalCost} cr</span>
          <span className="ml-2 font-mono text-[11px] text-muted-foreground/60">
            (saldo: {balance} cr)
          </span>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-5 py-2 text-[13px] font-medium transition-colors',
            canGenerate
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'cursor-not-allowed bg-muted text-muted-foreground/60',
          )}
        >
          {generating && <Loader2 className="size-4 animate-spin" />}
          <Clapperboard className="size-4" aria-hidden />
          Generar storyboard
        </button>
      </div>
    </div>
  );
}
