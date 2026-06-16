import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from './orchestrator';

describe('buildContinuationPrompt', () => {
  it('sin cierre: producto(s) + fotograma previo (comportamiento actual)', () => {
    const out = buildContinuationPrompt('A dog runs.', 1);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).not.toContain('@image3');
    expect(out.endsWith('A dog runs.')).toBe(true);
  });

  it('con cierre: añade el fotograma de cierre como última referencia', () => {
    const out = buildContinuationPrompt('A dog runs.', 1, { withClosingFrame: true });
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).toContain('@image3 is the target final frame');
    expect(out).toContain('end the shot exactly on it');
  });

  it('con cierre y 2 productos: el cierre es @image4', () => {
    const out = buildContinuationPrompt('Scene.', 2, { withClosingFrame: true });
    expect(out).toContain('@image3 is the final frame of the previous shot');
    expect(out).toContain('@image4 is the target final frame');
  });
});
