import { describe, it, expect } from 'vitest';
import { estimateCredits } from './estimator';

const rows = [
  { provider: 'gpt-image', model_id: 'gpt-image-2', variant: 'medium', credits_cost: 110, unit_size: null, unit_label: null },
  { provider: 'gpt-image', model_id: 'gpt-image-1', variant: 'default', credits_cost: 60, unit_size: null, unit_label: null },
];

describe('estimateCredits gpt-image (plano por imagen)', () => {
  it('gpt-image-2 medium = 110', () => {
    expect(estimateCredits(rows, { provider: 'gpt-image', model: 'gpt-image-2', variant: 'medium' }).total).toBe(110);
  });
  it('gpt-image-1 default = 60', () => {
    expect(estimateCredits(rows, { provider: 'gpt-image', model: 'gpt-image-1', variant: 'default' }).total).toBe(60);
  });
});
