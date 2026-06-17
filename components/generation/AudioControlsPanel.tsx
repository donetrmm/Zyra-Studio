'use client';

import { useEffect, useRef, useState } from 'react';
import { Info, Loader2, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TTS_LANGUAGES, TTS_MODELS } from '@/lib/schemas/audio';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { OFFICIAL_VOICES } from '@/lib/elevenlabs/official-voices';
import { getVoicePreviewAction } from '@/server-actions/voices';
import { CampaignSelector, type SelectedCampaign } from './CampaignSelector';
import { EnhanceButton } from './EnhanceButton';
import { Step } from './Step';
import { CreateModeTabs } from './CreateModeTabs';
import { GenerateBar } from './GenerateBar';
import { MODEL_LABEL, estimateAudioEta } from '@/lib/generation/audio-meta';

export { OFFICIAL_VOICES };

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
  campaign: SelectedCampaign;
  setCampaign: (v: SelectedCampaign) => void;
  cost: number;
  balance: number;
  enhanceCost: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export function AudioControlsPanel(props: AudioControlsProps) {
  const selectedVoice = OFFICIAL_VOICES.find((v) => v.id === props.voiceId);
  const isEnglishOnly = selectedVoice?.lang === 'en';
  const canSelectLanguage = props.modelId === 'eleven_multilingual_v2' && !isEnglishOnly;

  const etaSeconds = estimateAudioEta(props.text, props.modelId);
  const hint = !props.text.trim()
    ? 'Escribe el texto para empezar.'
    : props.cost === 0
      ? 'Selecciona un modelo válido.'
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card/30">
      <div className="border-b border-border/60 px-4 py-2.5">
        <CreateModeTabs />
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-[18px] pb-2">
        <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
          Crear audio
        </h2>

        <Step index={1} title="Elige la voz" subtitle="Catálogo oficial de ElevenLabs">
          <Select value={props.voiceId} onValueChange={props.setVoiceId}>
            <SelectTrigger className="h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OFFICIAL_VOICES.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} ({v.lang})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <VoicePreviewButton voiceId={props.voiceId} />
        </Step>

        <Step index={2} title="Modelo TTS" subtitle="Calidad vs velocidad">
          <Select
            value={props.modelId}
            onValueChange={(v) => props.setModelId(v as (typeof TTS_MODELS)[number])}
          >
            <SelectTrigger className="h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="eleven_multilingual_v2">Multilingual v2 (alta calidad)</SelectItem>
              <SelectItem value="eleven_flash_v2_5">Flash v2.5 (rápido)</SelectItem>
              <SelectItem value="eleven_v3">V3 (expresivo)</SelectItem>
            </SelectContent>
          </Select>
        </Step>

        <Step index={3} title="Idioma">
          {canSelectLanguage ? (
            <Select
              value={props.languageCode}
              onValueChange={(v) => props.setLanguageCode(v as (typeof TTS_LANGUAGES)[number])}
            >
              <SelectTrigger className="h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-muted-foreground/70">
              {isEnglishOnly
                ? 'La voz seleccionada solo habla inglés.'
                : 'Disponible con el modelo Multilingual v2 y una voz multi.'}
            </p>
          )}
        </Step>

        <Step index={4} title="Colección" subtitle="Opcional · agrupa generaciones">
          <CampaignSelector value={props.campaign} onChange={props.setCampaign} />
        </Step>

        <Step
          index={5}
          title="Texto"
          subtitle="Lo que sintetizaremos"
          hint={
            <span
              className={cn(
                'font-mono text-[11px]',
                props.text.length > 18000 ? 'text-amber-400' : 'text-muted-foreground/70',
              )}
            >
              {props.text.length.toLocaleString('es-MX')} / 20.000
            </span>
          }
        >
          <textarea
            value={props.text}
            onChange={(e) => props.setText(e.target.value.slice(0, 20000))}
            placeholder="Escribe el texto a sintetizar…"
            className="scroll-thin min-h-[140px] w-full max-h-[280px] resize-y rounded-[12px] border border-border bg-muted/30 p-3 text-[13.5px] leading-[1.5] text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <div className="mt-1.5">
            <EnhanceButton
              prompt={props.text}
              onAccept={props.setText}
              type="audio"
              cost={props.enhanceCost}
              balance={props.balance}
            />
          </div>
        </Step>

        <Step index={6} title="Afinado avanzado" subtitle="Calibra estabilidad y expresividad">
          <SliderRow
            label="Stability"
            value={props.stability}
            onChange={props.setStability}
            hint="Consistencia tonal. Más bajo = la voz suena más expresiva y con más variación entre frases. Más alto = más estable y predecible, pero puede sonar monótona."
          />
          <SliderRow
            label="Similarity Boost"
            value={props.similarityBoost}
            onChange={props.setSimilarityBoost}
            hint="Qué tanto se apega al timbre de la voz original. Más alto = más fiel; valores muy altos pueden reforzar artefactos si la voz base tenía ruido."
          />
          {props.modelId === 'eleven_v3' && (
            <SliderRow
              label="Style"
              value={props.style}
              onChange={props.setStyle}
              hint="Intensidad emocional añadida sobre la voz. Más alto = más dramático y expresivo, a costa de algo de consistencia. Solo aplica al modelo Eleven v3."
            />
          )}
        </Step>
      </div>

      <GenerateBar
        modelLabel={`${MODEL_LABEL[props.modelId]} · ${selectedVoice?.name ?? 'voz'}`}
        cost={props.cost}
        balance={props.balance}
        etaSeconds={etaSeconds}
        disabled={!props.canGenerate}
        pending={props.pending}
        onClick={props.onGenerate}
        idleLabel="Generar audio"
        pendingLabel="Generando audio…"
        hint={hint}
      />
    </div>
  );
}

// Cache de preview URLs en cliente — sobrevive al unmount del componente
// mientras la pestaña esté abierta. Las URLs son CDN pública de ElevenLabs.
const previewUrlCache = new Map<string, string | null>();

function VoicePreviewButton({ voiceId }: { voiceId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Al cambiar de voz, volver a idle (ajuste de estado durante render).
  const [prevVoiceId, setPrevVoiceId] = useState(voiceId);
  if (prevVoiceId !== voiceId) {
    setPrevVoiceId(voiceId);
    setState('idle');
  }

  // Parar el audio en curso al cambiar de voz o desmontar (sistema externo).
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [voiceId]);

  async function handleClick() {
    if (state === 'loading') return;
    if (state === 'playing') {
      audioRef.current?.pause();
      audioRef.current = null;
      setState('idle');
      return;
    }

    let url = previewUrlCache.get(voiceId);
    if (url === undefined) {
      setState('loading');
      const res = await getVoicePreviewAction(voiceId);
      url = res.ok ? res.data.previewUrl : null;
      previewUrlCache.set(voiceId, url);
    }
    if (!url) {
      setState('idle');
      return;
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    const reset = () => {
      audioRef.current = null;
      setState('idle');
    };
    audio.onended = reset;
    audio.onerror = reset;
    setState('playing');
    audio.play().catch(reset);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={cn(
        'mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      {state === 'loading' ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : state === 'playing' ? (
        <Square className="size-3" aria-hidden />
      ) : (
        <Play className="size-3" aria-hidden />
      )}
      {state === 'playing' ? 'Detener' : 'Escuchar muestra'}
    </button>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          {label}
          {hint && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Información sobre ${label}`}
                  className="grid size-4 place-items-center rounded-full text-muted-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  <Info className="size-3" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[260px] p-2.5 text-[11px] leading-relaxed">
                {hint}
              </PopoverContent>
            </Popover>
          )}
        </span>
        <span className="font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-primary"
      />
    </div>
  );
}
