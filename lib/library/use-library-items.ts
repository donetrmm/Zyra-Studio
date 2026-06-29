'use client';

import { useMemo, useState } from 'react';
import { modelLabel } from '@/lib/library/format';
import { groupSessions } from '@/lib/library/sessions';
import type { LibraryGeneration, SortKey } from '@/lib/library/types';

export function useLibraryItems(
  generations: LibraryGeneration[],
  {
    query,
    sort,
    showFavOnly,
    favIds,
  }: {
    query: string;
    sort: SortKey;
    showFavOnly: boolean;
    favIds: Set<string>;
  },
) {
  const [gens, setGens] = useState(generations);
  const [prevInitial, setPrevInitial] = useState(generations);
  if (prevInitial !== generations) {
    setPrevInitial(generations);
    setGens(generations);
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

  return { gens, setGens, filteredGens, sessions };
}
