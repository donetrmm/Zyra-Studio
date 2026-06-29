'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { bucketOf, modelLabel, shortTime } from '@/lib/library/format';
import type { Session } from '@/lib/library/types';
import { BucketHeader } from './BucketHeader';
import { LibEmptyState } from './LibEmptyState';
import { LibTile } from './LibTile';

export function SessionsTab({
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
