import { describe, it, expect } from 'vitest';
import {
  beatsNeedingPanel,
  chainedProductFidelity,
  compilePanel,
  compilePanelEdit,
  humanRealismDirective,
  isStylized,
} from './storyboard';

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

describe('humanRealismDirective', () => {
  const withChar = { characters: [{ name: 'Ana', description: 'mujer', masterImagePath: 'ws/ana.png' }] };

  it('inyecta realismo cuando hay personajes y el creativo no es estilizado', () => {
    const d = humanRealismDirective(withChar, 'she hugs the framed photo in the living room');
    expect(d).toContain('real, photographed human beings');
    expect(d.startsWith(' ')).toBe(true);
  });

  it('la cláusula está subordinada a la fidelidad (no cambia identidad ni producto)', () => {
    const d = humanRealismDirective(withChar, 'she smiles at the camera');
    expect(d).toContain('keep their exact identity');
    expect(d).toContain('keep the product');
  });

  it('no inyecta nada si no hay personajes', () => {
    expect(humanRealismDirective({ product: { name: 'Canvas', imagePaths: [] } }, 'a hand places the canvas')).toBe('');
  });

  it('se omite cuando el registro del formato es estilizado', () => {
    const d = humanRealismDirective({ ...withChar, format: { register: 'anime, vibrant' } as never }, 'she smiles');
    expect(d).toBe('');
  });

  it('se omite cuando el scene_prompt pide un look estilizado', () => {
    expect(humanRealismDirective(withChar, 'a cartoon version of the family waves')).toBe('');
  });

  it('NO confunde el producto cuadro/foto impresa con estilo estilizado', () => {
    // painting/print/cuadro describen el PRODUCTO, no el render → realismo SÍ entra.
    expect(isStylized('', 'she looks at the painting she never got to print, the framed cuadro on the wall')).toBe(false);
    expect(humanRealismDirective(withChar, 'the printed photo, a painting framed as a cuadro')).toContain(
      'real, photographed human beings',
    );
  });

  it('detecta estilos de render inequívocos', () => {
    expect(isStylized('3d render, stylized', 'x')).toBe(true);
    expect(isStylized('', 'a surreal dreamlike animado clip')).toBe(true);
  });
});

describe('chainedProductFidelity', () => {
  it('ancla el producto por texto con sus visualDetails (la cadena descarta la imagen)', () => {
    const d = chainedProductFidelity({
      product: {
        name: 'Family Portrait Canvas Print',
        visualDetails: 'a canvas print of two women and one man, deep greens and greys',
        imagePaths: ['ws/canvas.png'],
      },
    });
    expect(d).toContain('Family Portrait Canvas Print');
    expect(d).toContain('two women and one man');
    expect(d).toContain('Reproduce the product');
    // NO debe apuntar a imágenes de referencia (en la cadena no viajan).
    expect(d).not.toContain('reference image');
    expect(d.startsWith(' ')).toBe(true);
  });

  it('devuelve vacío si no hay producto', () => {
    expect(chainedProductFidelity({ characters: [] })).toBe('');
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
