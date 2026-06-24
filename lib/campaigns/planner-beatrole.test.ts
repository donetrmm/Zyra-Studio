import { describe, it, expect } from 'vitest';
import { maxDurationFor, SEQUENCE_SCENE_MAX_S } from './planner';

describe('maxDurationFor (P19)', () => {
  it('reveal sube el techo a 12s (aire dramático)', () => {
    expect(maxDurationFor('reveal')).toBe(12);
  });
  it('action comprime a 5s', () => {
    expect(maxDurationFor('action')).toBe(5);
  });
  it('beat usa el clamp default de secuencia', () => {
    expect(maxDurationFor('beat')).toBe(SEQUENCE_SCENE_MAX_S);
    expect(maxDurationFor('beat')).toBe(8);
  });
});
