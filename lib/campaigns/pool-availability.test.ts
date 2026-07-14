import { describe, expect, it } from 'vitest';
import { applyPoolAvailability } from './pool-availability';

const base = { available: { product: false, packaging: false }, matcherProductImageId: null };

describe('applyPoolAvailability', () => {
  it('marca product disponible y elige la imagen del matcher desde el pool', () => {
    // Bug 2026-07-14: campaña con kit V3 (sin imágenes legacy) y producto real
    // quedaba con available.product=false → plan dirigido vacío.
    const out = applyPoolAvailability({
      ...base,
      includePackaging: true,
      pool: [{ product_image_ids: ['img-1', 'img-2'], packaging_image_ids: [] }],
    });
    expect(out.available.product).toBe(true);
    expect(out.matcherProductImageId).toBe('img-1');
  });

  it('no pisa la imagen del matcher si ya venía del kit legacy', () => {
    const out = applyPoolAvailability({
      available: { product: true, packaging: false },
      matcherProductImageId: 'legacy-img',
      includePackaging: true,
      pool: [{ product_image_ids: ['img-1'], packaging_image_ids: [] }],
    });
    expect(out.matcherProductImageId).toBe('legacy-img');
  });

  it('usa el primer producto CON imágenes, no el primero del pool', () => {
    const out = applyPoolAvailability({
      ...base,
      includePackaging: true,
      pool: [
        { product_image_ids: [], packaging_image_ids: [] },
        { product_image_ids: ['img-b'], packaging_image_ids: [] },
      ],
    });
    expect(out.matcherProductImageId).toBe('img-b');
  });

  it('el empaque del pool respeta includePackaging', () => {
    const pool = [{ product_image_ids: ['i'], packaging_image_ids: ['pack-1'] }];
    expect(
      applyPoolAvailability({ ...base, includePackaging: true, pool }).available.packaging,
    ).toBe(true);
    expect(
      applyPoolAvailability({ ...base, includePackaging: false, pool }).available.packaging,
    ).toBe(false);
  });

  it('pool vacío no cambia nada', () => {
    const out = applyPoolAvailability({ ...base, includePackaging: true, pool: [] });
    expect(out.available).toEqual({ product: false, packaging: false });
    expect(out.matcherProductImageId).toBeNull();
  });
});
