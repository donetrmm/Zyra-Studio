'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TTS_LANGUAGES, TTS_MODELS } from '@/lib/schemas/audio';

export const OFFICIAL_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', lang: 'en' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', lang: 'en' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', lang: 'en' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', lang: 'multi' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', lang: 'multi' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', lang: 'multi' },
] as const;

export type AudioControlsProps = {
  text: string;
  setText: (v: string) => void;
  voiceId: string;
  setVoiceId: (v: string) => void;
  modelId: (typeof TTS_MODELS)[number];
  setModelId: (v: (typeof TTS_MODELS)[number]) => void;
  languageCode: (typeof TTS_LANGUAGES)[number];
  setLanguageCode: (v: (typeof TTS_LANGUAGES)[number]) => void;
  stability: number;
  setStability: (v: number) => void;
  similarityBoost: number;
  setSimilarityBoost: (v: number) => void;
  style: number;
  setStyle: (v: number) => void;
  cost: number;
  balance: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export function AudioControlsPanel(props: AudioControlsProps) {
  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto border-r border-border bg-card/30 p-5">
      <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
        Texto a voz
      </h2>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Voz
      </label>
      <select
        value={props.voiceId}
        onChange={(e) => props.setVoiceId(e.target.value)}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
      >
        {OFFICIAL_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Modelo
      </label>
      <select
        value={props.modelId}
        onChange={(e) => props.setModelId(e.target.value as (typeof TTS_MODELS)[number])}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
      >
        <option value="eleven_multilingual_v2">Multilingual v2 (alta calidad)</option>
        <option value="eleven_flash_v2_5">Flash v2.5 (rápido)</option>
        <option value="eleven_v3">V3 (expresivo)</option>
      </select>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Idioma (solo Multilingual)
      </label>
      <select
        value={props.languageCode}
        onChange={(e) => props.setLanguageCode(e.target.value as (typeof TTS_LANGUAGES)[number])}
        disabled={props.modelId !== 'eleven_multilingual_v2'}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none disabled:opacity-40"
      >
        {TTS_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <label className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Texto
      </label>
      <textarea
        value={props.text}
        onChange={(e) => props.setText(e.target.value.slice(0, 20000))}
        placeholder="Escribe el texto a sintetizar…"
        className="scroll-thin mt-1.5 min-h-[140px] resize-y rounded-md border border-border bg-background p-3 text-[13.5px] text-foreground outline-none"
      />
      <div className="mt-1 text-right font-mono text-[10.5px] text-muted-foreground/70">
        {props.text.length.toLocaleString('es-MX')} / 20 000
      </div>

      <SliderRow label="Stability" value={props.stability} onChange={props.setStability} />
      <SliderRow label="Similarity Boost" value={props.similarityBoost} onChange={props.setSimilarityBoost} />
      {props.modelId === 'eleven_v3' && (
        <SliderRow label="Style" value={props.style} onChange={props.setStyle} />
      )}

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
        Generar audio
      </button>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>
  );
}
