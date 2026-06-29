'use client';

import { useState } from 'react';

export function useBulkSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  }

  function clear() {
    setSelectedIds(new Set());
  }

  return { selectedIds, toggleSelect, clear, showCompare, setShowCompare, showAssign, setShowAssign };
}
