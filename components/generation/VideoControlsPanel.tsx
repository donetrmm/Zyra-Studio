'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ModelKey =
  | 'fal-ai/kling-video/v2.6/standard/text-to-video'
  | 'fal-ai/kling-video/v2.6/pro/text-to-video'
  | 'fal-ai/kling-video/v2.6/standard/image-to-video'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-lite-generate-preview';

export type VideoControlsProps = {
  prompt: string;
  setPrompt: (v: string) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;
  model: ModelKey;
  setModel: (v: ModelKey) => void;
  // Kling
  duration: 5 | 10;
  setDuration: (v: 5 | 10) => void;
  // Veo
  veoDuration: 4 | 6 | 8;
  setVeoDuration: (v: 4 | 6 | 8) => void;
  veoResolution: '720p' | '1080p';
  setVeoResolution: (v: '720p' | '1080p') => void;
  // Common
  aspectRatio: '16:9' | '9:16' | '1:1';
  setAspectRatio: (v: '16:9' | '9:16' | '1:1') => void;
  cost: number;
  balance: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export function VideoControlsPanel(props: VideoControlsProps) {
  const isVeo = props.model.startsWith('veo-');

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto border-r border-border bg-card/30 p-5">
      <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
        Crear video
      </h2>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Modelo
      </label>
      <select
        value={props.model}
        onChange={(e) => props.setModel(e.target.value as ModelKey)}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
      >
        <optgroup label="Kling (rápido)">
          <option value="fal-ai/kling-video/v2.6/standard/text-to-video">Kling 2.6 Standard</option>
          <option value="fal-ai/kling-video/v2.6/pro/text-to-video">Kling 2.6 Pro</option>
        </optgroup>
        <optgroup label="Veo 3.1 (premium)">
          <option value="veo-3.1-fast-generate-preview">Veo Fast</option>
          <option value="veo-3.1-generate-preview">Veo Standard</option>
          <option value="veo-3.1-lite-generate-preview">Veo Lite</option>
        </optgroup>
      </select>

      {isVeo ? (
        <>
          <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Duración
          </label>
          <div className="mt-1.5 flex gap-2">
            {([4, 6, 8] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => props.setVeoDuration(d)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
                  props.veoDuration === d
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                )}
              >
                {d}s
              </button>
            ))}
          </div>
          <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Resolución
          </label>
          <div className="mt-1.5 flex gap-2">
            {(['720p', '1080p'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => props.setVeoResolution(r)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
                  props.veoResolution === r
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Duración
          </label>
          <div className="mt-1.5 flex gap-2">
            {([5, 10] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => props.setDuration(d)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
                  props.duration === d
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                )}
              >
                {d}s
              </button>
            ))}
          </div>
        </>
      )}

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Aspect ratio
      </label>
      <div className="mt-1.5 flex gap-2">
        {(isVeo ? (['16:9', '9:16'] as const) : (['16:9', '9:16', '1:1'] as const)).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => props.setAspectRatio(r)}
            className={cn(
              'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
              props.aspectRatio === r
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40',
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <label className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Prompt
      </label>
      <textarea
        value={props.prompt}
        onChange={(e) => props.setPrompt(e.target.value.slice(0, 2000))}
        placeholder="Describe la escena que quieres animar…"
        className="scroll-thin mt-1.5 min-h-[100px] resize-y rounded-md border border-border bg-background p-3 text-[13.5px] text-foreground outline-none"
      />

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Negative prompt (opcional)
      </label>
      <textarea
        value={props.negativePrompt}
        onChange={(e) => props.setNegativePrompt(e.target.value.slice(0, 500))}
        placeholder="Qué evitar…"
        className="scroll-thin mt-1.5 min-h-[50px] resize-y rounded-md border border-border bg-background p-3 text-[12.5px] text-foreground outline-none"
      />

      <div className="mt-6 flex items-center justify-between text-[12.5px]">
        <span className="text-muted-foreground">Costo</span>
        <span className="font-mono text-foreground">−{props.cost} cr</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Saldo</span>
        <span className="font-mono text-muted-foreground">{props.balance} cr</span>
      </div>

      <button
        type="button"
        onClick={props.onGenerate}
        disabled={!props.canGenerate}
        className={cn(
          'mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md text-[13.5px] font-medium transition-colors',
          props.canGenerate
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'cursor-not-allowed bg-muted text-muted-foreground/60',
        )}
      >
        {props.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Generar video
      </button>
    </div>
  );
}
