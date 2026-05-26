'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Loader2, Lock, Sparkles, Trash2, Play, ImageIcon, Video, Mic } from 'lucide-react';
import { toast } from 'sonner';
import { deletePresetAction, usePresetAction } from '@/server-actions/presets';
import { cn } from '@/lib/utils';

type PresetRow = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  params: Record<string, unknown>;
  is_public: boolean;
  uses_count: number;
  created_at: string;
  user_id?: string;
};

const TYPE_ICON = { image: ImageIcon, video: Video, audio: Mic } as const;
const TYPE_LABEL = { image: 'Imagen', video: 'Video', audio: 'Audio' } as const;

export function PresetsPage({
  userId,
  myPresets: initialMy,
  publicPresets: initialPublic,
}: {
  userId: string;
  myPresets: PresetRow[];
  publicPresets: PresetRow[];
}) {
  const [tab, setTab] = useState<'mine' | 'community'>('community');
  const [myPresets, setMyPresets] = useState(initialMy);
  const publicPresets = initialPublic;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-8">
      <div>
        <h1 className="text-[18px] font-semibold text-foreground">Presets</h1>
        <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
          Configuraciones reutilizables para generaciones. Publica los tuyos para que otros los usen, o explora los de la comunidad.
        </p>
      </div>

      <div className="mt-5 flex gap-1 rounded-lg bg-muted/30 p-1">
        {(['community', 'mine'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === t
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'community' ? 'Comunidad' : 'Mis presets'}
          </button>
        ))}
      </div>

      {tab === 'community' ? (
        publicPresets.length === 0 ? (
          <EmptyState message="No hay presets públicos aún" sub="Publica uno de tus presets para que aparezca aquí" />
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {publicPresets.map((p) => (
              <PresetCard key={p.id} preset={p} owned={p.user_id === userId} onDelete={(id) => setMyPresets((ps) => ps.filter((x) => x.id !== id))} />
            ))}
          </div>
        )
      ) : myPresets.length === 0 ? (
        <EmptyState message="No tienes presets" sub="Genera contenido y guárdalo como preset desde la biblioteca" />
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {myPresets.map((p) => (
            <PresetCard key={p.id} preset={p} owned onDelete={(id) => setMyPresets((ps) => ps.filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetCard({ preset, owned, onDelete }: { preset: PresetRow; owned: boolean; onDelete: (id: string) => void }) {
  const router = useRouter();
  const [using, startUse] = useTransition();
  const [deleting, startDelete] = useTransition();
  const Icon = TYPE_ICON[preset.type as keyof typeof TYPE_ICON] ?? Sparkles;
  const label = TYPE_LABEL[preset.type as keyof typeof TYPE_LABEL] ?? preset.type;

  function handleUse() {
    startUse(async () => {
      const res = await usePresetAction(preset.id);
      if (!res.ok) { toast.error('No se pudo cargar el preset'); return; }
      const params = new URLSearchParams();
      if (res.data.params.prompt) params.set('prompt', String(res.data.params.prompt));
      router.push(`/app/create/${res.data.type}?${params.toString()}`);
    });
  }

  function handleDelete() {
    if (!confirm(`Eliminar "${preset.name}"?`)) return;
    startDelete(async () => {
      const res = await deletePresetAction(preset.id);
      if (res.ok) { onDelete(preset.id); toast.success('Preset eliminado'); }
      else toast.error(res.message || 'Error');
    });
  }

  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20">
      <div className="flex items-center gap-3 border-b border-border/50 bg-muted/20 px-4 py-3">
        <div className="grid size-8 place-items-center rounded-full bg-primary/10">
          <Icon className="size-3.5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-medium text-foreground">{preset.name}</h3>
          <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground/60">
            <span>{label}</span>
            <span>{preset.is_public ? <Globe className="inline size-3" /> : <Lock className="inline size-3" />}</span>
            {preset.uses_count > 0 && <span>{preset.uses_count} usos</span>}
          </div>
        </div>
      </div>
      {preset.description && (
        <p className="border-b border-border/30 px-4 py-2 text-[11.5px] text-muted-foreground/70">{preset.description}</p>
      )}
      <div className="flex gap-2 p-3">
        <button
          type="button"
          onClick={handleUse}
          disabled={using}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {using ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Usar
        </button>
        {owned && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center text-muted-foreground/60">
      <div className="grid size-16 place-items-center rounded-2xl border border-border bg-muted/30">
        <Sparkles className="size-7" aria-hidden />
      </div>
      <p className="text-[14px] text-foreground/70">{message}</p>
      <p className="max-w-xs text-[12.5px]">{sub}</p>
    </div>
  );
}
