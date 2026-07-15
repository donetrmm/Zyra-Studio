import { describe, it, expect } from 'vitest';
import { inferProductForClip, inferProductsForClip, type ProductCandidate } from './infer-assignment';

const p = (id: string, name: string, slug: string): ProductCandidate => ({
  id,
  name,
  slug,
  visualDetails: null,
});

const pv = (id: string, name: string, slug: string, visualDetails: string): ProductCandidate => ({
  id,
  name,
  slug,
  visualDetails,
});

describe('inferProductForClip', () => {
  it('pool vacío → none', () => {
    expect(inferProductForClip('clip', [])).toEqual({ productId: null, confidence: 'none' });
  });

  it('un solo producto → high', () => {
    expect(inferProductForClip('cualquier texto', [p('a', 'Canvas Familiar', 'canvas-familiar')])).toEqual({
      productId: 'a',
      confidence: 'high',
    });
  });

  it('nombra a uno de varios → high ese', () => {
    const pool = [p('a', 'Canvas Familiar', 'canvas-familiar'), p('b', 'Retrato de Pareja', 'retrato-de-pareja')];
    expect(inferProductForClip('El Retrato de Pareja sobre la cabecera', pool)).toEqual({
      productId: 'b',
      confidence: 'high',
    });
  });

  it('no nombra ninguno → none', () => {
    const pool = [p('a', 'Canvas Familiar', 'canvas-familiar'), p('b', 'Retrato de Pareja', 'retrato-de-pareja')];
    expect(inferProductForClip('una toma genérica de la sala', pool)).toEqual({
      productId: null,
      confidence: 'none',
    });
  });

  it('nombra a dos → low null (ambiguo)', () => {
    const pool = [p('a', 'Canvas Familiar', 'canvas-familiar'), p('b', 'Retrato de Pareja', 'retrato-de-pareja')];
    const r = inferProductForClip('el Canvas Familiar junto al Retrato de Pareja', pool);
    expect(r).toEqual({ productId: null, confidence: 'low' });
  });

  it('substring sin borde de palabra no cuenta como match (name embebido en otra palabra)', () => {
    // "arte" es substring crudo de "cuartel" — el matcher NO debe confundirlos.
    const pool = [p('a', 'Arte', 'arte'), p('b', 'Paisaje Rural', 'paisaje-rural')];
    const r = inferProductForClip('el dron recorre el cuartel abandonado', pool);
    expect(r).toEqual({ productId: null, confidence: 'none' });
  });

  it('stopwords cortas no cuentan para el umbral de ≥2 tokens', () => {
    // "Retrato de Pareja" solo aporta "retrato" y "pareja" como tokens
    // significativos (>3 chars) — "de" no cuenta. El clip menciona "pareja"
    // pero nunca "retrato", así que no debe alcanzar el umbral de 2 tokens
    // ni la frase completa. "Canvas Familiar" sí aparece completo.
    const pool = [p('a', 'Retrato de Pareja', 'retrato-de-pareja'), p('b', 'Canvas Familiar', 'canvas-familiar')];
    const r = inferProductForClip('la pareja posa junto al canvas familiar de la pared', pool);
    expect(r).toEqual({ productId: 'b', confidence: 'high' });
  });

  it('desambigua por visualDetails cuando dos candidatos comparten el mismo name', () => {
    const pool = [
      pv('a', 'Retrato Clasico', 'retrato-clasico-dorado', 'marco dorado'),
      pv('b', 'Retrato Clasico', 'retrato-clasico-plateado', 'marco plateado'),
    ];
    const r = inferProductForClip('el marco dorado luce increible en esa pared', pool);
    expect(r).toEqual({ productId: 'a', confidence: 'high' });
  });
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
