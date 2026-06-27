import { describe, it, expect } from 'vitest';
import { groupItemsByFormat, buildReprocessNotes } from './studio-view';
import type { StudioItem } from '@/lib/campaigns/studio-item';

const item = (over: Partial<StudioItem>): StudioItem =>
  ({
    id: 'x', formatId: null, formatName: 'Formato', formatDescription: '', templateId: null,
    durationS: null, aspectRatio: null, scene: null, scenePrompt: '', sceneSummary: null,
    caption: null, characterNames: [], scheduledDate: null, status: 'planned', warnings: [],
    generationId: null, isWinner: false, sequenceId: null, sceneIndex: null,
    sequenceLabel: null, locationId: null, characterStateHint: null, ...over,
  });

describe('groupItemsByFormat', () => {
  it('agrupa por formatId preservando orden de primera aparicion', () => {
    const groups = groupItemsByFormat([
      item({ id: 'a', formatId: 'f1', formatName: 'Reel' }),
      item({ id: 'b', formatId: 'f2', formatName: 'Story' }),
      item({ id: 'c', formatId: 'f1', formatName: 'Reel' }),
    ]);
    expect(groups.map((g) => g.formatId)).toEqual(['f1', 'f2']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('mapea formatId null a formatId vacio (clave sin-formato)', () => {
    const groups = groupItemsByFormat([item({ id: 'a', formatId: null })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].formatId).toBe('');
  });
});

describe('buildReprocessNotes', () => {
  it('vacio cuando no hay inventados ni blockers', () => {
    expect(buildReprocessNotes({})).toEqual([]);
    expect(buildReprocessNotes({ inventedNames: [], blockers: [] })).toEqual([]);
  });
  it('arma aviso de personajes inventados', () => {
    const notes = buildReprocessNotes({ inventedNames: ['Lia', 'Max'] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Lia, Max');
    expect(notes[0]).toContain('se inventó su apariencia');
  });
  it('arma aviso de ideas no convertibles y respeta el orden', () => {
    const notes = buildReprocessNotes({ inventedNames: ['Lia'], blockers: ['idea 1', 'idea 2'] });
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('idea 1 · idea 2');
  });
});
