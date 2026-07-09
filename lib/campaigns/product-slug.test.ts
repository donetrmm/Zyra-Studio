import { describe, it, expect } from 'vitest';
import { productSlug } from './product-slug';

describe('productSlug', () => {
  it('normaliza a kebab minúsculo', () => {
    expect(productSlug('Canvas Familiar 90x60')).toBe('canvas-familiar-90x60');
  });
  it('recorta guiones de los extremos', () => {
    expect(productSlug('  ¡Retrato! ')).toBe('retrato');
  });
  it('cae a "producto" cuando queda vacío', () => {
    expect(productSlug('—')).toBe('producto');
    expect(productSlug('')).toBe('producto');
  });
});
