import { describe, it, expect } from 'vitest';
import { beatsNeedingPanel, compilePanel, compilePanelEdit } from './storyboard';

describe('beatsNeedingPanel', () => {
  it('devuelve solo beats sin panel', () => {
    const beats = [
      { id: 'a', scene_prompt: 'x', aspect_ratio: '9:16', storyboard_image_id: null },
      { id: 'b', scene_prompt: 'y', aspect_ratio: '9:16', storyboard_image_id: 'img-1' },
    ];
    expect(beatsNeedingPanel(beats).map((b) => b.id)).toEqual(['a']);
  });
});

describe('compilePanel', () => {
  it('compila un prompt FLUX con el scene_prompt y el producto del contexto', () => {
    const beat = { id: 'a', scene_prompt: 'the couple smiles in the living room', aspect_ratio: '9:16', storyboard_image_id: null };
    const res = compilePanel(beat, { product: { name: 'Canvas', imagePaths: ['ws/prod.png'] } }, 'flux-2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('the couple smiles');
    expect(res.compiled.params.width).toBeGreaterThan(0);
    expect(res.compiled.references.some((r) => r.role === 'product')).toBe(true);
  });
});

describe('compilePanelEdit', () => {
  it('compila una edicion Nano Banana con la instruccion', () => {
    const res = compilePanelEdit('make the lighting warmer', '9:16', {}, 'gemini-3-pro-image-preview');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('warmer');
  });
});
