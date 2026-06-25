import { describe, it, expect } from 'vitest';
import { CreateCampaignStudioSchema, UpdateCampaignItemSchema } from './campaigns';

// NOTE: zod v4 enforces strict RFC 9562 UUID validation (version nibble [1-8],
// variant nibble [89ab]). The brief used all-repeated-digit UUIDs which fail
// zod v4 — replaced with proper v4 UUIDs while keeping the test contract identical.
const base = { name: 'Camp', productImageIds: ['11111111-1111-4111-a111-111111111111'] };

describe('CreateCampaignStudioSchema — musicRefId', () => {
  it('acepta un musicRefId uuid válido', () => {
    const r = CreateCampaignStudioSchema.safeParse({
      ...base,
      musicRefId: '22222222-2222-4222-a222-222222222222',
    });
    expect(r.success).toBe(true);
  });
  it('rechaza un musicRefId que no es uuid', () => {
    const r = CreateCampaignStudioSchema.safeParse({ ...base, musicRefId: 'no-uuid' });
    expect(r.success).toBe(false);
  });
  it('es opcional (sin musicRefId sigue siendo válido)', () => {
    expect(CreateCampaignStudioSchema.safeParse(base).success).toBe(true);
  });
});

describe('UpdateCampaignItemSchema — characterStateHint (P05)', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  it('acepta un label de estado', () => {
    const r = UpdateCampaignItemSchema.safeParse({ itemId: id, characterStateHint: 'sudado' });
    expect(r.success).toBe(true);
  });
  it('acepta null (limpiar a neutral)', () => {
    const r = UpdateCampaignItemSchema.safeParse({ itemId: id, characterStateHint: null });
    expect(r.success).toBe(true);
  });
  it('rechaza un valor no string|null', () => {
    const r = UpdateCampaignItemSchema.safeParse({ itemId: id, characterStateHint: 123 });
    expect(r.success).toBe(false);
  });
});
