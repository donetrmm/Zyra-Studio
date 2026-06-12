import { describe, it, expect } from 'vitest';
import { groupPlanItems } from './plan-grouping';

type I = Parameters<typeof groupPlanItems>[0][number];
const item = (over: Partial<I>): I => ({
  id: 'x', sequenceId: null, sceneIndex: null, sequenceLabel: null, ...over,
}) as I;

describe('groupPlanItems', () => {
  it('agrupa por sequenceId, ordena por sceneIndex y conserva singles', () => {
    const groups = groupPlanItems([
      item({ id: 'a' }),
      item({ id: 's2', sequenceId: 'seq1', sceneIndex: 1, sequenceLabel: 'Anuncio' }),
      item({ id: 's1', sequenceId: 'seq1', sceneIndex: 0, sequenceLabel: 'Anuncio' }),
      item({ id: 'b' }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ kind: 'single', item: expect.objectContaining({ id: 'a' }) });
    const seq = groups.find((g) => g.kind === 'sequence');
    expect(seq).toBeDefined();
    if (seq?.kind === 'sequence') {
      expect(seq.label).toBe('Anuncio');
      expect(seq.scenes.map((s) => s.id)).toEqual(['s1', 's2']);
    }
  });
});
