import { describe, it, expect } from 'vitest';
import { buildDirectedPlan, type DirectedIdea } from './planner';

const format = {
  id: 'f1', slug: 'gran-pantalla', name: 'Gran pantalla',
  requiredRefs: [], defaultDurationS: 8, defaultAudio: true,
};

function idea(over: Partial<DirectedIdea> = {}): DirectedIdea {
  return {
    format, count: 1, scenePrompt: null, durationS: null, sceneSummary: null,
    characterIds: [], invented: [], sequenceLabel: 'Anuncio',
    scenes: [
      { scenePrompt: 'Clip 1: opens wide.', durationS: 5, sceneSummary: null, beatRole: 'beat', characterStateHint: null, transitionHint: 'corta sobre el giro hacia el jardín' },
      { scenePrompt: 'Clip 2: garden.', durationS: 5, sceneSummary: null, beatRole: 'beat', characterStateHint: null, transitionHint: null },
    ],
    ...over,
  };
}

describe('buildDirectedPlan — transitionHint', () => {
  it('propaga transitionHint de cada escena al item', () => {
    const items = buildDirectedPlan({
      ideas: [idea()], productName: 'Canvas', goal: 'mixed', scenes: [],
      characters: [], available: { product: true, packaging: false },
      dateStart: new Date('2026-07-01'), dateEnd: new Date('2026-07-10'),
      draftModelSlug: 'bytedance/seedance-2.0/fast/reference-to-video', language: 'es', aspectRatio: '9:16',
    });
    expect(items[0].transitionHint).toBe('corta sobre el giro hacia el jardín');
    expect(items[1].transitionHint).toBeNull();
  });
});
