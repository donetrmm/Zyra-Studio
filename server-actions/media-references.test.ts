import { describe, it, expect } from 'vitest';
import { SetReferenceUsageSchema } from '@/lib/schemas/generations';

describe('SetReferenceUsageSchema', () => {
  it('acepta refId uuid + usage corto', () => {
    expect(SetReferenceUsageSchema.safeParse({
      refId: '11111111-1111-4111-a111-111111111111', usage: 'three-quarter view',
    }).success).toBe(true);
  });
  it('acepta usage vacío (para limpiar)', () => {
    expect(SetReferenceUsageSchema.safeParse({
      refId: '11111111-1111-4111-a111-111111111111', usage: '',
    }).success).toBe(true);
  });
  it('rechaza refId no-uuid', () => {
    expect(SetReferenceUsageSchema.safeParse({ refId: 'nope', usage: 'x' }).success).toBe(false);
  });
  it('rechaza usage demasiado largo', () => {
    expect(SetReferenceUsageSchema.safeParse({
      refId: '11111111-1111-4111-a111-111111111111', usage: 'x'.repeat(121),
    }).success).toBe(false);
  });
});
