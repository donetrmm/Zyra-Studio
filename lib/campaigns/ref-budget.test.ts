import { describe, it, expect } from 'vitest';
import { perProductImageCap, estimateItemImageRefs } from './ref-budget';

describe('perProductImageCap', () => {
  it('1 producto → 3 (comportamiento actual)', () => expect(perProductImageCap(1)).toBe(3));
  it('2 productos → 2 c/u', () => expect(perProductImageCap(2)).toBe(2));
  it('3+ productos → 1 c/u', () => {
    expect(perProductImageCap(3)).toBe(1);
    expect(perProductImageCap(5)).toBe(1);
  });
});

describe('estimateItemImageRefs', () => {
  const base = { packagingImageCount: 0, castCount: 0, locationImageCount: 0, hasScaleMap: false, extraCount: 0 };
  it('single-producto espeja el recorte actual: min(imgs, 3) + empaque(≤2)', () => {
    expect(estimateItemImageRefs({ ...base, productImageCounts: [5], packagingImageCount: 3 })).toBe(3 + 2);
  });
  it('multi: cap por producto y SIN empaque', () => {
    expect(estimateItemImageRefs({ ...base, productImageCounts: [5, 4], packagingImageCount: 3 })).toBe(2 + 2);
    expect(estimateItemImageRefs({ ...base, productImageCounts: [5, 4, 2, 1] })).toBe(1 + 1 + 1 + 1);
  });
  it('cast: master + ángulos best-case por presupuesto (1→2, 2→1, 3→0)', () => {
    expect(estimateItemImageRefs({ ...base, productImageCounts: [], castCount: 1 })).toBe(1 + 2);
    expect(estimateItemImageRefs({ ...base, productImageCounts: [], castCount: 2 })).toBe(2 + 2);
    expect(estimateItemImageRefs({ ...base, productImageCounts: [], castCount: 3 })).toBe(3);
  });
  it('suma locación, mapa y extras', () => {
    expect(estimateItemImageRefs({
      productImageCounts: [2], packagingImageCount: 0, castCount: 0,
      locationImageCount: 1, hasScaleMap: true, extraCount: 2,
    })).toBe(2 + 1 + 1 + 2);
  });
  it('caso showcase que dispara el badge: 4 productos + 2 cast + locación > 9', () => {
    expect(estimateItemImageRefs({
      productImageCounts: [3, 3, 3, 3], packagingImageCount: 0, castCount: 2,
      locationImageCount: 1, hasScaleMap: false, extraCount: 2,
    })).toBe(4 + 4 + 1 + 2); // 11 > 9
  });
});
