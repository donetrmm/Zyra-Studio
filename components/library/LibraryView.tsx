'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Columns2,
  Download,
  Trash2,
  X,
} from 'lucide-react';
import { assignCampaignAction } from '@/server-actions/campaigns';
import { deleteGenerationAction } from '@/server-actions/generations';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CollectionsTab, type Collection } from './CollectionsTab';
import { FolderKanban } from 'lucide-react';
import { useFavorites } from '@/lib/library/use-favorites';
import { useBulkSelection } from '@/lib/library/use-bulk-selection';
import type { LibraryGeneration, Tab, SortKey } from '@/lib/library/types';
import { modelLabel } from '@/lib/library/format';
import { bulkDownload } from '@/lib/library/output';
import { groupSessions } from '@/lib/library/sessions';
import { ToolbarButton } from './ToolbarButton';
import { SessionsTab } from './SessionsTab';
import { GridTab } from './GridTab';
import { LibHeader } from './LibHeader';
import { CompareModal } from './CompareModal';
import { AssignCollectionDialog } from './AssignCollectionDialog';
import { DetailAside } from './DetailAside';

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
  const router = useRouter();
  const confirm = useConfirm();
  const { favIds, showFavOnly, setShowFavOnly, toggleFav: handleToggleFav } = useFavorites(initialFavoriteIds);
  const { selectedIds, toggleSelect, clear: clearSelection, showCompare, setShowCompare, showAssign, setShowAssign } = useBulkSelection();

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
    clearSelection();
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
            onClick={clearSelection}
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
            clearSelection();
            router.refresh();
          }}
          onClose={() => setShowAssign(false)}
        />
      )}
    </div>
  );
}
