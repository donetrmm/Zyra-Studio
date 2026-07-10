'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2, Mic, Pause, Play, Plus, RotateCcw, Trash2, Upload, Volume2 } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PageEmptyState } from '@/components/ui/page-empty-state';
import { Button } from '@/components/ui/button';
import { AssetPageHeader } from '@/components/assets/AssetPageHeader';
import { ReadinessChip } from '@/components/assets/AssetCard';
import { toast } from 'sonner';
import { cloneVoiceAction, deleteVoiceAction, tryVoiceAction, uploadVoiceAction } from '@/server-actions/voices';
import { cn } from '@/lib/utils';

type VoiceRow = {
  id: string;
  name: string;
  description: string | null;
  elevenlabs_voice_id: string | null;
  // Voz CARGADA (no clonada): audio subido tal cual. sampleUrl = URL firmada
  // para reproducirlo. Las clonadas traen elevenlabs_voice_id y no sampleUrl.
  sample_storage_url?: string | null;
  sampleUrl?: string | null;
  status: string;
  created_at: string;
};

export function VoicesPage({ voices: initial }: { voices: VoiceRow[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [voices, setVoices] = useState(initial);
  // Re-sincroniza tras router.refresh(): ajuste de estado durante render,
  // no en effect (react.dev/learn/you-might-not-need-an-effect).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setVoices(initial);
  }
  const [showClone, setShowClone] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [tryingId, setTryingId] = useState<string | null>(null);
  const [tryText, setTryText] = useState('Hola, esta es mi voz clonada en 1to1 Studio.');
  const [tryAudio, setTryAudio] = useState<string | null>(null);
  const [cloning, startClone] = useTransition();
  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [trying, startTry] = useTransition();

  function handleClone(formData: FormData) {
    startClone(async () => {
      const res = await cloneVoiceAction(formData);
      if (!res.ok) {
        toast.error(res.message || 'Error al clonar voz');
        return;
      }
      toast.success('Voz clonada');
      setShowClone(false);
      router.refresh();
    });
  }

  function handleUpload(formData: FormData) {
    startUpload(async () => {
      const res = await uploadVoiceAction(formData);
      if (!res.ok) {
        toast.error(res.message || 'Error al cargar la voz');
        return;
      }
      toast.success('Voz cargada');
      setShowUpload(false);
      router.refresh();
    });
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({ title: `Eliminar "${name}"?`, description: 'Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', destructive: true });
    if (!ok) return;
    startDelete(async () => {
      const res = await deleteVoiceAction(id);
      if (!res.ok) {
        toast.error(res.message || 'Error al eliminar');
        return;
      }
      setVoices((v) => v.filter((x) => x.id !== id));
      toast.success('Voz eliminada');
    });
  }

  function handleTry(voiceId: string) {
    setTryingId(voiceId);
    setTryAudio(null);
  }

  function submitTry() {
    if (!tryingId) return;
    startTry(async () => {
      const res = await tryVoiceAction({ voiceId: tryingId, text: tryText });
      if (!res.ok) {
        toast.error(res.message || 'Error al generar audio');
        return;
      }
      setTryAudio(`data:audio/mpeg;base64,${res.data.audioBase64}`);
    });
  }

  return (
    <div>
      <AssetPageHeader
        title="Mis voces"
        description="Clona voces desde samples de audio para texto a voz, o carga un audio ya terminado (hecho aquí o en otra herramienta) para tenerlo en tu biblioteca."
        badge={
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-2xs font-medium text-amber-400">
            <FlaskConical className="size-3" aria-hidden />
            Experimental
          </span>
        }
        notice={
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-2xs font-medium text-emerald-400">
            Gratis por tiempo limitado
          </div>
        }
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => { setShowUpload(true); setShowClone(false); }}>
              <Upload className="size-4" aria-hidden />
              Cargar audio
            </Button>
            <Button type="button" onClick={() => { setShowClone(true); setShowUpload(false); }}>
              <Plus className="size-4" aria-hidden />
              Clonar voz
            </Button>
          </>
        }
      />

      {/* Upload dialog: voz cargada tal cual (sin clonar) */}
      {showUpload && (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-5 py-3.5">
            <h2 className="text-[15px] font-medium text-foreground">Cargar una voz</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Sube un audio ya terminado. Queda en tu biblioteca y se puede reproducir. No genera texto a voz (para eso, clónala). MP3, WAV, M4A u OGG.
            </p>
          </div>
          <form action={handleUpload} className="space-y-3 p-5">
            <div>
              <label htmlFor="upload-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nombre</label>
              <input
                id="upload-name"
                name="name"
                required
                placeholder="Ej: Locución producto"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <label htmlFor="upload-description" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descripción (opcional)</label>
              <input
                id="upload-description"
                name="description"
                placeholder="Ej: Voz femenina, tono cálido"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <label htmlFor="upload-file" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Audio</label>
              <input
                id="upload-file"
                name="file"
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/webm,audio/ogg,audio/mp4,audio/x-m4a,audio/m4a,audio/aac"
                required
                className="mt-1 w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-primary file:cursor-pointer"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Un archivo, hasta 50 MB</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {uploading ? 'Cargando...' : 'Cargar voz'}
              </button>
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Clone dialog */}
      {showClone && (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-5 py-3.5">
            <h2 className="text-[15px] font-medium text-foreground">Nueva voz clonada</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Sube audio limpio sin música de fondo. MP3, WAV o M4A.
            </p>
          </div>
          <form action={handleClone} className="space-y-3 p-5">
            <div>
              <label htmlFor="voice-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nombre</label>
              <input
                id="voice-name"
                name="name"
                required
                placeholder="Ej: Narrador principal"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <label htmlFor="voice-description" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descripción (opcional)</label>
              <input
                id="voice-description"
                name="description"
                placeholder="Ej: Voz masculina grave, tono calmado"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
            <div>
              <label htmlFor="voice-files" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Samples de audio</label>
              <input
                id="voice-files"
                name="files"
                type="file"
                accept="audio/*"
                multiple
                required
                className="mt-1 w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-primary file:cursor-pointer"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">1-2 minutos de audio por archivo</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={cloning}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cloning && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {cloning ? 'Clonando...' : 'Clonar voz'}
              </button>
              <button
                type="button"
                onClick={() => setShowClone(false)}
                className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Try voice dialog */}
      {tryingId && (
        <div className="mt-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.03]">
          <div className="border-b border-primary/10 bg-primary/5 px-5 py-3">
            <h2 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
              <Volume2 className="size-4 text-primary" aria-hidden />
              Probar voz
            </h2>
          </div>
          <div className="p-5">
            <textarea
              value={tryText}
              onChange={(e) => setTryText(e.target.value.slice(0, 500))}
              placeholder="Escribe el texto que quieres escuchar..."
              className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              rows={2}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={submitTry}
                disabled={trying || !tryText.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              >
                {trying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                {trying ? 'Generando...' : 'Generar'}
              </button>
              <button
                type="button"
                onClick={() => { setTryingId(null); setTryAudio(null); }}
                className="-m-1 rounded-sm p-1 text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Cerrar
              </button>
            </div>
            {tryAudio && <MiniPlayer src={tryAudio} className="mt-3" />}
          </div>
        </div>
      )}

      {/* Voice grid */}
      {voices.length === 0 && !showClone && !showUpload ? (
        <PageEmptyState
          icon={Mic}
          title="No tienes voces"
          sub="Clona una voz desde un sample de audio para texto a voz, o carga un audio ya terminado para tenerlo en tu biblioteca"
        />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {voices.map((v) => (
            <div
              key={v.id}
              className="group overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20"
            >
              <div className="flex items-center gap-3 border-b border-border/50 bg-muted/20 px-4 py-3">
                <div className="grid size-8 place-items-center rounded-full bg-primary/10">
                  <Mic className="size-3.5 text-primary" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[13.5px] font-medium text-foreground">{v.name}</h3>
                  {v.description && (
                    <p className="truncate text-[11px] text-muted-foreground/70">{v.description}</p>
                  )}
                </div>
                <span
                  className="shrink-0"
                  title={v.status === 'failed' ? 'El sample pudo tener ruido o música de fondo. Vuelve a clonar con audio limpio.' : undefined}
                >
                  <ReadinessChip
                    status={v.status === 'ready' ? 'ready' : v.status === 'failed' ? 'error' : 'processing'}
                    label={v.status === 'ready' ? 'Lista' : v.status === 'failed' ? 'Error' : 'Procesando'}
                  />
                </span>
              </div>

              <div className="flex items-center gap-2 p-3">
                {v.status === 'ready' && v.elevenlabs_voice_id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleTry(v.elevenlabs_voice_id!)}
                  >
                    <Play className="size-3.5" aria-hidden />
                    Probar
                  </Button>
                )}
                {v.status === 'failed' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setShowClone(true)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Volver a clonar
                  </Button>
                )}
                {/* Voz cargada: reproductor del audio subido (sin TTS). */}
                {!v.elevenlabs_voice_id && v.sampleUrl && (
                  <MiniPlayer src={v.sampleUrl} autoPlay={false} className="flex-1" />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => handleDelete(v.id, v.name)}
                  disabled={deleting}
                  aria-label={`Eliminar voz "${v.name}"`}
                  className="ml-auto shrink-0 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniPlayer({ src, autoPlay = true, className }: { src: string; autoPlay?: boolean; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // Autoplay solo cuando el player nace de una acción del usuario (probar voz);
    // en la lista de voces cargadas NO autoreproduce (serían varios a la vez).
    if (autoPlay) el.play().then(() => setPlaying(true)).catch(() => {});
    const onTime = () => {
      if (el.duration) setProgress(el.currentTime / el.duration);
    };
    const onEnd = () => { setPlaying(false); setProgress(0); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    return () => { el.pause(); el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', onEnd); };
  }, [src, autoPlay]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  }

  return (
    <div className={cn('flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5', className)}>
      <audio ref={audioRef} src={src} />
      <button type="button" onClick={toggle} className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        {playing ? <Pause className="size-3" aria-hidden /> : <Play className="ml-0.5 size-3" aria-hidden />}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Progreso del audio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        onClick={seek}
        onKeyDown={(e) => {
          const el = audioRef.current;
          if (!el || !el.duration) return;
          if (e.key === 'ArrowRight') { el.currentTime = Math.min(el.duration, el.currentTime + el.duration * 0.05); e.preventDefault(); }
          else if (e.key === 'ArrowLeft') { el.currentTime = Math.max(0, el.currentTime - el.duration * 0.05); e.preventDefault(); }
          else if (e.key === 'Home') { el.currentTime = 0; e.preventDefault(); }
          else if (e.key === 'End') { el.currentTime = el.duration; e.preventDefault(); }
        }}
        className="h-1.5 flex-1 cursor-pointer rounded-full bg-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
