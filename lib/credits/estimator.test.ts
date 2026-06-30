import { describe, it, expect } from 'vitest';
import { estimateCredits } from './estimator';
import type { PricingRow } from './types';

const NANO_MODEL = 'gemini-3-pro-image-preview';
const NANO_VARIANT = 'pro';
const NANO_ROWS: PricingRow[] = [
  { provider: 'nano-banana', model_id: NANO_MODEL, variant: NANO_VARIANT, credits_cost: 100, unit_size: null, unit_label: null },
];

describe('estimateCredits - nano-banana passes', () => {
  it('sin passes: costo base', () => {
    const r = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: {} });
    expect(r.total).toBe(100);
  });
  it('passes=2 duplica el total (zona segura estricta)', () => {
    const one = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: {} });
    const two = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: { passes: 2 } });
    expect(two.total).toBe(one.total * 2);
    expect(two.multipliers.some((m) => m.factor === 2)).toBe(true);
  });
});
