import { describe, it, expect } from 'vitest';
import { IngestInputSchema, IngestRawSchema } from './ingest';

describe('IngestInputSchema', () => {
  it('acepta un prompt largo (>6000) hasta 24000', () => {
    const big = 'a'.repeat(20000);
    const parsed = IngestInputSchema.safeParse({ masterPrompt: big });
    expect(parsed.success).toBe(true);
  });
  it('rechaza vacío', () => {
    expect(IngestInputSchema.safeParse({ masterPrompt: '   ' }).success).toBe(false);
  });
  it('recorta a 24000 por el trim + max', () => {
    const parsed = IngestInputSchema.safeParse({ masterPrompt: 'a'.repeat(24001) });
    expect(parsed.success).toBe(false);
  });
});

describe('IngestRawSchema (laxo)', () => {
  it('un campo malformado no tira el objeto: cae a su default', () => {
    const parsed = IngestRawSchema.safeParse({
      productFacts: { heightCm: 'no-numero', medium: 'canvas' },
      visualStyle: 'inventado',
      guidelines: { safeCrop: '4:5', showFullProduct: 'si' },
      narrative: 'Clip 1: ...',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.productFacts.heightCm).toBeNull();
      expect(parsed.data.productFacts.medium).toBe('canvas');
      expect(parsed.data.visualStyle).toBeNull();
      expect(parsed.data.guidelines.safeCrop).toBe('4:5');
      expect(parsed.data.guidelines.showFullProduct).toBe(false);
    }
  });
});
