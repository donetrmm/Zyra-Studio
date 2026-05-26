'use client';

import { useState, useTransition } from 'react';
import { Loader2, Mic, Plus, Trash2, Play } from 'lucide-react';
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
      window.location.reload();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">Mis voces</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Voces clonadas para usar en generación de audio
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowClone(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden />
          Clonar voz
        </button>
      </div>

      {/* Clone dialog */}
      {showClone && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <h2 className="text-[15px] font-medium text-foreground">Nueva voz clonada</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Sube 1-2 minutos de audio limpio (sin música de fondo). MP3, WAV o M4A.
          </p>
          <form
            action={handleClone}
            className="mt-4 space-y-3"
          >
            <input
              name="name"
              required
              placeholder="Nombre de la voz"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none"
            />
            <input
              name="description"
              placeholder="Descripción (opcional)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none"
            />
            <input
              name="files"
              type="file"
              accept="audio/*"
              multiple
              required
              className="w-full text-[12.5px] text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-primary"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={cloning}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {cloning && <Loader2 className="size-3.5 animate-spin" />}
                {cloning ? 'Clonando...' : 'Clonar'}
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
        <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-5">
          <h2 className="text-[14px] font-medium text-foreground">Probar voz</h2>
          <textarea
            value={tryText}
            onChange={(e) => setTryText(e.target.value.slice(0, 500))}
            className="mt-3 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none"
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
            {tryAudio && (
              <audio controls autoPlay src={tryAudio} className="h-8 flex-1" />
            )}
          </div>
        </div>
      )}

      {/* Voice grid */}
      {voices.length === 0 && !showClone ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted-foreground/60">
          <Mic className="size-12" aria-hidden />
          <p className="text-[14px]">No tienes voces clonadas</p>
          <p className="text-[12.5px]">Clona tu primera voz para usarla en generación de audio</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {voices.map((v) => (
            <div
              key={v.id}
              className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-muted-foreground/20"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-medium text-foreground">{v.name}</h3>
                  {v.description && (
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{v.description}</p>
                  )}
                </div>
                <span
                  className={cn(
                    'ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
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

              <div className="mt-4 flex gap-2">
                {v.status === 'ready' && v.elevenlabs_voice_id && (
                  <button
                    type="button"
                    onClick={() => handleTry(v.elevenlabs_voice_id!)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Play className="size-3" aria-hidden />
                    Probar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(v.id, v.name)}
                  disabled={deleting}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
