'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ImageIcon, Loader2, MapPin, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { generatePanelAction, refinePanelAction, setStoryboardLocationAction, setBeatAudioAction } from '@/server-actions/storyboard';
import type { StoryboardBeat } from '@/lib/campaigns/storyboard-types';
import { extractDialogue, estimateSpeechSeconds, fitVerdict, countWords } from '@/lib/campaigns/speech-fit';

const ERROR_MESSAGES: Record<string, string> = {
  insufficient_credits: 'No tienes créditos suficientes',
  no_panel: 'Genera el panel primero',
  not_found: 'No encontrado',
};

function friendlyError(error: string, message?: string): string {
  return ERROR_MESSAGES[error] ?? message ?? error;
}

type PanelState =
  | { status: 'idle'; panelUrl: string | null }
  | { status: 'generating' }
  | { status: 'error'; message: string };

type Props = {
  campaignId: string;
  campaignName: string;
  beats: StoryboardBeat[];
  locations: { id: string; name: string }[];
  currentLocationId: string | null;
  language: 'es' | 'en';
};

export function StoryboardView({ campaignId, campaignName, beats, locations, currentLocationId, language }: Props) {
  const router = useRouter();
  const [savingLocation, setSavingLocation] = useState(false);

  async function handleSetLocation(locationId: string | null) {
    setSavingLocation(true);
    const res = await setStoryboardLocationAction(campaignId, locationId);
    setSavingLocation(false);
    if (res.ok) {
      toast.success(locationId ? 'Locación anclada al storyboard' : 'Locación quitada');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  // Estado local por beat: refleja URL y estado de generación sin necesitar Realtime.
  const [panelStates, setPanelStates] = useState<Record<string, PanelState>>(() => {
    const init: Record<string, PanelState> = {};
    for (const b of beats) {
      init[b.id] = { status: 'idle', panelUrl: b.panelUrl };
    }
    return init;
  });

  // Input de refinado por beat
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [refining, setRefining] = useState<string | null>(null);

  // Genera todos los paneles faltantes de forma secuencial
  const [generatingAll, setGeneratingAll] = useState(false);

  // Estado del editor de audio por beat
  const [audioDraft, setAudioDraft] = useState<Record<string, { dialogue: string; durationS: number }>>(() => {
    const init: Record<string, { dialogue: string; durationS: number }> = {};
    for (const b of beats) init[b.id] = { dialogue: extractDialogue(b.scenePrompt), durationS: b.durationS };
    return init;
  });
  const [savingAudio, setSavingAudio] = useState<string | null>(null);

  async function handleSaveAudio(beatId: string) {
    const draft = audioDraft[beatId];
    if (!draft) return;
    setSavingAudio(beatId);
    const res = await setBeatAudioAction(beatId, draft.dialogue, draft.durationS);
    setSavingAudio(null);
    if (res.ok) {
      toast.success('Audio guardado · regenera el video para aplicarlo');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  const withoutPanel = beats.filter((b) => {
    const s = panelStates[b.id];
    return s?.status === 'idle' && s.panelUrl === null;
  });

  async function handleGenerateAll() {
    setGeneratingAll(true);
    for (const beat of withoutPanel) {
      setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'generating' } }));
      const res = await generatePanelAction(beat.id);
      if (res.ok) {
        // La acción ya hizo revalidatePath; refrescamos estado local con la URL
        // del servidor vía router.refresh(). Mientras, marcamos idle sin URL
        // para que el refresh la traiga.
        setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'idle', panelUrl: null } }));
        router.refresh();
      } else {
        const msg = friendlyError(res.error, res.message);
        setPanelStates((prev) => ({
          ...prev,
          [beat.id]: { status: 'error', message: msg },
        }));
        toast.error(`Panel ${beat.sceneIndex + 1}: ${msg}`);
      }
    }
    setGeneratingAll(false);
  }

  async function handleRegenerate(beatId: string) {
    setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'generating' } }));
    const res = await generatePanelAction(beatId);
    if (res.ok) {
      setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'idle', panelUrl: null } }));
      router.refresh();
    } else {
      const msg = friendlyError(res.error, res.message);
      setPanelStates((prev) => ({
        ...prev,
        [beatId]: { status: 'error', message: msg },
      }));
      toast.error(msg);
    }
  }

  async function handleRefine(beatId: string) {
    const instruction = (instructions[beatId] ?? '').trim();
    if (!instruction) {
      toast.error('Escribe una instrucción antes de refinar');
      return;
    }
    setRefining(beatId);
    const res = await refinePanelAction(beatId, instruction);
    setRefining(null);
    if (res.ok) {
      setInstructions((prev) => ({ ...prev, [beatId]: '' }));
      setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'idle', panelUrl: null } }));
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/app/campaigns/${campaignId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {campaignName}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Storyboard</h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {beats.length} escenas
            {withoutPanel.length > 0 && ` · ${withoutPanel.length} sin panel`}
          </p>
        </div>
        {withoutPanel.length > 0 && (
          <button
            type="button"
            disabled={generatingAll}
            onClick={handleGenerateAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {generatingAll ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            Generar storyboard
          </button>
        )}
      </div>

      {locations.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2">
          <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-[12px] text-muted-foreground">Locación de la escena:</span>
          <select
            value={currentLocationId ?? ''}
            disabled={savingLocation}
            onChange={(e) => void handleSetLocation(e.target.value === '' ? null : e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary disabled:opacity-50"
          >
            <option value="">Sin locación</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground/60">
            ancla el lugar en cada panel; regenera para aplicarla
          </span>
        </div>
      )}

      {beats.length === 0 ? (
        <div className="mt-12 rounded-xl border border-border bg-card/50 p-8 text-center">
          <p className="text-[14px] text-foreground/70">Esta campaña no tiene escenas</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Agrega creativos en el plan para generar paneles de storyboard.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {beats.map((beat) => {
            const state = panelStates[beat.id] ?? { status: 'idle', panelUrl: beat.panelUrl };
            const isGenerating = state.status === 'generating';
            const isRefining = refining === beat.id;
            const panelUrl = state.status === 'idle' ? state.panelUrl : null;
            const hasError = state.status === 'error';
            const instruction = instructions[beat.id] ?? '';

            return (
              <div key={beat.id} className="flex flex-col gap-2">
                {/* Panel image */}
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-muted/20">
                  {isGenerating || isRefining ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="size-6 animate-spin" aria-hidden />
                      <span className="text-[11px]">generando…</span>
                    </div>
                  ) : panelUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={panelUrl}
                      alt={`Panel ${beat.sceneIndex + 1}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/40">
                      <ImageIcon className="size-8" aria-hidden />
                      <span className="px-2 text-center text-[11px]">
                        {hasError ? (state as { status: 'error'; message: string }).message : 'Sin panel'}
                      </span>
                    </div>
                  )}

                  {/* Scene index badge */}
                  <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/80">
                    {beat.sceneIndex + 1}
                  </div>
                </div>

                {/* Prompt preview */}
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground/70">
                  {beat.scenePrompt}
                </p>

                {/* Regenerar */}
                <button
                  type="button"
                  disabled={isGenerating || isRefining || generatingAll}
                  onClick={() => handleRegenerate(beat.id)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <RefreshCw className="size-3" aria-hidden />
                  Regenerar
                </button>

                {/* Refinar */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={instruction}
                    onChange={(e) =>
                      setInstructions((prev) => ({ ...prev, [beat.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleRefine(beat.id);
                      }
                    }}
                    placeholder="Instrucción…"
                    disabled={isGenerating || isRefining || generatingAll || !panelUrl}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
                  />
                  <button
                    type="button"
                    disabled={isGenerating || isRefining || generatingAll || !panelUrl || !instruction.trim()}
                    onClick={() => void handleRefine(beat.id)}
                    className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {isRefining ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Refinar'}
                  </button>
                </div>

                {/* Audio: diálogo + duración + medidor de holgura */}
                {(() => {
                  const draft = audioDraft[beat.id] ?? { dialogue: extractDialogue(beat.scenePrompt), durationS: beat.durationS };
                  const words = countWords(draft.dialogue);
                  const needed = estimateSpeechSeconds(draft.dialogue, language);
                  const { level, suggestedDurationS } = fitVerdict(needed, draft.durationS);
                  const meter =
                    words === 0
                      ? { text: 'Sin diálogo', cls: 'text-muted-foreground/60' }
                      : level === 'roomy'
                        ? { text: 'Holgado (natural)', cls: 'text-emerald-500' }
                        : level === 'ok'
                          ? { text: 'Justo', cls: 'text-amber-500' }
                          : {
                              text: `Muy ajustado: ~${needed.toFixed(1)}s para ${words} palabras · sube a ${suggestedDurationS}s o acorta`,
                              cls: 'text-red-500',
                            };
                  return (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/40 p-2">
                      <textarea
                        value={draft.dialogue}
                        onChange={(e) =>
                          setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, dialogue: e.target.value } }))
                        }
                        placeholder="Diálogo (vacío = sin voz)"
                        rows={2}
                        className="min-w-0 resize-none rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary"
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-muted-foreground">Duración</label>
                        <input
                          type="number"
                          min={4}
                          max={15}
                          value={draft.durationS}
                          onChange={(e) => {
                            const v = Math.min(15, Math.max(4, Math.round(Number(e.target.value) || 4)));
                            setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, durationS: v } }));
                          }}
                          className="w-16 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary"
                        />
                        <span className="text-[11px]">s</span>
                      </div>
                      <p className={`text-[11px] ${meter.cls}`}>{meter.text}</p>
                      <button
                        type="button"
                        disabled={savingAudio === beat.id || generatingAll}
                        onClick={() => void handleSaveAudio(beat.id)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        {savingAudio === beat.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : 'Guardar audio'}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
