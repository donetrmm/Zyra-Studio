import { describe, it, expect } from 'vitest';
import { CreateStudioSessionSchema, SubmitStudioTurnSchema } from './studio';

// zod v4 valida el nibble de variante RFC 4122 (8/9/a/b) en `.uuid()`; el resto
// del repo ya usa este formato en fixtures (ver character-outfits.test.ts,
// products.test.ts) en vez del "todo unos" ingenuo.
const UUID = '11111111-1111-1111-8111-111111111111';
const UUID_2 = '22222222-2222-2222-8222-222222222222';

describe('CreateStudioSessionSchema', () => {
  it('acepta un activo válido con provider por defecto', () => {
    const r = CreateStudioSessionSchema.safeParse({ assetType: 'product', assetId: UUID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.provider).toBe('nano-banana');
  });
  it('rechaza assetType inválido', () => {
    expect(CreateStudioSessionSchema.safeParse({ assetType: 'brand', assetId: UUID }).success).toBe(false);
  });
});

describe('SubmitStudioTurnSchema', () => {
  const base = {
    sessionId: UUID,
    provider: 'gpt-image',
    model: 'gpt-image-2',
    variant: 'medium',
    prompt: 'una taza azul sobre mármol',
  };
  it('acepta un turno válido', () => {
    expect(SubmitStudioTurnSchema.safeParse(base).success).toBe(true);
  });
  it('rechaza prompt vacío', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, prompt: '' }).success).toBe(false);
  });
  it('rechaza más de 6 referencias', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, referenceIds: Array(7).fill(UUID_2) }).success).toBe(false);
  });
  it('rechaza provider desconocido', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, provider: 'midjourney' }).success).toBe(false);
  });
  it('acepta flux con model y variant propios', () => {
    const r = SubmitStudioTurnSchema.safeParse({ ...base, provider: 'flux', model: 'flux-2-max', variant: 'default' });
    expect(r.success).toBe(true);
  });
  it('rechaza model que no corresponde al provider (flux + gpt-image-2)', () => {
    const r = SubmitStudioTurnSchema.safeParse({ ...base, provider: 'flux', model: 'gpt-image-2', variant: 'default' });
    expect(r.success).toBe(false);
  });
  it('rechaza model que no corresponde al provider (nano-banana + gpt-image-2)', () => {
    const r = SubmitStudioTurnSchema.safeParse({ ...base, provider: 'nano-banana', model: 'gpt-image-2', variant: '2k' });
    expect(r.success).toBe(false);
  });
  it('rechaza variant que no corresponde al provider (gpt-image + 4k)', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, variant: '4k' }).success).toBe(false);
  });
  it('acepta nano-banana con model y variant propios', () => {
    const r = SubmitStudioTurnSchema.safeParse({ ...base, provider: 'nano-banana', model: 'gemini-3-pro-image-preview', variant: '2k' });
    expect(r.success).toBe(true);
  });
});
