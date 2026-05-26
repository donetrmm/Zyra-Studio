'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FlaskConical, Loader2, Mic, Pause, Play, Plus, Trash2, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { cloneVoiceAction, deleteVoiceAction, tryVoiceAction } from '@/server-actions/voices';
import { cn } from '@/lib/utils';

type VoiceRow = {
  id: string;
  name: string;
  description: string | null;
  elevenlabs_voice_id: string | null;
  status: string;
  created_at: string;
};

export function VoicesPage({ voices: initial }: { voices: VoiceRow[] }) {
  const router = useRouter();
  const [voices, setVoices] = useState(initial);
  const [showClone, setShowClone] = useState(false);
  const [tryingId, setTryingId] = useState<string | null>(null);
  const [tryText, setTryText] = useState('Hola, esta es mi voz clonada en Zyra Studio.');
  const [tryAudio, setTryAudio] = useState<string | null>(null);
  const [cloning, startClone] = useTransition();
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

  function handleDelete(id: string, name: string) {
    if (!confirm(`Eliminar la voz "${name}"?`)) return;
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
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-semibold text-foreground">Mis voces</h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              <FlaskConical className="size-3" aria-hidden />
              Experimental
            </span>
          </div>
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            Clona voces a partir de samples de audio para usarlas en la generación de texto a voz. Sube 1-2 minutos de audio limpio para mejores resultados.
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
            Gratis por tiempo limitado
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowClone(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Clonar voz
        </button>
      </div>

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
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nombre</label>
              <input
                name="name"
                required
                placeholder="Ej: Narrador principal"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descripcion (opcional)</label>
              <input
                name="description"
                placeholder="Ej: Voz masculina grave, tono calmado"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Samples de audio</label>
              <input
                name="files"
                type="file"
                accept="audio/*"
                multiple
                required
                className="mt-1 w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-primary file:cursor-pointer"
              />
              <p className="mt-1 text-[10.5px] text-muted-foreground/50">1-2 minutos de audio por archivo</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={cloning}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {cloning && <Loader2 className="size-3.5 animate-spin" />}
                {cloning ? 'Clonando...' : 'Clonar voz'}
              </button>
              <button
                type="button"
                onClick={() => setShowClone(false)}
                className="rounded-md border border-border px-4 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
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
              className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus:border-primary/40"
              rows={2}
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={submitTry}
                disabled={trying || !tryText.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {trying ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {trying ? 'Generando...' : 'Generar'}
              </button>
              <button
                type="button"
                onClick={() => { setTryingId(null); setTryAudio(null); }}
                className="text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                Cerrar
              </button>
            </div>
            {tryAudio && <MiniPlayer src={tryAudio} />}
          </div>
        </div>
      )}

      {/* Voice grid */}
      {voices.length === 0 && !showClone ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
          <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
            <Mic className="size-7" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/70">No tienes voces clonadas</p>
          <p className="max-w-xs text-[12.5px]">Clona tu primera voz subiendo un sample de audio para usarla en generacion de texto a voz</p>
        </div>
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
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                    v.status === 'ready'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : v.status === 'failed'
                        ? 'bg-red-500/10 text-red-400'
                        : 'bg-amber-500/10 text-amber-400',
                  )}
                >
                  {v.status === 'ready' ? 'Lista' : v.status === 'failed' ? 'Error' : 'Procesando'}
                </span>
              </div>

              <div className="flex gap-2 p-3">
                {v.status === 'ready' && v.elevenlabs_voice_id && (
                  <button
                    type="button"
                    onClick={() => handleTry(v.elevenlabs_voice_id!)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Play className="size-3.5" aria-hidden />
                    Probar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(v.id, v.name)}
                  disabled={deleting}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.play().then(() => setPlaying(true)).catch(() => {});
    const onTime = () => {
      if (el.duration) setProgress(el.currentTime / el.duration);
    };
    const onEnd = () => { setPlaying(false); setProgress(0); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    return () => { el.pause(); el.removeEventListener('timeupdate', onTime); el.removeEventListener('ended', onEnd); };
  }, [src]);

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
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <audio ref={audioRef} src={src} />
      <button type="button" onClick={toggle} className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        {playing ? <Pause className="size-3" aria-hidden /> : <Play className="ml-0.5 size-3" aria-hidden />}
      </button>
      <div className="h-1.5 flex-1 cursor-pointer rounded-full bg-border" onClick={seek}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
