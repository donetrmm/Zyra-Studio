import { describe, it, expect } from 'vitest';
import { buildReferences } from './seedance';
import type { DirectorContext } from '../types';

function ctxWith(over: Partial<DirectorContext>): DirectorContext {
  return { language: 'es', ...over } as DirectorContext;
}

const product = {
  name: 'Cuadro',
  visualDetails: 'lienzo',
  palette: [],
  imagePaths: ['p/1.jpg', 'p/2.jpg', 'p/3.jpg', 'p/4.jpg', 'p/5.jpg'],
};

describe('buildReferences — topes automáticos (sin selección manual)', () => {
  it('producto se recorta a 3 por default', () => {
    const { references } = buildReferences(ctxWith({ product }));
    expect(references.filter((r) => r.role === 'product')).toHaveLength(3);
  });
});

describe('buildReferences — modo manual (ctx.manualRefs)', () => {
  it('el usuario puede mandar más de 3 de producto (el ctx ya viene filtrado)', () => {
    const { references } = buildReferences(ctxWith({ product, manualRefs: true }));
    expect(references.filter((r) => r.role === 'product')).toHaveLength(5);
  });

  it('los ángulos de cast seleccionados no se re-recortan por el presupuesto automático', () => {
    const { references } = buildReferences(
      ctxWith({
        manualRefs: true,
        characters: [
          { name: 'Ana', description: 'd', masterImagePath: 'c/a-m.jpg', angleImagePaths: ['c/a-1.jpg', 'c/a-2.jpg'] },
          { name: 'Beto', description: 'd', masterImagePath: 'c/b-m.jpg', angleImagePaths: ['c/b-1.jpg', 'c/b-2.jpg'] },
        ],
      }),
    );
    // Automático con 2 personajes = master+1 ángulo c/u (4); manual = todos (6).
    expect(references.filter((r) => r.role === 'character')).toHaveLength(6);
  });

  it('el tope GLOBAL de 9 imágenes sigue siendo la red (con warning)', () => {
    const { references, warnings } = buildReferences(
      ctxWith({
        manualRefs: true,
        product: { ...product, imagePaths: Array.from({ length: 12 }, (_, i) => `p/${i}.jpg`) },
      }),
    );
    expect(references.filter((r) => r.kind === 'image')).toHaveLength(9);
    expect(warnings.some((w) => w.includes('recortadas'))).toBe(true);
  });
});

describe('buildReferences — slot de audio (voz vs música)', () => {
  it('solo música: la cita como audio_rhythm', () => {
    const { references, lines } = buildReferences(ctxWith({ audioRefPath: 'a/music.mp3' }));
    const audio = references.filter((r) => r.kind === 'audio');
    expect(audio).toEqual([{ storagePath: 'a/music.mp3', kind: 'audio', role: 'audio_rhythm' }]);
    expect(lines.some((l) => l.includes('sync scene energy to its beats'))).toBe(true);
  });

  it('solo voz: la cita como voice_ref con directiva de timbre', () => {
    const { references, lines } = buildReferences(ctxWith({ voiceRefPath: 'v/voz.mp3' }));
    const audio = references.filter((r) => r.kind === 'audio');
    expect(audio).toEqual([{ storagePath: 'v/voz.mp3', kind: 'audio', role: 'voice_ref' }]);
    expect(lines.some((l) => l.includes('voice reference for the speaking character'))).toBe(true);
  });

  it('voz gana sobre música: un solo slot @audio1, la voz', () => {
    const { references, lines } = buildReferences(
      ctxWith({ audioRefPath: 'a/music.mp3', voiceRefPath: 'v/voz.mp3' }),
    );
    const audio = references.filter((r) => r.kind === 'audio');
    expect(audio).toEqual([{ storagePath: 'v/voz.mp3', kind: 'audio', role: 'voice_ref' }]);
    expect(lines.some((l) => l.includes('sync scene energy to its beats'))).toBe(false);
  });
});

describe('buildReferences — cuerpo completo (vestuario, specs/v2/16)', () => {
  it('se empuja tras la maestra con cita de vestuario', () => {
    const { references, lines } = buildReferences(ctxWith({
      characters: [{ name: 'Ana', description: 'd', masterImagePath: 'c/m.jpg', fullBodyImagePath: 'c/full.jpg' }],
    }));
    const charRefs = references.filter((r) => r.role === 'character').map((r) => r.storagePath);
    expect(charRefs).toEqual(['c/m.jpg', 'c/full.jpg']);
    expect(lines.some((l) => l.includes('full-body wardrobe reference'))).toBe(true);
    expect(lines.some((l) => l.includes('exact same clothing'))).toBe(true);
  });

  it('prioridad: el cuerpo completo entra antes que los ángulos', () => {
    const { references } = buildReferences(ctxWith({
      characters: [{
        name: 'Ana', description: 'd', masterImagePath: 'c/m.jpg',
        fullBodyImagePath: 'c/full.jpg', angleImagePaths: ['c/a1.jpg', 'c/a2.jpg'],
      }],
    }));
    const charRefs = references.filter((r) => r.role === 'character').map((r) => r.storagePath);
    expect(charRefs.indexOf('c/full.jpg')).toBeLessThan(charRefs.indexOf('c/a1.jpg'));
  });

  it('sin fullBodyImagePath: cero cambio (regresión)', () => {
    const { references, lines } = buildReferences(ctxWith({
      characters: [{ name: 'Ana', description: 'd', masterImagePath: 'c/m.jpg', angleImagePaths: ['c/a1.jpg'] }],
    }));
    expect(references.filter((r) => r.role === 'character')).toHaveLength(2);
    expect(lines.some((l) => l.includes('wardrobe reference'))).toBe(false);
  });
});
