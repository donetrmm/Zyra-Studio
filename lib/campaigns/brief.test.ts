import { describe, it, expect } from 'vitest';
import { ProductBriefSchema } from './brief';

const base = { productName: 'Canvas', category: 'home' as const };

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
