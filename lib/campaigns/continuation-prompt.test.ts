import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from './orchestrator';

describe('buildContinuationPrompt', () => {
  it('sin personajes ni cierre: producto(s) + fotograma previo', () => {
    const out = buildContinuationPrompt('A dog runs.', 1, 0);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).not.toContain('@image3');
    expect(out.endsWith('A dog runs.')).toBe(true);
  });

  it('con personaje: lo cita entre el producto y el fotograma previo', () => {
    const out = buildContinuationPrompt('Scene.', 1, 1);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is a main character');
    expect(out).toContain('@image3 is the final frame of the previous shot');
    expect(out).not.toContain('@image4');
  });

  it('1 producto + 2 personajes + cierre: índices correctos', () => {
    const out = buildContinuationPrompt('Scene.', 1, 2, { withClosingFrame: true });
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is a main character');
    expect(out).toContain('@image3 is a main character');
    expect(out).toContain('@image4 is the final frame of the previous shot');
    expect(out).toContain('@image5 is the target final frame');
  });

  it('sin producto, 1 personaje: el personaje es @image1', () => {
    const out = buildContinuationPrompt('Scene.', 0, 1);
    expect(out).toContain('@image1 is a main character');
    expect(out).toContain('@image2 is the final frame of the previous shot');
  });
});
