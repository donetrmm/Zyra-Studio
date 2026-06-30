import { describe, it, expect } from 'vitest';
import { ProductBriefSchema, BRIEF_SYSTEM } from './brief';

it('el SYSTEM instruye separar objeto de contenido impreso', () => {
  expect(BRIEF_SYSTEM).toMatch(/impres|printed/i);
  expect(BRIEF_SYSTEM).toMatch(/objeto|object/i);
});

const base = { productName: 'Canvas', category: 'home' as const };

describe('ProductBriefSchema — medium y thicknessMm', () => {
  it('acepta medium y thicknessMm opcionales', () => {
    const r = ProductBriefSchema.parse({ productName: 'X', category: 'home', medium: 'canvas print', thicknessMm: 10 });
    expect(r.medium).toBe('canvas print');
    expect(r.thicknessMm).toBe(10);
  });
  it('rechaza thicknessMm <= 0 y > 500', () => {
    expect(ProductBriefSchema.safeParse({ productName: 'X', category: 'home', thicknessMm: 0 }).success).toBe(false);
    expect(ProductBriefSchema.safeParse({ productName: 'X', category: 'home', thicknessMm: 600 }).success).toBe(false);
  });
  it('tolera ausencia (cero cambio)', () => {
    const r = ProductBriefSchema.parse({ productName: 'X', category: 'home' });
    expect(r.medium).toBeUndefined();
    expect(r.thicknessMm).toBeUndefined();
  });
});

describe('ProductBriefSchema — dimensiones', () => {
  it('acepta heightCm/widthCm válidos', () => {
    const r = ProductBriefSchema.safeParse({ ...base, heightCm: 150, widthCm: 100 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.heightCm).toBe(150);
      expect(r.data.widthCm).toBe(100);
    }
  });

  it('tolera ausencia (undefined) sin romper', () => {
    const r = ProductBriefSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.heightCm).toBeUndefined();
  });

  it('rechaza valores ≤ 0', () => {
    expect(ProductBriefSchema.safeParse({ ...base, heightCm: 0 }).success).toBe(false);
    expect(ProductBriefSchema.safeParse({ ...base, heightCm: -5 }).success).toBe(false);
  });

  it('rechaza valores absurdos (> 2000)', () => {
    expect(ProductBriefSchema.safeParse({ ...base, heightCm: 5000 }).success).toBe(false);
  });
});
