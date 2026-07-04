import { describe, it, expect } from 'vitest';
import { findUnpromotedPanels, healCutoffIso, type HealGenRow, type HealItemRow } from './storyboard-promote-heal';

const gen = (id: string, beatId: string | null, createdAt: string): HealGenRow => ({
  id,
  created_at: createdAt,
  params: beatId ? { storyboard: { campaignItemId: beatId } } : {},
});

const NONE: ReadonlySet<string> = new Set();

describe('findUnpromotedPanels', () => {
  const items: HealItemRow[] = [
    { id: 'beat-1', storyboard_generation_id: 'gen-a' },
    { id: 'beat-2', storyboard_generation_id: null },
  ];

  it('vacío cuando la gen más nueva de cada beat ya está enlazada', () => {
    expect(findUnpromotedPanels([gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z')], items, NONE)).toEqual([]);
  });

  it('detecta el beat sin enlace (promote perdido)', () => {
    expect(findUnpromotedPanels([gen('gen-b', 'beat-2', '2026-07-01T10:00:00Z')], items, NONE)).toEqual(['gen-b']);
  });

  it('detecta cuando hay una gen más nueva que la enlazada (refine sin promote)', () => {
    const gens = [
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
      gen('gen-c', 'beat-1', '2026-07-01T10:05:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items, NONE)).toEqual(['gen-c']);
  });

  it('elige la más nueva aunque lleguen desordenadas', () => {
    const gens = [
      gen('gen-c', 'beat-1', '2026-07-01T10:05:00Z'),
      gen('gen-d', 'beat-1', '2026-07-01T10:10:00Z'),
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items, NONE)).toEqual(['gen-d']);
  });

  it('ignora gens sin payload de storyboard o de beats desconocidos', () => {
    const gens = [gen('gen-x', null, '2026-07-01T10:00:00Z'), gen('gen-y', 'beat-999', '2026-07-01T10:00:00Z')];
    expect(findUnpromotedPanels(gens, items, NONE)).toEqual([]);
  });

  // Bug: reemplazar el panel con una imagen manual pone storyboard_generation_id
  // en null; el heal veía la gen vieja como "promote perdido", la re-encolaba y
  // el promote pisaba la imagen subida al recargar la página.
  it('NO re-encola una gen ya promovida aunque el beat esté desenlazado (upload manual)', () => {
    const gens = [gen('gen-b', 'beat-2', '2026-07-01T10:00:00Z')];
    expect(findUnpromotedPanels(gens, items, new Set(['gen-b']))).toEqual([]);
  });

  // Misma familia: restaurar una versión enlaza el beat a una gen VIEJA a propósito;
  // la newest ya fue promovida en su momento y no debe volver a encolarse.
  it('NO re-encola la gen más nueva ya promovida cuando el beat apunta a una versión vieja (restore)', () => {
    const gens = [
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
      gen('gen-e', 'beat-1', '2026-07-01T10:05:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items, new Set(['gen-e']))).toEqual([]);
  });

  it('sí re-encola cuando la gen más nueva nunca fue promovida aunque otras del beat sí', () => {
    const gens = [
      gen('gen-a', 'beat-1', '2026-07-01T10:00:00Z'),
      gen('gen-e', 'beat-1', '2026-07-01T10:05:00Z'),
    ];
    expect(findUnpromotedPanels(gens, items, new Set(['gen-a']))).toEqual(['gen-e']);
  });
});

describe('healCutoffIso', () => {
  it('resta HEAL_MIN_AGE_MS al timestamp dado', () => {
    expect(healCutoffIso(Date.parse('2026-07-01T10:02:00Z'))).toBe('2026-07-01T10:00:00.000Z');
  });
});
