'use client';

import Link from 'next/link';
import { FolderKanban, Heart, Image as ImageIcon, Library, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SortKey, Tab } from '@/lib/library/types';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[] = [
  { id: 'sessions', label: 'Sesiones', icon: Library },
  { id: 'grid', label: 'Cuadrícula', icon: ImageIcon },
  { id: 'collections', label: 'Colecciones', icon: FolderKanban },
];

export function LibHeader({
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
