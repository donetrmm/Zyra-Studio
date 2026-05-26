'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Image as ImageIcon,
  Layers,
  Library,
  Loader2,
  Music,
  RotateCcw,
  Search,
  Sparkles,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadGenerationImage as downloadGenerationFile } from '@/lib/media-references/download-client';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';

export type LibraryGeneration = {
  id: string;
  type: string;
  provider: string;
  model: string;
  prompt: string;
  status: string;
  thumbnailUrl: string | null;
  hasOutput: boolean;
  credits: number;
  createdAt: string;
  parentGenerationId: string | null;
  batchId: string | null;
  batchKind: string | null;
  aspectRatio: string | null;
};

export type LibraryReference = {
  id: string;
  type: string;
  storagePath: string;
  name: string | null;
  source: string;
  createdAt: string;
  previewUrl: string | null;
};

type Tab = 'sessions' | 'grid' | 'references';
type SortKey = 'recent' | 'old';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[] = [
  { id: 'sessions', label: 'Sesiones', icon: Library },
  { id: 'grid', label: 'Cuadrícula', icon: ImageIcon },
  { id: 'references', label: 'Referencias', icon: Sparkles },
];

const MODEL_LABEL: Record<string, string> = {
  'gemini-3-pro-image-preview': 'Nano Banana Pro',
  'gemini-3.1-flash-image-preview': 'Nano Flash',
  'flux-2-pro-preview': 'FLUX 2 Pro',
};

function modelLabel(g: { provider: string; model: string }): string {
  return MODEL_LABEL[g.model] ?? `${g.provider}/${g.model}`;
}

// Mapeo modelo provider -> ModelKey usado por el create page.
// Si no matchea (modelo legacy o eliminado), cae a 'auto' y deja que
// el router decida.
function generationToModelKey(g: { provider: string; model: string }): string {
  if (g.provider === 'flux') return 'flux';
  if (g.model === 'gemini-3.1-flash-image-preview') return 'nano-flash';
  if (g.model === 'gemini-3-pro-image-preview') return 'nano-pro';
  return 'auto';
}

function batchLabel(kind: string): string {
  switch (kind) {
    case 'storyboard': return 'SB';
    case 'variations': return 'VAR';
    case 'smart_crop': return 'CROP';
    default: return 'BATCH';
  }
}

function reuseHref(g: LibraryGeneration): string {
  const params = new URLSearchParams();
  if (g.prompt) params.set('prompt', g.prompt);
  if (g.aspectRatio) params.set('aspect', g.aspectRatio);
  params.set('model', generationToModelKey(g));
  const base =
    g.type === 'video' ? '/app/create/video'
    : g.type === 'audio' ? '/app/create/audio'
    : '/app/create/image';
  return `${base}?${params.toString()}`;
}

function bucketOf(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const t = date.getTime();
  if (t >= today0) return 'Hoy';
  if (t >= today0 - dayMs) return 'Ayer';
  if (t >= today0 - 7 * dayMs) return 'Esta semana';
  if (date.getFullYear() === now.getFullYear()) {
    const m = date.toLocaleString('es-MX', { month: 'long' });
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  return `${date.toLocaleString('es-MX', { month: 'short' })} ${date.getFullYear()}`;
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const t = date.getTime();
  const hhmm = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (t >= today0) return `Hoy · ${hhmm}`;
  if (t >= today0 - dayMs) return `Ayer · ${hhmm}`;
  if (t >= today0 - 7 * dayMs) {
    return date.toLocaleDateString('es-MX', { weekday: 'short' }) + ` · ${hhmm}`;
  }
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

type Session = {
  id: string;
  items: LibraryGeneration[];
  head: LibraryGeneration;
  latest: LibraryGeneration;
};

function groupSessions(gens: LibraryGeneration[], sort: SortKey): Session[] {
  // Para cadenas conversacionales A→B→C→D, el bucket es la RAÍZ del hilo (A),
  // no el parent inmediato. Iteramos hacia atrás hasta encontrar un item sin
  // parent (o uno cuyo parent no esté en la lista visible). El guard `visited`
  // evita loops en caso de datos corruptos con ciclos.
  const byId = new Map(gens.map((g) => [g.id, g]));
  function rootOf(g: LibraryGeneration): string {
    let cur = g;
    const visited = new Set<string>([cur.id]);
    while (cur.parentGenerationId) {
      const parent = byId.get(cur.parentGenerationId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      cur = parent;
    }
    return cur.id;
  }

  const map = new Map<string, LibraryGeneration[]>();
  for (const g of gens) {
    const key = rootOf(g);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(g);
  }
  const sessions: Session[] = [];
  for (const [id, items] of map.entries()) {
    // Dentro de la sesión las variaciones van siempre cronológicas (v1, v2…),
    // independientemente del sort externo.
    items.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const head = items.find((i) => i.id === id) ?? items[0];
    const latest = items[items.length - 1];
    sessions.push({ id, items, head, latest });
  }
  sessions.sort((a, b) => {
    const ta = new Date(a.latest.createdAt).getTime();
    const tb = new Date(b.latest.createdAt).getTime();
    return sort === 'old' ? ta - tb : tb - ta;
  });
  return sessions;
}

export function LibraryView({
  generations,
  references,
  workspaceName,
}: {
  generations: LibraryGeneration[];
  references: LibraryReference[];
  workspaceName: string;
}) {
  const [tab, setTab] = useState<Tab>('sessions');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  }

  const filteredGens = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = generations;
    if (needle) {
      list = list.filter(
        (g) =>
          g.prompt.toLowerCase().includes(needle) ||
          modelLabel(g).toLowerCase().includes(needle),
      );
    }
    if (sort === 'old') {
      list = [...list].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }
    return list;
  }, [generations, query, sort]);

  const sessions = useMemo(() => groupSessions(filteredGens, sort), [filteredGens, sort]);
  const active = useMemo(
    () => generations.find((g) => g.id === activeId) ?? null,
    [generations, activeId],
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col bg-background">
      <LibHeader
        tab={tab}
        setTab={setTab}
        query={query}
        setQuery={setQuery}
        sort={sort}
        setSort={setSort}
        totalImages={generations.length}
        totalSessions={sessions.length}
        totalRefs={references.length}
        workspaceName={workspaceName}
      />

      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-4 pb-16 pt-1 sm:px-6">
          {tab === 'sessions' && (
            <SessionsTab sessions={sessions} onOpen={setActiveId} />
          )}
          {tab === 'grid' && (
            <GridTab items={filteredGens} onOpen={setActiveId} compareIds={compareIds} onToggleCompare={toggleCompare} />
          )}
          {tab === 'references' && <ReferencesTab references={references} />}
        </div>

        {active && (
          <>
            <div
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
              onClick={() => setActiveId(null)}
            />
            <DetailAside
              key={active.id}
              generation={active}
              allGenerations={generations}
              onClose={() => setActiveId(null)}
              onNavigate={setActiveId}
            />
          </>
        )}
      </div>

      {compareIds.size >= 2 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-primary/40 bg-card px-5 py-2.5 shadow-xl">
          <span className="text-[13px] text-foreground">{compareIds.size} seleccionados</span>
          <button
            type="button"
            onClick={() => setShowCompare(true)}
            className="rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Comparar A/B
          </button>
          <button
            type="button"
            onClick={() => setCompareIds(new Set())}
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Limpiar
          </button>
        </div>
      )}

      {showCompare && (
        <CompareModal
          generations={generations.filter((g) => compareIds.has(g.id))}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}

const CROP_FORMATS = [
  { ratio: '1:1', label: '1:1' },
  { ratio: '9:16', label: '9:16' },
  { ratio: '16:9', label: '16:9' },
  { ratio: '4:5', label: '4:5' },
] as const;

function SmartCropButtons({ prompt, currentAspect }: { prompt: string; currentAspect: string | null }) {
  const others = CROP_FORMATS.filter((f) => f.ratio !== currentAspect);
  return (
    <div className="flex flex-wrap gap-1.5">
      {others.map((f) => (
        <Link
          key={f.ratio}
          href={`/app/create/image?prompt=${encodeURIComponent(`Recreate this exact scene in ${f.ratio} format, maintaining the main subject centered. Original: ${prompt}`)}&aspect=${f.ratio}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground"
        >
          Crop {f.label}
        </Link>
      ))}
    </div>
  );
}

function CompareModal({
  generations,
  onClose,
}: {
  generations: LibraryGeneration[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-4 max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-foreground">Comparador A/B</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className={cn('grid gap-4', generations.length === 2 ? 'grid-cols-2' : generations.length === 3 ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-4')}>
          {generations.map((g) => (
            <div key={g.id} className="space-y-2">
              <div className="overflow-hidden rounded-lg border border-border bg-black">
                {g.thumbnailUrl ? (
                  g.type === 'video' ? (
                    <video src={g.thumbnailUrl} controls muted playsInline className="w-full" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.thumbnailUrl} alt={g.prompt} className="w-full object-contain" />
                  )
                ) : (
                  <div className="grid h-40 place-items-center text-muted-foreground/50">Sin preview</div>
                )}
              </div>
              <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">{g.prompt}</p>
              <p className="text-[10px] text-muted-foreground/50">{modelLabel(g)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LibHeader({
  tab,
  setTab,
  query,
  setQuery,
  sort,
  setSort,
  totalImages,
  totalSessions,
  totalRefs,
  workspaceName,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  totalImages: number;
  totalSessions: number;
  totalRefs: number;
  workspaceName: string;
}) {
  const sortLabel = sort === 'recent' ? 'recientes' : 'antiguos';
  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-3 pt-5">
        <div>
          <h1 className="font-heading text-[22px] font-medium tracking-tight text-foreground">
            Biblioteca
          </h1>
          <div className="mt-1 text-[12.5px] text-muted-foreground/80">
            <span className="font-mono tabular-nums">{totalImages.toLocaleString('es-MX')}</span>{' '}
            imágenes ·{' '}
            <span className="font-mono tabular-nums">{totalSessions}</span> sesiones ·{' '}
            <span className="font-mono tabular-nums">{totalRefs}</span> refs · ordenado por{' '}
            {sortLabel} · {workspaceName}
          </div>
        </div>
        <Link
          href="/app/create/image"
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15"
        >
          <Sparkles className="size-3.5" aria-hidden /> Crear imagen
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3">
        <div className="inline-flex gap-0.5 rounded-[10px] border border-border bg-muted/30 p-[3px]">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Ic = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'border border-border bg-background text-foreground'
                    : 'border border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Ic className="size-3.5" aria-hidden />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 lg:max-w-[540px]">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por prompt o modelo…"
              className="h-9 w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 text-[13px] text-foreground outline-none transition-colors focus:border-primary/40"
            />
          </div>
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-9 appearance-none rounded-lg border border-border bg-muted/30 pl-3 pr-8 text-[12.5px] text-foreground outline-none focus:border-primary/40"
            >
              <option value="recent">Más recientes</option>
              <option value="old">Más antiguos</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionsTab({
  sessions,
  onOpen,
}: {
  sessions: Session[];
  onOpen: (id: string) => void;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const b = bucketOf(s.latest.createdAt);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(s);
    }
    return Array.from(map.entries());
  }, [sessions]);

  if (sessions.length === 0) {
    return <LibEmptyState tab="sessions" />;
  }

  return (
    <div className="space-y-2 pt-2">
      {buckets.map(([bucket, list]) => (
        <section key={bucket}>
          <BucketHeader name={bucket} count={list.length} />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {list.map((s) => (
              <SessionCard key={s.id} session={s} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GridTab({
  items,
  onOpen,
  compareIds,
  onToggleCompare,
}: {
  items: LibraryGeneration[];
  onOpen: (id: string) => void;
  compareIds: Set<string>;
  onToggleCompare: (id: string) => void;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, LibraryGeneration[]>();
    for (const g of items) {
      const b = bucketOf(g.createdAt);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(g);
    }
    return Array.from(map.entries());
  }, [items]);

  if (items.length === 0) {
    return <LibEmptyState tab="grid" />;
  }

  return (
    <div className="space-y-2 pt-2">
      {buckets.map(([bucket, list]) => (
        <section key={bucket}>
          <BucketHeader name={bucket} count={list.length} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {list.map((g) => (
              <LibTile key={g.id} gen={g} onClick={() => onOpen(g.id)} selected={compareIds.has(g.id)} onToggleCompare={() => onToggleCompare(g.id)} variantTag={g.batchKind ? batchLabel(g.batchKind) : undefined} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ReferencesTab({ references }: { references: LibraryReference[] }) {
  const buckets = useMemo(() => {
    const map = new Map<string, LibraryReference[]>();
    for (const r of references) {
      const b = bucketOf(r.createdAt);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(r);
    }
    return Array.from(map.entries());
  }, [references]);

  if (references.length === 0) {
    return <LibEmptyState tab="references" />;
  }

  return (
    <div className="space-y-2 pt-2">
      {buckets.map(([bucket, list]) => (
        <section key={bucket}>
          <BucketHeader name={bucket} count={list.length} />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {list.map((r) => (
              <ReferenceTile key={r.id} reference={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BucketHeader({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2.5 pb-3 pt-5">
      <span className="text-[11px] font-medium uppercase tracking-[0.10em] text-muted-foreground">
        {name}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground/60">{count}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function SessionCard({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (id: string) => void;
}) {
  const { head, latest, items } = session;
  return (
    <article className="zyra-fade-in overflow-hidden rounded-[14px] border border-border bg-card transition-colors hover:border-muted-foreground/20">
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13.5px] leading-[1.5] text-foreground">
            {head.prompt || <span className="text-muted-foreground">(sin prompt)</span>}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-[11px] text-muted-foreground/80">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-[5px] rounded-full bg-primary" />
              {modelLabel(head)}
            </span>
            {head.aspectRatio && <span>{head.aspectRatio}</span>}
            <span>−{items.reduce((sum, i) => sum + i.credits, 0)} cr.</span>
            <span>{items.length} variación{items.length === 1 ? '' : 'es'}</span>
            <span>{shortTime(latest.createdAt)}</span>
          </div>
        </div>
      </header>

      <div
        className={cn(
          'grid gap-2 px-4 pb-4',
          items.length === 1
            ? 'grid-cols-2 sm:grid-cols-3'
            : items.length === 2
              ? 'grid-cols-2 sm:grid-cols-3'
              : items.length === 3
                ? 'grid-cols-3'
                : 'grid-cols-2 sm:grid-cols-4',
        )}
      >
        {items.map((g, i) => (
          <LibTile
            key={g.id}
            gen={g}
            onClick={() => onOpen(g.id)}
            variantTag={items.length > 1 ? `v${i + 1}` : undefined}
            compact
          />
        ))}
      </div>
    </article>
  );
}

function LibTile({
  gen,
  onClick,
  variantTag,
  compact,
  selected,
  onToggleCompare,
}: {
  gen: LibraryGeneration;
  onClick: () => void;
  variantTag?: string;
  compact?: boolean;
  selected?: boolean;
  onToggleCompare?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [addingRef, startAddRef] = useTransition();

  // En modo compact (dentro de SessionCard) usamos aspect cuadrado para evitar
  // que las cards se vuelvan enormes con aspect ratios como 16:9.
  const aspect = compact ? '1:1' : (gen.aspectRatio ?? '1:1');
  const [w, h] = aspect.split(':').map(Number);
  const ratio = h > 0 ? w / h : 1;

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (!gen.hasOutput || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/generations/${gen.id}`, { cache: 'no-store' });
      const data = (await res.json()) as { outputUrl?: string };
      if (!data.outputUrl) throw new Error('sin output');
      await downloadGenerationFile(data.outputUrl, `zyra-${gen.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }

  function handleUseAsRef(e: React.MouseEvent) {
    e.stopPropagation();
    if (addingRef) return;
    startAddRef(async () => {
      const res = await addGenerationAsReferenceAction({ generationId: gen.id });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo usar como referencia');
        return;
      }
      toast.success('Agregada a tus referencias');
    });
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{ aspectRatio: String(ratio) }}
      className="zyra-fade-in group relative cursor-pointer overflow-hidden rounded-lg border border-transparent bg-muted/40 shadow-[0_4px_14px_-8px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-px hover:border-muted-foreground/20"
    >
      {gen.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={gen.thumbnailUrl}
          alt={gen.prompt}
          className="size-full object-cover"
        />
      ) : gen.type === 'audio' ? (
        <div className="grid h-full place-items-center bg-gradient-to-b from-primary/[0.07] via-primary/[0.03] to-transparent">
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-9 place-items-center rounded-full border border-primary/25 bg-primary/10">
              <Music className="size-4 text-primary/70" aria-hidden />
            </div>
            {/* Mini waveform decorativa */}
            <div className="flex h-3 items-end gap-[2px]">
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className="w-[2px] rounded-full bg-primary/30"
                  style={{ height: `${25 + 75 * Math.abs(Math.sin(i * 0.7 + 0.5))}%` }}
                />
              ))}
            </div>
            <span className="font-mono text-[9px] text-muted-foreground/50">
              {gen.status === 'done' ? 'Audio' : gen.status}
            </span>
          </div>
        </div>
      ) : gen.type === 'video' ? (
        <div className="grid h-full place-items-center bg-gradient-to-b from-primary/[0.07] via-primary/[0.03] to-transparent">
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-9 place-items-center rounded-full border border-primary/25 bg-primary/10">
              <VideoIcon className="size-4 text-primary/70" aria-hidden />
            </div>
            <span className="font-mono text-[9px] text-muted-foreground/50">
              {gen.status === 'done' ? 'Video' : gen.status}
            </span>
          </div>
        </div>
      ) : (
        <div className="grid h-full place-items-center text-[11px] text-muted-foreground/70">
          {gen.status}
        </div>
      )}

      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity',
          hover ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          background:
            'linear-gradient(180deg, transparent 50%, color-mix(in oklch, var(--background) 80%, transparent) 100%)',
        }}
      />

      {variantTag && (
        <div
          className={cn(
            'absolute bottom-2 left-2 rounded-full border border-border/40 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-foreground/85 backdrop-blur transition-opacity',
            hover ? 'opacity-100' : 'opacity-60',
          )}
        >
          {variantTag}
        </div>
      )}

      {hover && gen.hasOutput && (
        <div className="absolute right-2 bottom-2 flex gap-1">
          <TileBtn onClick={handleDownload} title="Descargar" busy={downloading}>
            <Download className="size-3" aria-hidden />
          </TileBtn>
        </div>
      )}
      {onToggleCompare && (hover || selected) && gen.status === 'done' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
          className={cn(
            'absolute left-2 top-2 grid size-5 place-items-center rounded border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-white/60 bg-background/60 backdrop-blur',
          )}
        >
          {selected && <Check className="size-3" aria-hidden />}
        </button>
      )}
    </div>
  );
}

function TileBtn({
  children,
  onClick,
  title,
  busy,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={busy}
      className="grid size-6 place-items-center rounded-md border border-border/40 bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background/90 disabled:cursor-not-allowed"
    >
      {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : children}
    </button>
  );
}

function ReferenceTile({ reference }: { reference: LibraryReference }) {
  return (
    <div
      title={reference.name ?? reference.type}
      className="zyra-fade-in relative aspect-square overflow-hidden rounded-lg border border-border bg-muted/40"
    >
      {reference.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reference.previewUrl}
          alt={reference.name ?? ''}
          className="size-full object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center px-2 text-center text-[10px] text-muted-foreground/70">
          {reference.name ?? reference.type}
        </div>
      )}
      {reference.source === 'generation' && (
        <div className="absolute left-1.5 top-1.5 rounded-full border border-border/40 bg-background/70 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground backdrop-blur">
          gen
        </div>
      )}
    </div>
  );
}

function DetailAside({
  generation,
  allGenerations,
  onClose,
  onNavigate,
}: {
  generation: LibraryGeneration;
  allGenerations: LibraryGeneration[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [addingRef, startAddRef] = useTransition();

  useEffect(() => {
    // Componente se remonta con key={generation.id} cuando cambia la selección,
    // así que loading inicia en true por estado inicial y solo hace falta fetch.
    let cancelled = false;
    fetch(`/api/generations/${generation.id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string } | null) => {
        if (!cancelled) {
          setOutputUrl(data?.outputUrl ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [generation.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const aspect = generation.aspectRatio ?? '1:1';
  const [w, h] = aspect.split(':').map(Number);
  const ratio = h > 0 ? w / h : 1;

  async function handleDownload() {
    if (!outputUrl || downloading) return;
    setDownloading(true);
    try {
      await downloadGenerationFile(outputUrl, `zyra-${generation.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }

  function handleUseAsRef() {
    if (addingRef) return;
    startAddRef(async () => {
      const res = await addGenerationAsReferenceAction({ generationId: generation.id });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo usar como referencia');
        return;
      }
      toast.success('Agregada a tus referencias');
    });
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(generation.prompt);
      toast.success('Prompt copiado');
    } catch {
      toast.error('No se pudo copiar el prompt');
    }
  }

  return (
    <aside className="zyra-fade-in fixed inset-y-0 right-0 z-50 flex w-[min(360px,85vw)] shrink-0 flex-col border-l border-border bg-card shadow-[-8px_0_30px_-10px_rgba(0,0,0,0.5)] lg:static lg:z-auto lg:w-[360px] lg:shadow-none">
      <header className="flex h-11 items-center justify-between border-b border-border px-4">
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          Detalle
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Cerrar (Esc)"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {generation.type === 'audio' ? (
          <div className="mb-3.5 overflow-hidden rounded-[14px] border border-border bg-gradient-to-b from-primary/[0.06] to-muted/40">
            {loading ? (
              <div className="grid h-[160px] place-items-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : outputUrl ? (
              <div className="flex flex-col items-center px-4 pb-4 pt-6">
                {/* Icono con glow */}
                <div className="relative mb-4">
                  <div className="absolute -inset-3 rounded-full bg-primary/20 blur-xl" />
                  <div className="relative grid size-14 place-items-center rounded-full border border-primary/30 bg-primary/10">
                    <Music className="size-6 text-primary" aria-hidden />
                  </div>
                </div>
                {/* Meta del audio */}
                <div className="mb-1 text-center text-[12px] font-medium text-foreground/80">
                  {modelLabel(generation)}
                </div>
                <div className="mb-4 font-mono text-[10.5px] text-muted-foreground/60">
                  {generation.credits > 0 && `−${generation.credits} cr · `}
                  {shortTime(generation.createdAt)}
                </div>
                {/* Onda decorativa estática */}
                <div className="mb-3 flex h-8 w-full items-end justify-center gap-[3px]">
                  {Array.from({ length: 32 }, (_, i) => {
                    const h = 20 + 80 * Math.abs(Math.sin((i * 0.45) + 1.2)) * Math.sin((i * 0.12) + 0.8);
                    return (
                      <div
                        key={i}
                        className="w-[3px] rounded-full bg-primary/40"
                        style={{ height: `${h}%` }}
                      />
                    );
                  })}
                </div>
                <MiniAudioPlayer src={outputUrl} />
              </div>
            ) : (
              <div className="grid h-[160px] place-items-center text-[12px] text-muted-foreground">
                Sin audio
              </div>
            )}
          </div>
        ) : generation.type === 'video' ? (
          <div className="mb-3.5 overflow-hidden rounded-lg border border-border bg-muted/40">
            {loading ? (
              <div className="grid place-items-center" style={{ aspectRatio: String(ratio) }}>
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : outputUrl ? (
              <video
                controls
                playsInline
                muted
                src={outputUrl}
                poster={generation.thumbnailUrl ?? undefined}
                className="w-full rounded-lg"
                style={{ aspectRatio: String(ratio) }}
              />
            ) : (
              <div className="grid place-items-center text-[12px] text-muted-foreground" style={{ aspectRatio: String(ratio) }}>
                Sin video
              </div>
            )}
          </div>
        ) : (
          <div
            style={{ aspectRatio: String(ratio) }}
            className="mb-3.5 overflow-hidden rounded-lg border border-border bg-muted/40"
          >
            {loading ? (
              <div className="grid h-full place-items-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              </div>
            ) : outputUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={outputUrl}
                alt={generation.prompt}
                className="size-full object-contain"
              />
            ) : generation.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={generation.thumbnailUrl}
                alt={generation.prompt}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
                Sin output
              </div>
            )}
          </div>
        )}

        {generation.prompt && (
          <Link
            href={reuseHref(generation)}
            className="mb-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reusar prompt
          </Link>
        )}

        <div className="mb-3.5 grid gap-1.5 grid-cols-1">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!outputUrl || downloading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}{' '}
            Descargar
          </button>
          {generation.type === 'image' && generation.status === 'done' && generation.prompt && (
            <>
              <Link
                href={`/app/create/image?prompt=${encodeURIComponent(generation.prompt)}&variations=3`}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30"
              >
                <Layers className="size-3.5" aria-hidden />
                3 variantes
              </Link>
              <SmartCropButtons prompt={generation.prompt} currentAspect={generation.aspectRatio} />
            </>
          )}
        </div>

        <DetailRow label="Prompt">
          <div className="text-[13px] leading-[1.5] text-foreground">
            {generation.prompt || (
              <span className="text-muted-foreground">(sin prompt)</span>
            )}
          </div>
          {generation.prompt && (
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Copy className="size-3" aria-hidden /> Copiar
            </button>
          )}
        </DetailRow>

        <DetailField label="Modelo" value={modelLabel(generation)} />
        <DetailField label="Aspecto" value={generation.aspectRatio ?? '—'} />
        <DetailField label="Estado" value={generation.status} />
        <DetailField
          label="Créditos"
          value={`−${generation.credits}`}
          mono
        />
        <DetailField
          label="Generado"
          value={shortTime(generation.createdAt)}
        />
        <DetailField label="ID" value={generation.id.slice(0, 8)} mono />

        {(() => {
          const parent = generation.parentGenerationId
            ? allGenerations.find((g) => g.id === generation.parentGenerationId)
            : null;
          const children = allGenerations.filter((g) => g.parentGenerationId === generation.id);
          const siblings = generation.batchId
            ? allGenerations.filter((g) => g.batchId === generation.batchId && g.id !== generation.id)
            : [];
          if (!parent && children.length === 0 && siblings.length === 0) return null;
          return (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Historial
              </p>
              {parent && (
                <button
                  type="button"
                  onClick={() => onNavigate(parent.id)}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="text-[10px]">↑</span>
                  <span className="min-w-0 flex-1 truncate">{parent.prompt || 'Padre'}</span>
                </button>
              )}
              {siblings.length > 0 && (
                <div className="mb-1.5">
                  <p className="mb-1 text-[10px] text-muted-foreground/60">
                    Batch ({generation.batchKind ? batchLabel(generation.batchKind) : ''}) · {siblings.length + 1} items
                  </p>
                  {siblings.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onNavigate(s.id)}
                      className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      <span className="text-[10px]">↔</span>
                      <span className="min-w-0 flex-1 truncate">{s.prompt || s.id.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              )}
              {children.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] text-muted-foreground/60">
                    Derivadas · {children.length}
                  </p>
                  {children.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onNavigate(c.id)}
                      className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      <span className="text-[10px]">↓</span>
                      <span className="min-w-0 flex-1 truncate">{c.prompt || c.id.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </aside>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </div>
      {children}
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-[12.5px]">
      <span className="text-muted-foreground/80">{label}</span>
      <span
        className={cn(
          'text-foreground',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function LibEmptyState({ tab }: { tab: Tab }) {
  const cfg: Record<Tab, { icon: typeof Library; title: string; sub: string }> = {
    sessions: {
      icon: Library,
      title: 'Aún no hay sesiones',
      sub: 'Cuando generes imágenes aparecerán agrupadas aquí.',
    },
    grid: {
      icon: ImageIcon,
      title: 'Tu cuadrícula está vacía',
      sub: 'Crea tu primera imagen para verla aquí.',
    },
    references: {
      icon: Sparkles,
      title: 'Sin referencias',
      sub: 'Sube imágenes desde el panel de creación o usa una generación como referencia.',
    },
  };
  const Ic = cfg[tab].icon;

  return (
    <div className="grid h-full min-h-[360px] place-items-center p-6">
      <div className="max-w-[360px] text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-[18px] border border-border bg-muted/30 text-muted-foreground">
          <Ic className="size-5" aria-hidden />
        </div>
        <h3 className="font-heading text-[16px] font-medium text-foreground">
          {cfg[tab].title}
        </h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{cfg[tab].sub}</p>
        <Link
          href="/app/create/image"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-primary/15"
        >
          <Sparkles className="size-3.5" aria-hidden /> Crear imagen
        </Link>
      </div>
    </div>
  );
}

// Player de audio custom para DetailAside — sin controles nativos del browser.
function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setProgress(0); };
    const onTime = () => {
      setCurrentTime(a.currentTime);
      if (a.duration > 0) setProgress((a.currentTime / a.duration) * 100);
    };
    const onMeta = () => setDuration(a.duration);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function scrub(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    a.currentTime = u * a.duration;
  }

  function fmt(s: number): string {
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return (
    <div className="w-full rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={toggle}
          className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/20"
        >
          {playing ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="6" width="3" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 0.5 9 5 2 9.5z" fill="currentColor" />
            </svg>
          )}
        </button>

        {/* Progress + time */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="group relative h-[6px] cursor-pointer rounded-full bg-white/[0.07]"
            onClick={scrub}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-primary/60"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
              style={{
                left: `${progress}%`,
                width: 10,
                height: 10,
                borderRadius: '999px',
                background: 'var(--primary)',
                boxShadow: '0 0 6px rgba(123,97,255,0.5)',
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground/60">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
