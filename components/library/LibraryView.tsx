'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  Columns2,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  Music,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadGenerationImage as downloadGenerationFile } from '@/lib/media-references/download-client';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { assignCampaignAction } from '@/server-actions/campaigns';
import { deleteGenerationAction } from '@/server-actions/generations';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CollectionsTab, type Collection } from './CollectionsTab';
import { toggleFavoriteAction } from '@/server-actions/favorites';
import { FolderKanban, Heart } from 'lucide-react';
import type { LibraryGeneration, Tab, SortKey } from '@/lib/library/types';
import {
  aspectRatioToNumber,
  batchLabel,
  modelLabel,
  reuseHref,
  shortTime,
} from '@/lib/library/format';
import { bulkDownload } from '@/lib/library/output';
import { groupSessions } from '@/lib/library/sessions';
import { ToolbarButton } from './ToolbarButton';
import { DetailRow } from './DetailRow';
import { DetailField } from './DetailField';
import { MiniAudioPlayer } from './MiniAudioPlayer';
import { SessionsTab } from './SessionsTab';
import { GridTab } from './GridTab';
import { LibHeader } from './LibHeader';
import { CompareModal } from './CompareModal';
import { AssignCollectionDialog } from './AssignCollectionDialog';
import { CampaignAssigner } from './CampaignAssigner';
import { SavePresetButton } from './SavePresetButton';

export type { LibraryGeneration };

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


