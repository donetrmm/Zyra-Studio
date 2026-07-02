'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ImageIcon, Loader2, MapPin, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { generatePanelAction, refinePanelAction, setStoryboardLocationAction, setBeatAudioAction } from '@/server-actions/storyboard';
import type { StoryboardBeat } from '@/lib/campaigns/storyboard-types';
import type { StoryboardCreative } from '@/lib/campaigns/storyboard-creatives';
import { extractDialogue, estimateSpeechSeconds, fitVerdict, countWords } from '@/lib/campaigns/speech-fit';
import { useStoryboardPanelRealtime, panelUpdateFromRow, slimPanelRow, type SlimPanelRow } from './use-storyboard-panel-realtime';
import { createClient } from '@/lib/supabase/client';

const ERROR_MESSAGES: Record<string, string> = {
  insufficient_credits: 'No tienes créditos suficientes',
  no_panel: 'Genera el panel primero',
  not_found: 'No encontrado',
  in_flight: 'Este panel ya se está generando. Espera a que termine.',
  max_turns: 'Límite de refinados alcanzado para este panel (10). Regenera el panel para empezar una sesión nueva.',
};

function friendlyError(error: string, message?: string): string {
  return ERROR_MESSAGES[error] ?? message ?? error;
}

type PanelState =
  | { status: 'idle'; panelUrl: string | null }
  | { status: 'generating' }
  | { status: 'error'; message: string };

// Quita un beat del mapa de refinados-en-vuelo (devuelve la misma ref si no estaba,
// para no re-renderizar de mas). Modulo-level: ref estable para los useCallback.
function clearBeat(map: Record<string, boolean>, beatId: string): Record<string, boolean> {
  if (!map[beatId]) return map;
  const next = { ...map };
  delete next[beatId];
  return next;
}

type Props = {
  campaignId: string;
  campaignName: string;
  beats: StoryboardBeat[];
  creatives: StoryboardCreative[];
  locations: { id: string; name: string }[];
  language: 'es' | 'en';
  // Costo en creditos por panel (null si no se pudo cargar el pricing). fresh = generar
  // un panel nuevo (conversational:false); chained = regenerar/refinar un panel que ya
  // existe (la accion usa el turno previo => conversational:true, 1.5x).
  panelCostFresh: number | null;
  panelCostChained: number | null;
};

export function StoryboardView({ campaignId, campaignName, beats, creatives, locations, language, panelCostFresh, panelCostChained }: Props) {
  const router = useRouter();
  const [savingLocation, setSavingLocation] = useState(false);
  const [savingBeatLocation, setSavingBeatLocation] = useState<string | null>(null);

  // Creativo seleccionado (default: el primero). El storyboard muestra solo sus beats.
  const [selectedCreativeKey, setSelectedCreativeKey] = useState<string | null>(
    creatives[0]?.key ?? null,
  );

  // Mapa beatId -> beat (para reconstruir los beats del creativo en su orden).
  const beatById = new Map(beats.map((b) => [b.id, b]));
  const selectedCreative =
    creatives.find((c) => c.key === selectedCreativeKey) ?? creatives[0] ?? null;
  const visibleBeats: StoryboardBeat[] = selectedCreative
    ? selectedCreative.beatIds.map((id) => beatById.get(id)).filter((b): b is StoryboardBeat => b != null)
    : beats;

  // Locación actual del creativo seleccionado: primer locationId no nulo de sus beats.
  const currentLocationId = visibleBeats.find((b) => b.locationId)?.locationId ?? null;

  async function handleSetLocation(locationId: string | null) {
    if (!selectedCreative) return;
    setSavingLocation(true);
    const res = await setStoryboardLocationAction(campaignId, locationId, {
      sequenceId: selectedCreative.sequenceId,
      itemId: selectedCreative.representativeItemId,
    });
    setSavingLocation(false);
    if (res.ok) {
      toast.success(locationId ? 'Locación anclada al creativo' : 'Locación quitada');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  // Locacion de UN clip (item): scope por item (sequenceId null). El general (handleSetLocation)
  // escribe toda la secuencia; este sobrescribe solo este beat. La locacion se aplica al regenerar.
  async function handleSetBeatLocation(itemId: string, locationId: string | null) {
    setSavingBeatLocation(itemId);
    const res = await setStoryboardLocationAction(campaignId, locationId, {
      sequenceId: null,
      itemId,
    });
    setSavingBeatLocation(null);
    if (res.ok) {
      toast.success(locationId ? 'Locación del clip actualizada' : 'Locación del clip quitada');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  // Beats con un refinado en vuelo: mantiene la imagen actual visible con un overlay
  // "Refinando..." hasta que Realtime cierra la generacion (done/failed). Distinto de
  // 'generating', que reemplaza la imagen por el spinner (regenerar parte de cero).
  const [refiningBeats, setRefiningBeats] = useState<Record<string, boolean>>({});

  // Estado local por beat: refleja URL y estado de generación sin necesitar Realtime.
  const [panelStates, setPanelStates] = useState<Record<string, PanelState>>(() => {
    const init: Record<string, PanelState> = {};
    for (const b of beats) {
      init[b.id] = { status: 'idle', panelUrl: b.panelUrl };
    }
    return init;
  });

  // Reconciliar prop -> estado tras router.refresh(): el lazy initializer de useState
  // solo siembra UNA vez, así que sin esto el panel recién generado/refinado se queda
  // en "Sin panel" hasta un reload duro y withoutPanel/el contador/el botón quedan
  // stale (riesgo de doble cobro al reclicar). Patrón de React "ajustar estado al
  // cambiar una prop" EN RENDER (no en efecto: evita el cascading-render). `beats` solo
  // cambia de referencia cuando el server vuelve a renderizar (el refresh), no en los
  // re-render de cliente, así que esto corre exactamente cuando antes corría el efecto.
  // Solo tocamos entradas 'idle' (no pisamos 'generating'/'error' en vuelo) y creamos
  // la clave si falta.
  const [reconciledBeats, setReconciledBeats] = useState(beats);
  if (beats !== reconciledBeats) {
    setReconciledBeats(beats);
    setPanelStates((prev) => {
      let changed = false;
      const next: Record<string, PanelState> = { ...prev };
      for (const b of beats) {
        const cur = prev[b.id];
        if (!cur) {
          next[b.id] = { status: 'idle', panelUrl: b.panelUrl };
          changed = true;
        } else if (cur.status === 'idle' && cur.panelUrl !== b.panelUrl) {
          next[b.id] = { status: 'idle', panelUrl: b.panelUrl };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  // Generación esperada por beat tras un click de regenerar/refinar. 'pending'
  // mientras el server action crea la fila (aún no hay id). Sin este mapa, el
  // heal/Realtime emite el 'done' de la generación ANTERIOR del beat en esa
  // ventana y apaga el loader del intento nuevo (Realtime no escucha INSERTs,
  // así que nada lo vuelve a encender hasta un reload).
  const awaitingGenRef = useRef<Record<string, string>>({});

  // Realtime: el worker genera el panel async; escuchamos el estado de la generacion.
  const onPanelUpdate = useCallback(
    (u: { campaignItemId: string; status: string; errorMessage: string | null; generationId: string | null }) => {
      const isTerminal = u.status === 'done' || u.status === 'failed';
      if (isTerminal) {
        const awaited = awaitingGenRef.current[u.campaignItemId];
        if (awaited && u.generationId !== awaited) {
          // Evento terminal de una generación vieja del beat: no pisar el intento en curso.
          return;
        }
        delete awaitingGenRef.current[u.campaignItemId];
      }
      if (u.status === 'done') {
        setRefiningBeats((prev) => clearBeat(prev, u.campaignItemId));
        setPanelStates((prev) => ({ ...prev, [u.campaignItemId]: { status: 'idle', panelUrl: null } }));
        router.refresh();
      } else if (u.status === 'failed') {
        setRefiningBeats((prev) => clearBeat(prev, u.campaignItemId));
        const msg = u.errorMessage ?? 'No se pudo generar el panel.';
        setPanelStates((prev) => ({ ...prev, [u.campaignItemId]: { status: 'error', message: msg } }));
      } else if (u.status === 'processing' || u.status === 'queued') {
        // Reconciliacion al montar: un panel que quedo generando (tras recarga) vuelve a
        // mostrar el spinner; el evento terminal por Realtime lo cierra.
        setPanelStates((prev) => {
          const cur = prev[u.campaignItemId];
          if (cur?.status === 'generating') return prev;
          return { ...prev, [u.campaignItemId]: { status: 'generating' } };
        });
      }
    },
    [router],
  );
  useStoryboardPanelRealtime(campaignId, onPanelUpdate);

  // Input de refinado por beat
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [refining, setRefining] = useState<string | null>(null);

  // Espejo de estado para leer lo ultimo dentro del interval sin recrearlo.
  const inFlightSourceRef = useRef<{ panelStates: Record<string, PanelState>; refiningBeats: Record<string, boolean> }>({
    panelStates: {},
    refiningBeats: {},
  });

  // Fallback de auto-cura: postgres_changes (Realtime) puede perder eventos si su
  // replicacion CDC se cae bajo presion de pool. Mientras haya paneles en vuelo
  // (generando/refinando) re-consultamos su estado real cada 8s y lo reconciliamos via
  // onPanelUpdate. Idempotente: si Realtime ya entrego, no cambia nada; si lo perdio, la
  // UI se auto-cura en segundos sin recargar. Solo consulta cuando hay algo en vuelo.
  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(() => {
      const { panelStates: ps, refiningBeats: rb } = inFlightSourceRef.current;
      const inFlight = new Set<string>();
      for (const [beatId, s] of Object.entries(ps)) if (s.status === 'generating') inFlight.add(beatId);
      for (const [beatId, on] of Object.entries(rb)) if (on) inFlight.add(beatId);
      if (inFlight.size === 0) return;
      void supabase
        .from('generations')
        .select('id, status, error_message, campaign_id, created_at, beat_id:params->storyboard->>campaignItemId')
        .eq('campaign_id', campaignId)
        .not('params->storyboard', 'is', null)
        .order('created_at', { ascending: false })
        .limit(60)
        .then(({ data }) => {
          if (!data) return;
          const seen = new Set<string>();
          for (const row of data) {
            const u = panelUpdateFromRow(slimPanelRow(row as unknown as SlimPanelRow), campaignId);
            if (!u || seen.has(u.campaignItemId)) continue; // solo la generacion mas reciente por beat
            seen.add(u.campaignItemId);
            if (inFlight.has(u.campaignItemId)) onPanelUpdate(u);
          }
        });
    }, 8000);
    return () => clearInterval(timer);
  }, [campaignId, onPanelUpdate]);

  // Mantiene el espejo al dia para que el interval del fallback vea el estado actual.
  useEffect(() => {
    inFlightSourceRef.current = { panelStates, refiningBeats };
  });
  // Error de refinado por beat: persiste como nota bajo el panel (sin borrar la
  // panelUrl previa) hasta el próximo intento; el toast solo es efímero.
  const [refineErrors, setRefineErrors] = useState<Record<string, string>>({});

  // EXPERIMENTAL por beat: anclar la imagen del producto en el turno de chat al
  // regenerar (paneles encadenados). Transitorio (no se persiste): controla la prueba
  // del re-anclaje de producto sin tocar el env flag global.
  const [productRef, setProductRef] = useState<Record<string, boolean>>({});
  const [characterRef, setCharacterRef] = useState<Record<string, boolean>>({});

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

  // Beats sin panel del creativo seleccionado (lo que genera "Generar storyboard").
  const withoutPanel = visibleBeats.filter((b) => {
    const s = panelStates[b.id];
    return s?.status === 'idle' && s.panelUrl === null;
  });

  async function handleGenerateAll() {
    setGeneratingAll(true);
    for (const beat of withoutPanel) {
      setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'generating' } }));
      awaitingGenRef.current[beat.id] = 'pending';
      const res = await generatePanelAction(beat.id);
      if (!res.ok) {
        delete awaitingGenRef.current[beat.id];
        const msg = friendlyError(res.error, res.message);
        setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'error', message: msg } }));
        toast.error(`Panel ${beat.sceneIndex + 1}: ${msg}`);
        continue;
      }
      awaitingGenRef.current[beat.id] = res.data.generationId;
      // ok: el panel queda 'generating'; Realtime lo cierra (done -> idle, failed -> error).
    }
    setGeneratingAll(false);
  }

  async function handleRegenerate(beatId: string) {
    setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'generating' } }));
    // 'pending' bloquea eventos terminales viejos hasta conocer el id real.
    awaitingGenRef.current[beatId] = 'pending';
    const res = await generatePanelAction(beatId, {
      productRefInChat: productRef[beatId] ?? false,
      characterRefInChat: characterRef[beatId] ?? false,
    });
    if (!res.ok) {
      delete awaitingGenRef.current[beatId];
      const msg = friendlyError(res.error, res.message);
      setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'error', message: msg } }));
      toast.error(msg);
      return;
    }
    awaitingGenRef.current[beatId] = res.data.generationId;
    // ok: el panel queda 'generating'; Realtime lo pasa a idle (done) o error (failed).
  }

  async function handleRefine(beatId: string) {
    const instruction = (instructions[beatId] ?? '').trim();
    if (!instruction) {
      toast.error('Escribe una instrucción antes de refinar');
      return;
    }
    setRefining(beatId);
    // Overlay "Refinando..." sobre la imagen actual desde el click; persiste durante toda
    // la generacion (Realtime lo cierra en done/failed). Se mantiene la panelUrl visible
    // (no la ponemos en null como antes, que dejaba "Sin panel" ~80s sin feedback).
    setRefiningBeats((prev) => ({ ...prev, [beatId]: true }));
    awaitingGenRef.current[beatId] = 'pending';
    setRefineErrors((prev) => {
      if (!(beatId in prev)) return prev;
      const next = { ...prev };
      delete next[beatId];
      return next;
    });
    const res = await refinePanelAction(beatId, instruction);
    setRefining(null);
    if (res.ok) {
      awaitingGenRef.current[beatId] = res.data.generationId;
      setInstructions((prev) => ({ ...prev, [beatId]: '' }));
      // El overlay queda activo; el evento terminal por Realtime (done/failed) lo limpia.
    } else {
      delete awaitingGenRef.current[beatId];
      setRefiningBeats((prev) => clearBeat(prev, beatId));
      const msg = friendlyError(res.error, res.message);
      // Persistir el fallo como nota bajo el panel (no borramos la panelUrl previa):
      // refinar (Nano Banana) puede tardar y el toast se desvanece sin dejar rastro.
      setRefineErrors((prev) => ({ ...prev, [beatId]: msg }));
      toast.error(msg);
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
            {visibleBeats.length} escenas
            {withoutPanel.length > 0 && ` · ${withoutPanel.length} sin panel`}
          </p>
        </div>
        {withoutPanel.length > 0 && (
          <Button type="button" disabled={generatingAll} onClick={handleGenerateAll}>
            {generatingAll ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            Generar storyboard
            {panelCostFresh != null && (
              <span className="text-primary-foreground/80">
                · −{panelCostFresh * withoutPanel.length} cr
              </span>
            )}
          </Button>
        )}
      </div>

      {creatives.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2">
          <label htmlFor="storyboard-creative" className="text-[12px] text-muted-foreground">
            Creativo:
          </label>
          <select
            id="storyboard-creative"
            value={selectedCreative?.key ?? ''}
            onChange={(e) => setSelectedCreativeKey(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {creatives.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({c.beatIds.length} {c.beatIds.length === 1 ? 'escena' : 'escenas'})
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            el storyboard muestra solo las escenas de este creativo
          </span>
        </div>
      )}

      {locations.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2">
          <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
          <label htmlFor="storyboard-location" className="text-[12px] text-muted-foreground">
            Locación base (aplica a todos los clips):
          </label>
          <select
            id="storyboard-location"
            value={currentLocationId ?? ''}
            disabled={savingLocation}
            onChange={(e) => void handleSetLocation(e.target.value === '' ? null : e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <option value="">Sin locación</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            siembra todos los clips; ajusta cada uno abajo. Regenera para aplicarla.
          </span>
        </div>
      )}

      {visibleBeats.length === 0 ? (
        <div className="mt-12 rounded-xl border border-border bg-card/50 p-8 text-center">
          <p className="text-[14px] text-foreground/70">Esta campaña no tiene escenas</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Agrega creativos en el plan para generar paneles de storyboard.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleBeats.map((beat) => {
            const state = panelStates[beat.id] ?? { status: 'idle', panelUrl: beat.panelUrl };
            const isGenerating = state.status === 'generating';
            const isRefining = refining === beat.id;
            const refiningNow = !!refiningBeats[beat.id];
            // Durante un refinado mantenemos visible la ultima imagen conocida (beat.panelUrl)
            // aunque Realtime pase el estado a 'generating': el overlay indica el trabajo.
            const panelUrl = state.status === 'idle' ? state.panelUrl : refiningNow ? beat.panelUrl : null;
            const hasError = state.status === 'error';
            const instruction = instructions[beat.id] ?? '';
            const busy = isGenerating || isRefining || refiningNow || generatingAll;
            // Regenerar un panel que ya existe pasa por el turno previo (chained, 1.5x);
            // sin panel todavia es una generacion nueva (fresh).
            const regenCost = panelUrl ? panelCostChained : panelCostFresh;

            return (
              <div key={beat.id} className="flex flex-col gap-2">
                {/* Panel image */}
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-muted/20">
                  {(isGenerating || isRefining) && !refiningNow ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="size-6 animate-spin" aria-hidden />
                      <span className="text-[11px]">generando…</span>
                    </div>
                  ) : panelUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={panelUrl}
                        alt={`Panel ${beat.sceneIndex + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                      {refiningNow && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-white">
                          <Loader2 className="size-6 animate-spin" aria-hidden />
                          <span className="text-[11px]">Refinando…</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageIcon className="size-8 opacity-40" aria-hidden />
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

                {/* Motivo persistido del último fallo (el worker lo anota; regenerar lo limpia). */}
                {beat.warnings.length > 0 && !isGenerating && !isRefining && (
                  <p className="text-[11px] leading-snug text-amber-400/80">{beat.warnings[0]}</p>
                )}

                {/* Locación de este clip (override por item; el general siembra todos) */}
                {locations.length > 0 && (
                  <div className="flex items-center gap-1.5 px-0.5">
                    <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <label htmlFor={`loc-${beat.id}`} className="sr-only">
                      Locación del clip {beat.sceneIndex + 1}
                    </label>
                    <select
                      id={`loc-${beat.id}`}
                      value={beat.locationId ?? ''}
                      disabled={savingBeatLocation === beat.id || busy}
                      onChange={(e) =>
                        void handleSetBeatLocation(beat.id, e.target.value === '' ? null : e.target.value)
                      }
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <option value="">Sin locación</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Regenerar */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleRegenerate(beat.id)}
                >
                  <RefreshCw className="size-3" aria-hidden />
                  Regenerar
                  {regenCost != null && (
                    <span className="text-muted-foreground">· −{regenCost} cr</span>
                  )}
                </Button>

                {/* Mantener el producto idéntico al regenerar (re-ancla la imagen del
                    producto en el turno de chat de los paneles encadenados). */}
                <div className="flex items-center gap-2 px-0.5">
                  <Switch
                    id={`prodref-${beat.id}`}
                    size="sm"
                    checked={productRef[beat.id] ?? false}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setProductRef((prev) => ({ ...prev, [beat.id]: checked }))
                    }
                  />
                  <label htmlFor={`prodref-${beat.id}`} className="text-[11px] text-muted-foreground">
                    Mantener el producto idéntico al regenerar
                  </label>
                </div>

                {/* Mantener al personaje idéntico al regenerar (re-ancla la hoja maestra
                    del cast en el turno de chat de los paneles encadenados). */}
                <div className="flex items-center gap-2 px-0.5">
                  <Switch
                    id={`charref-${beat.id}`}
                    size="sm"
                    checked={characterRef[beat.id] ?? false}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setCharacterRef((prev) => ({ ...prev, [beat.id]: checked }))
                    }
                  />
                  <label htmlFor={`charref-${beat.id}`} className="text-[11px] text-muted-foreground">
                    Mantener al personaje idéntico al regenerar
                  </label>
                </div>

                {/* Refinar */}
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={instruction}
                    aria-label={`Instrucción de refinado para el panel ${beat.sceneIndex + 1}`}
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
                    disabled={busy || !panelUrl}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0"
                    disabled={busy || !panelUrl || !instruction.trim()}
                    onClick={() => void handleRefine(beat.id)}
                  >
                    {isRefining ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : panelCostChained != null ? (
                      `Refinar · −${panelCostChained} cr`
                    ) : (
                      'Refinar'
                    )}
                  </Button>
                </div>
                {refineErrors[beat.id] && (
                  <p role="alert" className="px-0.5 text-[11px] text-destructive">
                    No se pudo refinar: {refineErrors[beat.id]}
                  </p>
                )}

                {/* Audio: diálogo + duración + medidor de holgura */}
                {(() => {
                  const draft = audioDraft[beat.id] ?? { dialogue: extractDialogue(beat.scenePrompt), durationS: beat.durationS };
                  const words = countWords(draft.dialogue);
                  const needed = estimateSpeechSeconds(draft.dialogue, language);
                  const { level, suggestedDurationS } = fitVerdict(needed, draft.durationS);
                  const meter =
                    words === 0
                      ? { text: 'Sin diálogo', cls: 'text-muted-foreground' }
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
                        aria-label={`Diálogo de la escena ${beat.sceneIndex + 1}`}
                        onChange={(e) =>
                          setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, dialogue: e.target.value } }))
                        }
                        placeholder="Diálogo (vacío = sin voz)"
                        rows={2}
                        className="min-w-0 resize-none rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                      <div className="flex items-center gap-2">
                        <label htmlFor={`dur-${beat.id}`} className="text-[11px] text-muted-foreground">
                          Duración
                        </label>
                        <input
                          id={`dur-${beat.id}`}
                          type="number"
                          min={4}
                          max={15}
                          value={draft.durationS}
                          onChange={(e) => {
                            const v = Math.min(15, Math.max(4, Math.round(Number(e.target.value) || 4)));
                            setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, durationS: v } }));
                          }}
                          className="w-16 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                        />
                        <span className="text-[11px]">s</span>
                      </div>
                      <p className={`text-[11px] ${meter.cls}`}>{meter.text}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={savingAudio === beat.id || generatingAll}
                        onClick={() => void handleSaveAudio(beat.id)}
                      >
                        {savingAudio === beat.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : 'Guardar audio'}
                      </Button>
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
