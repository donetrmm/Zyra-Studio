'use client';

import { useMemo } from 'react';
import { batchLabel, bucketOf } from '@/lib/library/format';
import type { LibraryGeneration } from '@/lib/library/types';
import { BucketHeader } from './BucketHeader';
import { LibEmptyState } from './LibEmptyState';
import { LibTile } from './LibTile';

export function GridTab({
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
