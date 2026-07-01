import { describe, it, expect } from 'vitest';
import { findUnpromotedPanels, type HealGenRow, type HealItemRow } from './storyboard-promote-heal';

const gen = (id: string, beatId: string | null, createdAt: string): HealGenRow => ({
  id,
  created_at: createdAt,
  params: beatId ? { storyboard: { campaignItemId: beatId } } : {},
});

describe('findUnpromotedPanels', () => {
  const items: HealItemRow[] = [
    { id: 'beat-1', storyboard_generation_id: 'gen-a' },
    { id: 'beat-2', storyboard_generation_id: null },
  ];

  it('vacío cuando la gen más nueva de cada beat ya está enlazada', () => {
    expect(findUnpromotedPanels([gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z')], items)).toEqual([]);
  });

  it('detecta el beat sin enlace (promote perdido)', () => {
    expect(findUnpromotedPanels([gen('gen-b', 'beat-2', '2026-07-01T10:00:00Z')], items)).toEqual(['gen-b']);
  });

  it('detecta cuando hay una gen más nueva que la enlazada (refine sin promote)', () => {
    const gens = [
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
      gen('gen-c', 'beat-1', '2026-07-01T10:05:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items)).toEqual(['gen-c']);
  });

  it('elige la más nueva aunque lleguen desordenadas', () => {
    const gens = [
      gen('gen-c', 'beat-1', '2026-07-01T10:05:00Z'),
      gen('gen-d', 'beat-1', '2026-07-01T10:10:00Z'),
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items)).toEqual(['gen-d']);
  });

  it('ignora gens sin payload de storyboard o de beats desconocidos', () => {
    const gens = [gen('gen-x', null, '2026-07-01T10:00:00Z'), gen('gen-y', 'beat-999', '2026-07-01T10:00:00Z')];
    expect(findUnpromotedPanels(gens, items)).toEqual([]);
  });
});
