'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, ImageIcon, Loader2, MapPin, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { generatePanelAction, restorePanelVersionAction, setStoryboardLocationAction, setBeatAudioAction, uploadPanelAction } from '@/server-actions/storyboard';
import type { StoryboardBeat } from '@/lib/campaigns/storyboard-types';
import type { StoryboardCreative } from '@/lib/campaigns/storyboard-creatives';
import { extractDialogue, estimateSpeechSeconds, fitVerdict, countWords } from '@/lib/campaigns/speech-fit';
import { VOICE_TONE_LABELS } from '@/lib/campaigns/voice-tone';
import { useStoryboardPanelRealtime, panelUpdateFromRow, slimPanelRow, type SlimPanelRow } from './use-storyboard-panel-realtime';
import {
  reconcilePanelStates,
  clearLinkedOverlays,
  stabilizePanelUrls,
  type PanelState,
} from './storyboard-panel-sync';
import { ReferencePoolDialog } from './ReferencePoolDialog';
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

  // Beats con un refinado en vuelo: mantiene la imagen actual visible con un overlay
  // "Refinando..." hasta que el refresh trae el beat ya enlazado a la gen nueva.
  // Distinto de 'generating', que reemplaza la imagen por el spinner (parte de cero).
  const [refiningBeats, setRefiningBeats] = useState<Record<string, boolean>>({});

  // Estado local por beat: refleja URL y estado de generación sin necesitar Realtime.
  const [panelStates, setPanelStates] = useState<Record<string, PanelState>>(() => {
    const init: Record<string, PanelState> = {};
    for (const b of beats) {
      init[b.id] = { status: 'idle', panelUrl: b.panelUrl };
    }
    return init;
  });

  // Generaciones esperadas por beat tras un click de regenerar/refinar (lista:
  // un lote de variantes espera varias). ['pending'] mientras el server action
  // crea las filas (aún no hay ids). Sin este mapa, el heal/Realtime emite el
  // 'done' de una generación ANTERIOR del beat en esa ventana y apaga el loader
  // del intento nuevo (Realtime no escucha INSERTs, así que nada lo vuelve a
  // encender hasta un reload).
  const awaitingGenRef = useRef<Record<string, string[]>>({});

  // Dones de variantes de un lote AÚN en vuelo (solo se lee/escribe en callbacks,
  // nunca en render). Al cerrar el lote se publican en readyGens.
  const batchDoneRef = useRef<Record<string, string[]>>({});

  // Generaciones COMPLETADAS (done) del intento TERMINADO, por beat. El flip
  // 'generating' -> 'idle' y la limpieza del overlay NO pasan al recibir el done:
  // esperan a que un refresh entregue el beat ya ENLAZADO a una de estas gens
  // (el promote corre en su propio job después del done). Sin esta espera, el
  // panel mostraba "Sin panel"/panel viejo un instante entre el done y el promote.
  // Es estado (no ref) porque la reconciliación lo lee durante el render. En un
  // lote ×3 los ids se publican juntos al terminar la última variante, así el
  // primer done no apaga el overlay con variantes todavía en vuelo.
  const [readyGens, setReadyGens] = useState<Record<string, string[]>>({});

  // Reset al iniciar un intento (regenerar/refinar/lote): un done publicado del
  // intento anterior apunta a la gen YA enlazada y flipearía el loader nuevo.
  const resetCompletedGens = (beatId: string) => {
    delete batchDoneRef.current[beatId];
    setReadyGens((prev) => {
      if (!(beatId in prev)) return prev;
      const next = { ...prev };
      delete next[beatId];
      return next;
    });
  };

  // Reconciliar prop -> estado tras router.refresh(): el lazy initializer de useState
  // solo siembra UNA vez, así que sin esto el panel recién generado/refinado se queda
  // en "Sin panel" hasta un reload duro y withoutPanel/el contador/el botón quedan
  // stale (riesgo de doble cobro al reclicar). Patrón de React "ajustar estado al
  // cambiar una prop" EN RENDER (no en efecto: evita el cascading-render). `beats` solo
  // cambia de referencia cuando el server vuelve a renderizar (el refresh), no en los
  // re-render de cliente. `stableBeats` conserva la URL previa cuando el server solo
  // re-firmó el MISMO asset (createSignedUrl emite token nuevo por render): sin eso,
  // cada refresh cambiaba el src de TODOS los <img> y la grilla entera parpadeaba
  // durante generación/refinado.
  const [reconciledBeats, setReconciledBeats] = useState(beats);
  const [stableBeats, setStableBeats] = useState(beats);
  if (beats !== reconciledBeats) {
    setReconciledBeats(beats);
    const nextStable = stabilizePanelUrls(stableBeats, beats);
    setStableBeats(nextStable);
    setPanelStates((prev) => reconcilePanelStates(prev, nextStable, readyGens) ?? prev);
    setRefiningBeats((prev) => clearLinkedOverlays(prev, nextStable, readyGens) ?? prev);
  }

  // Mapa beatId -> beat (para reconstruir los beats del creativo en su orden).
  const beatById = new Map(stableBeats.map((b) => [b.id, b]));
  const selectedCreative =
    creatives.find((c) => c.key === selectedCreativeKey) ?? creatives[0] ?? null;
  const visibleBeats: StoryboardBeat[] = selectedCreative
    ? selectedCreative.beatIds.map((id) => beatById.get(id)).filter((b): b is StoryboardBeat => b != null)
    : stableBeats;

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

  // Realtime: el worker genera el panel async; escuchamos el estado de la generacion.
  const onPanelUpdate = useCallback(
    (u: { campaignItemId: string; status: string; errorMessage: string | null; generationId: string | null }) => {
      const isTerminal = u.status === 'done' || u.status === 'failed';
      if (isTerminal) {
        const awaited = awaitingGenRef.current[u.campaignItemId];
        if (awaited?.length) {
          if (!u.generationId || !awaited.includes(u.generationId)) {
            // Evento terminal de una generación vieja del beat (o aún sin ids del
            // lote nuevo): no pisar el intento en curso.
            return;
          }
          const rest = awaited.filter((id) => id !== u.generationId);
          if (rest.length > 0) {
            // Quedan variantes del lote en vuelo: refrescar para mostrar la que
            // llegó, pero mantener el loader/overlay hasta que termine el lote.
            // El done se acumula en el ref (no en readyGens): publicarlo ya
            // apagaría el overlay con variantes todavía en vuelo.
            awaitingGenRef.current[u.campaignItemId] = rest;
            if (u.status === 'done' && u.generationId) {
              const done = batchDoneRef.current[u.campaignItemId] ?? [];
              if (!done.includes(u.generationId)) {
                batchDoneRef.current[u.campaignItemId] = [...done, u.generationId];
              }
            }
            router.refresh();
            return;
          }
          delete awaitingGenRef.current[u.campaignItemId];
        }
      }
      if (u.status === 'done') {
        if (u.generationId) {
          // Publicar los done del intento (el lote completo, si lo hubo): el flip
          // a idle y la limpieza del overlay ocurren cuando un refresh entrega el
          // beat ya ENLAZADO a una de estas gens — en un lote ×3 la enlazada puede
          // ser cualquier variante, no necesariamente la última en terminar.
          // Mientras tanto el spinner/overlay cubren el hueco del promote.
          const batch = batchDoneRef.current[u.campaignItemId] ?? [];
          delete batchDoneRef.current[u.campaignItemId];
          const ids = batch.includes(u.generationId) ? batch : [...batch, u.generationId];
          setReadyGens((prev) => {
            const cur = prev[u.campaignItemId] ?? [];
            const merged = [...cur, ...ids.filter((id) => !cur.includes(id))];
            return merged.length === cur.length ? prev : { ...prev, [u.campaignItemId]: merged };
          });
        } else {
          // Sin id no hay forma de esperar el enlace: degradar al flip inmediato
          // para no dejar el loader encendido (fila legacy, no debería pasar).
          setRefiningBeats((prev) => clearBeat(prev, u.campaignItemId));
          setPanelStates((prev) => ({ ...prev, [u.campaignItemId]: { status: 'idle', panelUrl: null } }));
        }
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
  // EXPERIMENTAL por beat: anclar la imagen del producto en el turno de chat al
  // regenerar (paneles encadenados). Transitorio (no se persiste): controla la prueba
  // del re-anclaje de producto sin tocar el env flag global.
  const [productRef, setProductRef] = useState<Record<string, boolean>>({});
  const [characterRef, setCharacterRef] = useState<Record<string, boolean>>({});
  // Adjunta la imagen de la locación en el turno de chat (regenerar/refinar):
  // para refinados que recomponen la cámara o abren zonas del set que el panel
  // previo no muestra. Solo visible en beats con locación asignada.
  const [locationRef, setLocationRef] = useState<Record<string, boolean>>({});

  // Historial de versiones: selección pendiente por beat + beat restaurando.
  const [versionPick, setVersionPick] = useState<Record<string, string>>({});
  const [restoring, setRestoring] = useState<string | null>(null);

  // Panel manual: subida en curso por beat.
  const [uploadingPanel, setUploadingPanel] = useState<string | null>(null);

  // Descarga el panel actual (la URL firmada es cross-origin: el atributo
  // download del <a> se ignora, así que se baja como blob).
  async function handleDownloadPanel(beatId: string, panelUrl: string, sceneIndex: number) {
    try {
      const res = await fetch(panelUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `panel-escena-${sceneIndex + 1}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el panel');
    }
  }

  async function handleUploadPanel(beatId: string, file: File | null) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Imagen demasiado grande (máx 15MB)');
      return;
    }
    setUploadingPanel(beatId);
    const fd = new FormData();
    fd.set('file', file);
    const res = await uploadPanelAction(beatId, fd);
    setUploadingPanel(null);
    if (res.ok) {
      toast.success('Panel reemplazado con tu imagen');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  async function handleRestoreVersion(beatId: string, generationId: string) {
    setRestoring(beatId);
    const res = await restorePanelVersionAction(beatId, generationId);
    setRestoring(null);
    if (res.ok) {
      toast.success('Versión restaurada');
      router.refresh();
    } else {
      toast.error(friendlyError(res.error, res.message));
    }
  }

  // Genera todos los paneles faltantes de forma secuencial
  const [generatingAll, setGeneratingAll] = useState(false);

  // Estado del editor de audio por beat
  const [audioDraft, setAudioDraft] = useState<Record<string, { dialogue: string; durationS: number; voiceTone: string }>>(() => {
    const init: Record<string, { dialogue: string; durationS: number; voiceTone: string }> = {};
    for (const b of beats) init[b.id] = { dialogue: extractDialogue(b.scenePrompt), durationS: b.durationS, voiceTone: b.voiceTone ?? '' };
    return init;
  });
  const [savingAudio, setSavingAudio] = useState<string | null>(null);

  async function handleSaveAudio(beatId: string) {
    const draft = audioDraft[beatId];
    if (!draft) return;
    setSavingAudio(beatId);
    const res = await setBeatAudioAction(beatId, draft.dialogue, draft.durationS, draft.voiceTone.trim() || null);
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
      // Reset del intento: sin esto, un done publicado del intento ANTERIOR
      // (mismo id ya enlazado) flipearía el spinner nuevo de inmediato.
      resetCompletedGens(beat.id);
      awaitingGenRef.current[beat.id] = ['pending'];
      const res = await generatePanelAction(beat.id);
      if (!res.ok) {
        delete awaitingGenRef.current[beat.id];
        const msg = friendlyError(res.error, res.message);
        setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'error', message: msg } }));
        toast.error(`Panel ${beat.sceneIndex + 1}: ${msg}`);
        continue;
      }
      awaitingGenRef.current[beat.id] = [res.data.generationId];
      // ok: el panel queda 'generating'; Realtime lo cierra (done -> idle, failed -> error).
    }
    setGeneratingAll(false);
  }

  async function handleRegenerate(beatId: string) {
    setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'generating' } }));
    // 'pending' bloquea eventos terminales viejos hasta conocer el id real; el
    // reset de completados evita que el done del intento anterior flippee este.
    resetCompletedGens(beatId);
    awaitingGenRef.current[beatId] = ['pending'];
    const res = await generatePanelAction(beatId, {
      productRefInChat: productRef[beatId] ?? false,
      characterRefInChat: characterRef[beatId] ?? false,
      locationRefInChat: locationRef[beatId] ?? false,
    });
    if (!res.ok) {
      delete awaitingGenRef.current[beatId];
      const msg = friendlyError(res.error, res.message);
      setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'error', message: msg } }));
      toast.error(msg);
      return;
    }
    awaitingGenRef.current[beatId] = [res.data.generationId];
    // ok: el panel queda 'generating'; Realtime lo pasa a idle (done) o error (failed).
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
        <div className="flex flex-wrap items-center gap-2">
          <ReferencePoolDialog campaignId={campaignId} context="storyboard" />
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
            const refiningNow = !!refiningBeats[beat.id];
            // Durante un refinado mantenemos visible la ultima imagen conocida (beat.panelUrl)
            // aunque Realtime pase el estado a 'generating': el overlay indica el trabajo.
            const panelUrl = state.status === 'idle' ? state.panelUrl : refiningNow ? beat.panelUrl : null;
            const hasError = state.status === 'error';
            const busy = isGenerating || refiningNow || generatingAll;
            // Regenerar un panel que ya existe pasa por el turno previo (chained, 1.5x);
            // sin panel todavia es una generacion nueva (fresh).
            const regenCost = panelUrl ? panelCostChained : panelCostFresh;

            return (
              <div key={beat.id} className="flex flex-col gap-2">
                {/* Panel image */}
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-muted/20">
                  {isGenerating && !refiningNow ? (
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
                {beat.warnings.length > 0 && !isGenerating && (
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

                {/* Descargar el panel / reemplazarlo con una imagen propia (flujo:
                    bajar, editar fuera, subir de vuelta). La subida crea una
                    media_reference manual; video y refinado la usan igual. */}
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={busy || !panelUrl}
                    onClick={() => void handleDownloadPanel(beat.id, panelUrl as string, beat.sceneIndex)}
                  >
                    <Download className="size-3" aria-hidden />
                    Descargar
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={busy || uploadingPanel === beat.id}
                    onClick={() => document.getElementById(`upload-${beat.id}`)?.click()}
                  >
                    {uploadingPanel === beat.id ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="size-3" aria-hidden />
                    )}
                    {panelUrl ? 'Reemplazar' : 'Subir imagen'}
                  </Button>
                  <input
                    id={`upload-${beat.id}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = '';
                      void handleUploadPanel(beat.id, f);
                    }}
                  />
                </div>

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
                    Mantener el producto idéntico al regenerar o refinar
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
                    Mantener al personaje idéntico al regenerar o refinar
                  </label>
                </div>

                {/* Mantener la locación al regenerar/refinar (adjunta la imagen del
                    lugar en el turno de chat). Solo beats con locación asignada:
                    sin locación no hay imagen environment que adjuntar. */}
                {beat.locationId && (
                  <div className="flex items-center gap-2 px-0.5">
                    <Switch
                      id={`locref-${beat.id}`}
                      size="sm"
                      checked={locationRef[beat.id] ?? false}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setLocationRef((prev) => ({ ...prev, [beat.id]: checked }))
                      }
                    />
                    <label htmlFor={`locref-${beat.id}`} className="text-[11px] text-muted-foreground">
                      Mantener la locación idéntica al regenerar o refinar
                    </label>
                  </div>
                )}

                {/* Editar el panel: el refinado inline se retiró — la edición vive
                    en el estudio creativo (chat con historial, multi-proveedor). */}
                <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                  <Link href={`/app/studio/panel/${beat.id}`}>Abrir en estudio</Link>
                </Button>

                {/* Historial de versiones: cada generación terminada del beat es
                    restaurable (link swap, sin regenerar ni cobrar). Existe porque
                    iterar refinados degrada la imagen (generation-loss) y sin esto
                    la versión buena quedaba enterrada. Hora fija a es-MX para que
                    SSR e hidratación coincidan (demo single-market). */}
                {beat.versions.length > 1 && (
                  <div className="flex items-center gap-1.5 px-0.5">
                    <label htmlFor={`ver-${beat.id}`} className="sr-only">
                      Versiones del panel {beat.sceneIndex + 1}
                    </label>
                    <select
                      id={`ver-${beat.id}`}
                      value={versionPick[beat.id] ?? beat.storyboardGenerationId ?? beat.versions[0].id}
                      disabled={busy || restoring === beat.id}
                      onChange={(e) => setVersionPick((prev) => ({ ...prev, [beat.id]: e.target.value }))}
                      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      {beat.versions.map((v, i) => (
                        <option key={v.id} value={v.id}>
                          {`V${beat.versions.length - i} · ${new Date(v.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' })}${v.refine ? ' · refinado' : ''}${v.id === beat.storyboardGenerationId ? ' · actual' : ''}`}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={
                        busy ||
                        restoring === beat.id ||
                        (versionPick[beat.id] ?? beat.storyboardGenerationId ?? '') === (beat.storyboardGenerationId ?? '')
                      }
                      onClick={() =>
                        void handleRestoreVersion(beat.id, versionPick[beat.id] ?? beat.versions[0].id)
                      }
                    >
                      {restoring === beat.id ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        'Restaurar'
                      )}
                    </Button>
                  </div>
                )}

                {/* Audio: diálogo + duración + medidor de holgura */}
                {(() => {
                  const draft = audioDraft[beat.id] ?? {
                    dialogue: extractDialogue(beat.scenePrompt),
                    durationS: beat.durationS,
                    voiceTone: beat.voiceTone ?? '',
                  };
                  const words = countWords(draft.dialogue);
                  const needed = estimateSpeechSeconds(draft.dialogue, language);
                  const { level, suggestedDurationS } = fitVerdict(needed, draft.durationS);
                  // Fase 2 audio (2026-07-13): 'roomy' YA NO es "natural/bueno" — un
                  // clip mucho más largo que su línea hace que Seedance arrastre la voz
                  // y meta pausas ("plano y lento"). El punto bueno es 'ok' (suficiente
                  // aire sin exceso); 'roomy' con sugerencia menor = aviso de recortar.
                  const tooLong = level === 'roomy' && suggestedDurationS < draft.durationS;
                  const meter =
                    words === 0
                      ? { text: 'Sin diálogo', cls: 'text-muted-foreground' }
                      : level === 'tight'
                        ? {
                            text: `Muy ajustado: ~${needed.toFixed(1)}s para ${words} palabras · sube a ${suggestedDurationS}s o acorta`,
                            cls: 'text-red-500',
                          }
                        : tooLong
                          ? {
                              text: `Largo para la voz: puede arrastrarse · baja a ~${suggestedDurationS}s`,
                              cls: 'text-amber-500',
                            }
                          : { text: 'Natural', cls: 'text-emerald-500' };
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
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          value={draft.voiceTone}
                          aria-label={`Tono de la escena ${beat.sceneIndex + 1}`}
                          onChange={(e) =>
                            setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, voiceTone: e.target.value } }))
                          }
                          placeholder="Tono / entrega (opcional) — ej. cálido, entusiasta"
                          maxLength={80}
                          className="min-w-0 rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                        />
                        <div className="flex flex-wrap gap-1">
                          {VOICE_TONE_LABELS.map((label) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() =>
                                setAudioDraft((prev) => ({ ...prev, [beat.id]: { ...draft, voiceTone: label } }))
                              }
                              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
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
