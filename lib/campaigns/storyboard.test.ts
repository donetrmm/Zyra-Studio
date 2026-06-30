import { describe, it, expect } from 'vitest';
import {
  beatsNeedingPanel,
  chainedCharacterFidelity,
  chainedProductFidelity,
  compilePanel,
  compilePanelEdit,
  compileRefinePrompt,
  humanRealismDirective,
  isStylized,
  SAFE_AREA_EXTEND_PROMPT,
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

describe('chainedCharacterFidelity', () => {
  it('ancla la identidad del cast por texto, en modo preservar (la cadena descarta la imagen)', () => {
    const d = chainedCharacterFidelity({
      characters: [
        { name: 'María', description: 'mujer de pelo castaño rizado, chaqueta roja', masterImagePath: 'ws/maria.png' },
        { name: 'Diego', description: 'hombre alto, barba corta', masterImagePath: 'ws/diego.png' },
      ],
    });
    expect(d).toContain('María');
    expect(d).toContain('Diego');
    // Preserve-framed: conservar idéntico, nunca re-render (evita el drift histórico).
    expect(d).toContain('identical to the previous shot');
    expect(d).not.toMatch(/render the people as real|photographic realism/i);
    // No apunta a imágenes de referencia (en la cadena no viajan).
    expect(d).not.toContain('reference image');
    expect(d.startsWith(' ')).toBe(true);
  });

  it('devuelve vacío si no hay personajes', () => {
    expect(chainedCharacterFidelity({ characters: [] })).toBe('');
    expect(chainedCharacterFidelity({ product: { name: 'X', imagePaths: [] } })).toBe('');
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

describe('SAFE_AREA_EXTEND_PROMPT', () => {
  it('pide rellenar solo las bandas y preservar el centro, sin sujetos nuevos', () => {
    expect(SAFE_AREA_EXTEND_PROMPT).toContain('keep the central area exactly unchanged');
    expect(SAFE_AREA_EXTEND_PROMPT).toContain('top and bottom bands');
    expect(SAFE_AREA_EXTEND_PROMPT).toContain('do not place the product');
    // ASCII puro.
    expect(/^[\x00-\x7F]*$/.test(SAFE_AREA_EXTEND_PROMPT)).toBe(true);
  });
});

describe('compileRefinePrompt', () => {
  const ctx = {
    product: {
      name: 'Family Portrait Canvas Print',
      visualDetails: 'a canvas print of two women and one man, deep greens and greys',
      imagePaths: ['ws/canvas.png'],
    },
    characters: [
      { name: 'María', description: 'mujer de pelo castaño rizado, chaqueta roja', masterImagePath: 'ws/maria.png' },
    ],
  };

  it('lleva la instruccion y la guardia de preservar el resto', () => {
    const p = compileRefinePrompt('make the lighting warmer', ctx);
    expect(p).toContain('make the lighting warmer');
    expect(p).toContain('Keep everything else exactly the same');
  });

  it('ancla producto y personaje por TEXTO (no por "reference image", que el chat descarta)', () => {
    const p = compileRefinePrompt('move the canvas to the left', ctx);
    // Producto por texto (chainedProductFidelity).
    expect(p).toContain('Family Portrait Canvas Print');
    expect(p).toContain('Reproduce the product');
    // Personaje por texto (chainedCharacterFidelity), en modo preservar.
    expect(p).toContain('María');
    expect(p).toContain('identical to the previous shot');
    // CRITICO: nunca apuntar a imagenes de referencia (en el chat del refinado no viajan).
    expect(p).not.toContain('reference image');
  });

  it('sin producto ni personajes, solo instruccion + guardia (sin anclas vacias)', () => {
    const p = compileRefinePrompt('crop tighter', { characters: [] });
    expect(p).toContain('crop tighter');
    expect(p).toContain('Keep everything else exactly the same');
    expect(p).not.toContain('Reproduce the product');
    expect(p).not.toContain('reference image');
  });
});
