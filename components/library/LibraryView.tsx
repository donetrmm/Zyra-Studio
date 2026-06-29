'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Columns2,
  Copy,
  Download,
  Image as ImageIcon,
  ImagePlus,
  Library,
  Loader2,
  Music,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Video as VideoIcon,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadGenerationImage as downloadGenerationFile } from '@/lib/media-references/download-client';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { savePresetAction } from '@/server-actions/presets';
import { assignCampaignAction, listCampaignsAction } from '@/server-actions/campaigns';
import { deleteGenerationAction } from '@/server-actions/generations';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CollectionsTab, type Collection } from './CollectionsTab';
import { toggleFavoriteAction } from '@/server-actions/favorites';
import { Bookmark, FolderKanban, Heart } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LibraryGeneration, Tab, SortKey, Session } from '@/lib/library/types';
import {
  CAMPAIGN_NONE,
  aspectRatioToNumber,
  batchLabel,
  bucketOf,
  modelLabel,
  reuseHref,
  shortTime,
} from '@/lib/library/format';
import { bulkDownload, downloadOne } from '@/lib/library/output';
import { groupSessions } from '@/lib/library/sessions';
import { BucketHeader } from './BucketHeader';
import { ToolbarButton } from './ToolbarButton';
import { TileBtn } from './TileBtn';
import { DetailRow } from './DetailRow';
import { DetailField } from './DetailField';
import { LibEmptyState } from './LibEmptyState';
import { MiniAudioPlayer } from './MiniAudioPlayer';

export type { LibraryGeneration };

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[] = [
  { id: 'sessions', label: 'Sesiones', icon: Library },
  { id: 'grid', label: 'Cuadrícula', icon: ImageIcon },
  { id: 'collections', label: 'Colecciones', icon: FolderKanban },
];

export function LibraryView({
  generations,
  workspaceName,
  initialFavoriteIds = [],
  collections = [],
}: {
  generations: LibraryGeneration[];
  workspaceName: string;
  initialFavoriteIds?: string[];
  collections?: Collection[];
}) {
  const [tab, setTab] = useState<Tab>('sessions');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [favIds, setFavIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));
  const [showFavOnly, setShowFavOnly] = useState(false);
  const router = useRouter();
  const confirm = useConfirm();

  // Copia local para borrado optimista (sin esperar al refetch del server).
  const [gens, setGens] = useState(generations);
  const [prevInitial, setPrevInitial] = useState(generations);
  if (prevInitial !== generations) {
    setPrevInitial(generations);
    setGens(generations);
  }

  function removeGens(ids: string[]) {
    const set = new Set(ids);
    setGens((prev) => prev.filter((g) => !set.has(g.id)));
    setSelectedIds(new Set());
    if (activeId && set.has(activeId)) setActiveId(null);
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `¿Eliminar ${ids.length} ${ids.length === 1 ? 'elemento' : 'elementos'}?`,
      description:
        'Se borran de tu biblioteca de forma permanente. No se reembolsan créditos de generaciones ya terminadas.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const results = await Promise.all(ids.map((id) => deleteGenerationAction(id)));
    const okIds = ids.filter((_, i) => results[i].ok);
    removeGens(okIds);
    const failed = ids.length - okIds.length;
    if (failed > 0) toast.error(`${failed} no se pudieron eliminar`);
    else toast.success(`${okIds.length} ${okIds.length === 1 ? 'eliminado' : 'eliminados'}`);
    router.refresh();
  }

  async function handleBulkDownload() {
    await bulkDownload(gens.filter((g) => selectedIds.has(g.id)));
  }

  async function handleDeleteOne(id: string) {
    const ok = await confirm({
      title: '¿Eliminar este elemento?',
      description: 'Se borra de tu biblioteca de forma permanente.',
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    const res = await deleteGenerationAction(id);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo eliminar');
      return;
    }
    removeGens([id]);
    toast.success('Eliminado');
    router.refresh();
  }

  function handleToggleFav(id: string) {
    const wasFav = favIds.has(id);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(id);
      else next.add(id);
      return next;
    });
    toggleFavoriteAction(id)
      .then((res) => {
        if (!res.ok) {
          toast.error(res.message || 'Error al actualizar favorito');
          setFavIds((prev) => {
            const next = new Set(prev);
            if (wasFav) next.add(id);
            else next.delete(id);
            return next;
          });
        }
      })
      .catch(() => {
        toast.error('Error al actualizar favorito');
        setFavIds((prev) => {
          const next = new Set(prev);
          if (wasFav) next.add(id);
          else next.delete(id);
          return next;
        });
      });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  }

  const filteredGens = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = gens;
    if (showFavOnly) {
      list = list.filter((g) => favIds.has(g.id));
    }
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
  }, [gens, query, sort, showFavOnly, favIds]);

  const sessions = useMemo(() => groupSessions(filteredGens, sort), [filteredGens, sort]);
  const active = useMemo(
    () => gens.find((g) => g.id === activeId) ?? null,
    [gens, activeId],
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col bg-background lg:h-[calc(100dvh-4rem)]">
      <LibHeader
        tab={tab}
        setTab={setTab}
        query={query}
        setQuery={setQuery}
        sort={sort}
        setSort={setSort}
        totalImages={gens.length}
        totalSessions={sessions.length}
        workspaceName={workspaceName}
        showFavOnly={showFavOnly}
        setShowFavOnly={setShowFavOnly}
        favCount={favIds.size}
      />

      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-16 pt-1 sm:px-6">
          {tab === 'sessions' && (
            <SessionsTab sessions={sessions} onOpen={setActiveId} favIds={favIds} onToggleFav={handleToggleFav} />
          )}
          {tab === 'grid' && (
            <GridTab items={filteredGens} onOpen={setActiveId} selectedIds={selectedIds} onToggleSelect={toggleSelect} favIds={favIds} onToggleFav={handleToggleFav} />
          )}
          {tab === 'collections' && <CollectionsTab collections={collections} />}
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
              allGenerations={gens}
              onClose={() => setActiveId(null)}
              onNavigate={setActiveId}
              isFavorite={favIds.has(active.id)}
              onToggleFav={handleToggleFav}
              onDelete={() => handleDeleteOne(active.id)}
            />
          </>
        )}
      </div>

      {selectedIds.size >= 1 && (
        <div className="zyra-fade-in fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-border bg-card/90 p-1.5 shadow-2xl backdrop-blur-md sm:gap-1 lg:bottom-6">
          <span className="ml-1 mr-0.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground">
              {selectedIds.size}
            </span>
            <span className="hidden sm:inline">seleccionados</span>
          </span>
          <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
          <ToolbarButton icon={FolderKanban} label="Asignar" onClick={() => setShowAssign(true)} />
          <ToolbarButton icon={Download} label="Descargar" onClick={handleBulkDownload} />
          {selectedIds.size >= 2 && selectedIds.size <= 4 && (
            <ToolbarButton icon={Columns2} label="Comparar" onClick={() => setShowCompare(true)} />
          )}
          <ToolbarButton icon={Trash2} label="Eliminar" onClick={handleBulkDelete} destructive />
          <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            aria-label="Limpiar selección"
            title="Limpiar selección"
            className="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {showCompare && (
        <CompareModal
          generations={gens.filter((g) => selectedIds.has(g.id))}
          onClose={() => setShowCompare(false)}
        />
      )}

      {showAssign && (
        <AssignCollectionDialog
          count={selectedIds.size}
          onAssign={async (campaignId) => {
            const ids = [...selectedIds];
            const results = await Promise.all(ids.map((id) => assignCampaignAction(id, campaignId)));
            const failed = results.filter((r) => !r.ok).length;
            if (failed > 0) {
              toast.error(`${failed} no se pudieron asignar`);
            } else {
              toast.success(
                campaignId
                  ? `${ids.length} asignados a la colección`
                  : `Colección removida de ${ids.length}`,
              );
            }
            setShowAssign(false);
            setSelectedIds(new Set());
            router.refresh();
          }}
          onClose={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}

// Asigna en lote las generaciones seleccionadas a una colección-carpeta
// (las editables, vía listCampaignsAction). Las campañas studio no son destino
// de asignación manual: reciben sus creativos por el pipeline.
function AssignCollectionDialog({
  count,
  onAssign,
  onClose,
}: {
  count: number;
  onAssign: (campaignId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [collections, setCollections] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<string>(CAMPAIGN_NONE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCampaignsAction().then((res) => {
      if (res.ok) setCollections(res.data);
      setLoaded(true);
    });
  }, []);

  async function handleAssign() {
    setSaving(true);
    await onAssign(target === CAMPAIGN_NONE ? null : target);
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar a colección</DialogTitle>
        </DialogHeader>
        <p className="text-[12.5px] text-muted-foreground">
          {count} {count === 1 ? 'generación' : 'generaciones'} seleccionada{count === 1 ? '' : 's'}.
        </p>
        {loaded && collections.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-[12.5px] text-muted-foreground">
            Aún no tienes colecciones. Créalas en la pestaña Colecciones.
          </p>
        ) : (
          <Select value={target} onValueChange={setTarget} disabled={!loaded || saving}>
            <SelectTrigger className="w-full rounded-lg border-border bg-background px-3 py-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CAMPAIGN_NONE}>Sin colección (quitar)</SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={saving || !loaded}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            Asignar
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="scroll-thin max-h-[90vh] overflow-y-auto p-6 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Comparador A/B</DialogTitle>
        </DialogHeader>
        <div className={cn('grid gap-4', generations.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : generations.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4')}>
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
              <p className="text-[11px] text-muted-foreground/50">{modelLabel(g)}</p>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
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
  workspaceName,
  showFavOnly,
  setShowFavOnly,
  favCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  totalImages: number;
  totalSessions: number;
  workspaceName: string;
  showFavOnly: boolean;
  setShowFavOnly: (v: boolean) => void;
  favCount: number;
}) {
  const sortLabel = sort === 'recent' ? 'recientes' : 'antiguos';
  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 pb-3 pt-5 sm:px-6">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">
            Biblioteca
          </h1>
          <div className="mt-1 text-[12.5px] text-muted-foreground/80">
            <span className="font-mono tabular-nums">{totalImages.toLocaleString('es-MX')}</span>{' '}
            imágenes ·{' '}
            <span className="font-mono tabular-nums">{totalSessions}</span> sesiones · ordenado por{' '}
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

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-0.5 rounded-[10px] border border-border bg-muted/30 p-[3px]">
            {TABS.map((t) => {
              const active = tab === t.id;
              const Ic = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  title={t.label}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition-colors min-[360px]:px-3',
                    active
                      ? 'border border-border bg-background text-foreground'
                      : 'border border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Ic className="size-3.5" aria-hidden />
                  {/* En pantallas muy angostas (<360px) los tabs van icon-only para
                      que «Colecciones» no se recorte; el title da el nombre accesible. */}
                  <span className="hidden min-[360px]:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowFavOnly(!showFavOnly)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              showFavOnly
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground',
            )}
          >
            <Heart className={cn('size-3.5', showFavOnly && 'fill-rose-400')} aria-hidden />
            {favCount > 0 && <span className="font-mono text-[11px]">{favCount}</span>}
          </button>
        </div>

        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-1 lg:max-w-[540px]">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por prompt o modelo…"
              className="h-9 w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 text-[13px] text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-9 rounded-lg border-border bg-muted/30 px-3 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Más recientes</SelectItem>
              <SelectItem value="old">Más antiguos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function SessionsTab({
  sessions,
  onOpen,
  favIds,
  onToggleFav,
}: {
  sessions: Session[];
  onOpen: (id: string) => void;
  favIds: Set<string>;
  onToggleFav: (id: string) => void;
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
              <SessionCard key={s.id} session={s} onOpen={onOpen} favIds={favIds} onToggleFav={onToggleFav} />
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
  selectedIds,
  onToggleSelect,
  favIds,
  onToggleFav,
}: {
  items: LibraryGeneration[];
  onOpen: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  favIds: Set<string>;
  onToggleFav: (id: string) => void;
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
              <LibTile key={g.id} gen={g} onClick={() => onOpen(g.id)} selected={selectedIds.has(g.id)} onToggleSelect={() => onToggleSelect(g.id)} variantTag={g.batchKind ? batchLabel(g.batchKind) : undefined} isFavorite={favIds.has(g.id)} onToggleFav={() => onToggleFav(g.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}



function SessionCard({
  session,
  onOpen,
  favIds,
  onToggleFav,
}: {
  session: Session;
  onOpen: (id: string) => void;
  favIds: Set<string>;
  onToggleFav: (id: string) => void;
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
            isFavorite={favIds.has(g.id)}
            onToggleFav={() => onToggleFav(g.id)}
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
  onToggleSelect,
  isFavorite,
  onToggleFav,
}: {
  gen: LibraryGeneration;
  onClick: () => void;
  variantTag?: string;
  compact?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  isFavorite?: boolean;
  onToggleFav?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [addingRef, startAddRef] = useTransition();

  // En modo compact (dentro de SessionCard) usamos aspect cuadrado para evitar
  // que las cards se vuelvan enormes con aspect ratios como 16:9.
  const ratio = aspectRatioToNumber(compact ? '1:1' : gen.aspectRatio);

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (!gen.hasOutput || downloading) return;
    setDownloading(true);
    try {
      await downloadOne(gen.id, `1to1-${gen.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }

  // Solo imágenes: copia el output al bucket de referencias para reusarlo
  // como referencia en futuras generaciones.
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
            <span className="font-mono text-[11px] text-muted-foreground/50">
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
            <span className="font-mono text-[11px] text-muted-foreground/50">
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
            'absolute bottom-2 left-2 rounded-full border border-border/40 bg-background/70 px-2 py-0.5 font-mono text-[11px] text-foreground/85 backdrop-blur transition-opacity',
            hover ? 'opacity-100' : 'opacity-60',
          )}
        >
          {variantTag}
        </div>
      )}

      {(hover || isFavorite) && onToggleFav && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFav(); }}
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-background/70 backdrop-blur transition-colors hover:bg-background/90"
          title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        >
          <Heart className={cn('size-3', isFavorite ? 'fill-rose-400 text-rose-400' : 'text-foreground')} aria-hidden />
        </button>
      )}

      {hover && gen.hasOutput && (
        <div className="absolute right-2 bottom-2 flex gap-1">
          {gen.type === 'image' && (
            <TileBtn onClick={handleUseAsRef} title="Usar como referencia" busy={addingRef}>
              <ImagePlus className="size-3" aria-hidden />
            </TileBtn>
          )}
          <TileBtn onClick={handleDownload} title="Descargar" busy={downloading}>
            <Download className="size-3" aria-hidden />
          </TileBtn>
        </div>
      )}
      {onToggleSelect && (hover || selected) && gen.status === 'done' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={cn(
            'absolute left-2 top-2 grid size-5 place-items-center rounded border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-foreground/60 bg-background/60 backdrop-blur',
          )}
        >
          {selected && <Check className="size-3" aria-hidden />}
        </button>
      )}
    </div>
  );
}




function DetailAside({
  generation,
  allGenerations,
  onClose,
  onNavigate,
  isFavorite,
  onToggleFav,
  onDelete,
}: {
  generation: LibraryGeneration;
  allGenerations: LibraryGeneration[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  isFavorite: boolean;
  onToggleFav: (id: string) => void;
  onDelete: () => void;
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

  const ratio = aspectRatioToNumber(generation.aspectRatio);

  async function handleDownload() {
    if (!outputUrl || downloading) return;
    setDownloading(true);
    try {
      await downloadGenerationFile(outputUrl, `1to1-${generation.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }

  // Solo imágenes: copia el output al bucket de referencias para reusarlo
  // como referencia en futuras generaciones.
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

      {/* En mobile la MobileBottomNav (~52px) tapa la parte baja del aside
          porque ambos comparten z-50 y la nav viene después en el DOM.
          Reservamos espacio extra abajo para que el contenido scrollable no
          quede oculto detrás de la nav. En desktop volvemos a pb-6. */}
      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-[88px] pt-4 lg:pb-6">
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
                <div className="mb-4 font-mono text-[11px] text-muted-foreground/60">
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
            onClick={() => onToggleFav(generation.id)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              isFavorite
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/15'
                : 'border-border bg-muted/30 text-foreground hover:border-muted-foreground/30',
            )}
          >
            <Heart className={cn('size-3.5', isFavorite && 'fill-rose-400')} aria-hidden />
            {isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!outputUrl || downloading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}{' '}
            Descargar
          </button>
          {generation.type === 'image' && generation.status === 'done' && (
            <button
              type="button"
              onClick={handleUseAsRef}
              disabled={addingRef}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addingRef ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-3.5" aria-hidden />
              )}{' '}
              Usar como referencia
            </button>
          )}
          {generation.status === 'done' && generation.prompt && (
            <SavePresetButton generation={generation} />
          )}
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="size-3.5" aria-hidden /> Eliminar
          </button>
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

        <CampaignAssigner generation={generation} />

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
                  <span className="text-[11px]">↑</span>
                  <span className="min-w-0 flex-1 truncate">{parent.prompt || 'Padre'}</span>
                </button>
              )}
              {siblings.length > 0 && (
                <div className="mb-1.5">
                  <p className="mb-1 text-[11px] text-muted-foreground/60">
                    Batch ({generation.batchKind ? batchLabel(generation.batchKind) : ''}) · {siblings.length + 1} items
                  </p>
                  {siblings.slice(0, 5).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onNavigate(s.id)}
                      className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      <span className="text-[11px]">↔</span>
                      <span className="min-w-0 flex-1 truncate">{s.prompt || s.id.slice(0, 8)}</span>
                    </button>
                  ))}
                </div>
              )}
              {children.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] text-muted-foreground/60">
                    Derivadas · {children.length}
                  </p>
                  {children.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onNavigate(c.id)}
                      className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      <span className="text-[11px]">↓</span>
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

function CampaignAssigner({ generation }: { generation: LibraryGeneration }) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; color: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [assigning, startAssign] = useTransition();

  useEffect(() => {
    listCampaignsAction().then((res) => {
      if (res.ok) setCampaigns(res.data);
      setLoaded(true);
    });
  }, []);

  if (!loaded || campaigns.length === 0) return null;

  function handleChange(campaignId: string) {
    startAssign(async () => {
      const res = await assignCampaignAction(generation.id, campaignId || null);
      if (res.ok) toast.success(campaignId ? 'Asignado a la colección' : 'Colección removida');
      else toast.error(res.message || 'Error');
    });
  }

  return (
    <div className="mt-3">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FolderKanban className="size-3" aria-hidden />
        Colección
      </label>
      <Select
        value={generation.campaignId ?? CAMPAIGN_NONE}
        onValueChange={(v) => handleChange(v === CAMPAIGN_NONE ? '' : v)}
        disabled={assigning}
      >
        <SelectTrigger className="mt-1.5 h-auto w-full rounded-md border-border bg-background px-3 py-2 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CAMPAIGN_NONE}>Sin colección</SelectItem>
          {campaigns.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SavePresetButton({ generation }: { generation: LibraryGeneration }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, startSave] = useTransition();

  function handleSave() {
    if (!name.trim()) return;
    startSave(async () => {
      const res = await savePresetAction({
        type: generation.type,
        name: name.trim(),
        description: description.trim() || undefined,
        params: {
          prompt: generation.prompt,
          model: generation.model,
          provider: generation.provider,
          aspectRatio: generation.aspectRatio,
          generationId: generation.id,
          thumbnailUrl: generation.thumbnailUrl,
        },
        isPublic,
      });
      if (!res.ok) { toast.error(res.message || 'Error al guardar'); return; }
      toast.success(isPublic ? 'Preset publicado' : 'Preset guardado');
      setOpen(false);
      setName('');
      setDescription('');
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-muted-foreground/30"
      >
        <Bookmark className="size-3.5" aria-hidden />
        Guardar como preset
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="text-[12px] font-medium text-foreground">Guardar como preset</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del preset"
        className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descripción (opcional)"
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] text-muted-foreground">
        <span>Hacer público (visible para la comunidad)</span>
        <Switch
          checked={isPublic}
          onCheckedChange={setIsPublic}
          size="sm"
          aria-label="Hacer público (visible para la comunidad)"
        />
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11.5px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}




