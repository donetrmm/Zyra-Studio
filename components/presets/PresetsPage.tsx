'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Download,
  Globe,
  ImageIcon,
  Loader2,
  Lock,
  Mic,
  Play,
  Search,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
// Alias: el action se llama usePresetAction pero no es un hook, y la regla
// rules-of-hooks se dispara por el prefijo "use".
import { deletePresetAction, usePresetAction as applyPresetAction } from '@/server-actions/presets';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { downloadGenerationImage as downloadFile } from '@/lib/media-references/download-client';
import { WavePlayer } from '@/components/generation/WavePlayer';
import { PageEmptyState } from '@/components/ui/page-empty-state';
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
const TYPE_FILTERS = ['all', 'image', 'video', 'audio'] as const;

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
  // Re-sincroniza tras router.refresh(): ajuste de estado durante render,
  // no en effect (react.dev/learn/you-might-not-need-an-effect).
  const [prevInitialMy, setPrevInitialMy] = useState(initialMy);
  if (prevInitialMy !== initialMy) {
    setPrevInitialMy(initialMy);
    setMyPresets(initialMy);
  }
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>('all');
  const [preview, setPreview] = useState<PresetRow | null>(null);

  const filtered = useMemo(() => {
    const list = tab === 'community' ? initialPublic : myPresets;
    return list.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false) ||
          (String(p.params.prompt ?? '').toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [tab, initialPublic, myPresets, query, typeFilter]);

  return (
    <div className="mx-auto max-w-4xl">
      <div>
        <h1 className="text-[18px] font-semibold text-foreground">Presets</h1>
        <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
          Configuraciones reutilizables. Publica los tuyos para que otros los usen, o explora los de la comunidad.
        </p>
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 rounded-[10px] border border-border bg-muted/30 p-[3px]">
        {(['community', 'mine'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              tab === t
                ? 'border border-border bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'community' ? 'Comunidad' : 'Mis presets'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar presets..."
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex gap-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setTypeFilter(f)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                typeFilter === f
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? 'Todos' : TYPE_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <PageEmptyState
          icon={Sparkles}
          title={query ? 'Sin resultados' : 'No hay presets'}
          sub={
            query
              ? 'Intenta con otro término o limpia la búsqueda.'
              : tab === 'community'
                ? 'Aún no hay presets públicos. Publica uno tuyo desde la biblioteca para empezar.'
                : 'Guarda una generación como preset desde la biblioteca para reutilizarla aquí.'
          }
          cta={
            tab === 'mine'
              ? { href: '/app/library', label: 'Ir a la biblioteca', icon: Sparkles }
              : undefined
          }
        />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              owned={p.user_id === userId}
              onDelete={(id) => setMyPresets((ps) => ps.filter((x) => x.id !== id))}
              onPreview={() => setPreview(p)}
            />
          ))}
        </div>
      )}

      {/* Preview modal */}
      {preview && <PreviewModal preset={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function PresetCard({
  preset,
  owned,
  onDelete,
  onPreview,
}: {
  preset: PresetRow;
  owned: boolean;
  onDelete: (id: string) => void;
  onPreview: () => void;
}) {
  const router = useRouter();
  const [using, startUse] = useTransition();
  const confirm = useConfirm();
  const [deleting, startDelete] = useTransition();
  const Icon = TYPE_ICON[preset.type as keyof typeof TYPE_ICON] ?? Sparkles;
  const label = TYPE_LABEL[preset.type as keyof typeof TYPE_LABEL] ?? preset.type;
  const thumbnailUrl = preset.params.thumbnailUrl as string | undefined;
  const prompt = preset.params.prompt as string | undefined;

  function handleUse() {
    startUse(async () => {
      const res = await applyPresetAction(preset.id);
      if (!res.ok) { toast.error('No se pudo cargar el preset'); return; }
      const params = new URLSearchParams();
      if (res.data.params.prompt) params.set('prompt', String(res.data.params.prompt));
      router.push(`/app/create/${res.data.type}?${params.toString()}`);
    });
  }

  async function handleDelete() {
    const ok = await confirm({ title: `Eliminar "${preset.name}"?`, description: 'El preset se eliminara permanentemente.', confirmLabel: 'Eliminar', destructive: true });
    if (!ok) return;
    startDelete(async () => {
      const res = await deletePresetAction(preset.id);
      if (res.ok) { onDelete(preset.id); toast.success('Preset eliminado'); }
      else toast.error(res.message || 'Error');
    });
  }

  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-card/50 transition-colors hover:border-muted-foreground/20">
      {/* Preview area — clickable */}
      <button type="button" onClick={onPreview} className="relative block w-full text-left">
        {thumbnailUrl ? (
          <div className="relative aspect-video overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnailUrl} alt={preset.name} className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
          </div>
        ) : (
          <div className="grid aspect-video place-items-center bg-muted/20">
            <Icon className="size-8 text-muted-foreground/30" aria-hidden />
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur">
          <Icon className="size-3" aria-hidden />
          {label}
        </div>
        {preset.is_public && (
          <div className="absolute right-2 top-2 rounded-full bg-primary/80 px-2 py-0.5 text-[11px] font-medium text-primary-foreground backdrop-blur">
            Público
          </div>
        )}
      </button>

      {/* Info */}
      <div className="px-4 py-3">
        <h3 className="truncate text-[13.5px] font-medium text-foreground">{preset.name}</h3>
        {prompt && (
          <p className="mt-1 line-clamp-2 text-[11.5px] text-muted-foreground/70">{prompt}</p>
        )}
        {preset.uses_count > 0 && (
          <div className="mt-1.5 font-mono text-[11px] text-muted-foreground/70">
            {preset.uses_count} usos
          </div>
        )}
      </div>

      {/* Actions: PrimaryGhost style consistente con el resto de la app. */}
      <div className="flex gap-2 border-t border-border/30 p-3">
        <button
          type="button"
          onClick={handleUse}
          disabled={using}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {using ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Usar preset
        </button>
        {owned && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Eliminar preset"
            className="inline-flex size-10 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewModal({ preset, onClose }: { preset: PresetRow; onClose: () => void }) {
  const router = useRouter();
  const [using, startUse] = useTransition();
  const [downloading, setDownloading] = useState(false);
  const thumbnailUrl = preset.params.thumbnailUrl as string | undefined;
  const prompt = preset.params.prompt as string | undefined;
  const modelName = preset.params.model as string | undefined;
  const aspectRatio = preset.params.aspectRatio as string | undefined;
  const Icon = TYPE_ICON[preset.type as keyof typeof TYPE_ICON] ?? Sparkles;
  const label = TYPE_LABEL[preset.type as keyof typeof TYPE_LABEL] ?? preset.type;

  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/presets/${preset.id}/media`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string; thumbnailUrl?: string } | null) => {
        if (!active) return;
        setOutputUrl(data?.outputUrl ?? data?.thumbnailUrl ?? null);
        setLoadingMedia(false);
      })
      .catch(() => { if (active) setLoadingMedia(false); });
    return () => { active = false; };
  }, [preset.id]);

  const mediaUrl = outputUrl ?? thumbnailUrl;

  function handleUse() {
    startUse(async () => {
      const res = await applyPresetAction(preset.id);
      if (!res.ok) { toast.error('No se pudo cargar'); return; }
      const params = new URLSearchParams();
      if (res.data.params.prompt) params.set('prompt', String(res.data.params.prompt));
      router.push(`/app/create/${res.data.type}?${params.toString()}`);
      onClose();
    });
  }

  async function handleDownload() {
    const url = outputUrl;
    if (!url) return;
    setDownloading(true);
    try {
      await downloadFile(url, `1to1-preset`);
    } catch {
      toast.error('No se pudo descargar');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="scroll-thin mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Media */}
        <div className="relative bg-black">
          {loadingMedia ? (
            <div className="grid aspect-video place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : mediaUrl ? (
            preset.type === 'video' ? (
              <video controls autoPlay muted playsInline src={mediaUrl} className="max-h-[50vh] w-full object-contain" />
            ) : preset.type === 'audio' ? (
              <div className="bg-card p-4">
                <WavePlayer src={mediaUrl} />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl} alt={preset.name} className="max-h-[50vh] w-full object-contain" />
            )
          ) : (
            <div className="grid aspect-video place-items-center text-muted-foreground/40">
              <Icon className="size-10" aria-hidden />
            </div>
          )}
        </div>

        {/* Details */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">{preset.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground/70">
                <span className="inline-flex items-center gap-1">
                  <Icon className="size-3" />
                  {label}
                </span>
                {modelName && <span>{modelName}</span>}
                {aspectRatio && <span>{aspectRatio}</span>}
                <span className="inline-flex items-center gap-1">
                  {preset.is_public ? <Globe className="size-3" /> : <Lock className="size-3" />}
                  {preset.is_public ? 'Público' : 'Privado'}
                </span>
                {preset.uses_count > 0 && <span>{preset.uses_count} usos</span>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {preset.description && (
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{preset.description}</p>
          )}

          {prompt && (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                Prompt
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground">{prompt}</p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleUse}
              disabled={using}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {using ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Usar preset
            </button>
            {outputUrl && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Descargar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

