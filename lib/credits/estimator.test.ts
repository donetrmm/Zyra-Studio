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
  it('passes=1: no-op, costo base', () => {
    const r = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: { passes: 1 } });
    expect(r.total).toBe(100);
  });
  it('passes=2 duplica el total (zona segura estricta, aditivo)', () => {
    const one = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: {} });
    const two = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: { passes: 2 } });
    expect(two.total).toBe(one.total * 2);
    expect(two.bonuses.some((b) => b.amount === 100)).toBe(true);
  });
  it('passes=2 + conversacional: 2.5x (aditivo, no multiplicativo)', () => {
    const r = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: { conversational: true, passes: 2 } });
    expect(r.total).toBe(250); // Math.ceil(100 * 1.5) + 100 = 250
  });
});
