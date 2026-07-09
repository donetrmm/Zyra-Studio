import { describe, it, expect } from 'vitest';
import { inferProductForClip, type ProductCandidate } from './infer-assignment';

const p = (id: string, name: string, slug: string): ProductCandidate => ({
  id,
  name,
  slug,
  visualDetails: null,
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
});
