import { describe, it, expect } from 'vitest';
import { CreateProductSchema, SetProductImagesSchema } from './products';

describe('CreateProductSchema', () => {
  it('acepta nombre solo', () => {
    expect(CreateProductSchema.safeParse({ name: 'Canvas' }).success).toBe(true);
  });
  it('rechaza nombre vacío', () => {
    expect(CreateProductSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
  it('acepta ficha completa', () => {
    const r = CreateProductSchema.safeParse({
      name: 'Canvas Familiar', brandId: '11111111-1111-1111-8111-111111111111',
      medium: 'canvas', heightCm: 60, widthCm: 90, palette: ['#112233'],
    });
    expect(r.success).toBe(true);
  });
});

describe('SetProductImagesSchema', () => {
  it('rechaza >4 imágenes de producto', () => {
    const ids = Array.from({ length: 5 }, () => '11111111-1111-1111-8111-111111111111');
    expect(SetProductImagesSchema.safeParse({ productImageIds: ids, packagingImageIds: [] }).success).toBe(false);
  });
});
