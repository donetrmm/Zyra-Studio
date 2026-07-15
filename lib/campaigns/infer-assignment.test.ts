import { describe, it, expect } from 'vitest';
import { inferProductsForClip, type ProductCandidate } from './infer-assignment';

const p = (id: string, name: string, slug: string): ProductCandidate => ({
  id,
  name,
  slug,
  visualDetails: null,
});

describe('inferProductsForClip', () => {
  const pool3 = [
    p('a', 'Canvas Familiar', 'canvas-familiar'),
    p('b', 'Retrato de Pareja', 'retrato-de-pareja'),
    p('c', 'Mural Abstracto', 'mural-abstracto'),
  ];
  it('pool vacío → none', () => {
    expect(inferProductsForClip('clip', [])).toEqual({ productIds: [], confidence: 'none' });
  });
  it('un solo producto → ese, high (regresión del comportamiento actual)', () => {
    expect(inferProductsForClip('cualquier texto', [p('a', 'Canvas Familiar', 'canvas-familiar')]))
      .toEqual({ productIds: ['a'], confidence: 'high' });
  });
  it('nombra a uno de varios → solo ese', () => {
    expect(inferProductsForClip('El Retrato de Pareja sobre la cabecera', pool3))
      .toEqual({ productIds: ['b'], confidence: 'high' });
  });
  it('nombra a dos → ambos (ya no es ambiguo)', () => {
    expect(inferProductsForClip('el Canvas Familiar junto al Retrato de Pareja', pool3))
      .toEqual({ productIds: ['a', 'b'], confidence: 'high' });
  });
  it('frase colectiva → pool completo', () => {
    expect(inferProductsForClip('un paneo que muestra todos los productos de la marca', pool3))
      .toEqual({ productIds: ['a', 'b', 'c'], confidence: 'high' });
    expect(inferProductsForClip('la colección completa cuelga de la pared', pool3))
      .toEqual({ productIds: ['a', 'b', 'c'], confidence: 'high' });
  });
  it('numeral que coincide con el pool → pool completo', () => {
    expect(inferProductsForClip('los tres cuadros alineados sobre el sofá', pool3))
      .toEqual({ productIds: ['a', 'b', 'c'], confidence: 'high' });
  });
  it('numeral que NO coincide con el pool → sigue las reglas de match normales', () => {
    expect(inferProductsForClip('dos cuadros genéricos en la pared', pool3))
      .toEqual({ productIds: [], confidence: 'none' });
  });
  it('no nombra ninguno → none (sin asignar)', () => {
    expect(inferProductsForClip('una toma genérica de la sala', pool3))
      .toEqual({ productIds: [], confidence: 'none' });
  });
});
