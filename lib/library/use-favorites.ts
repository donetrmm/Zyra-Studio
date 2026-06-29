'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { toggleFavoriteAction } from '@/server-actions/favorites';

export function useFavorites(initialFavoriteIds: string[]) {
  const [favIds, setFavIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));
  const [showFavOnly, setShowFavOnly] = useState(false);

  function toggleFav(id: string) {
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

  return { favIds, showFavOnly, setShowFavOnly, toggleFav };
}
