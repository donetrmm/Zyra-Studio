import { describe, it, expect } from 'vitest';
import { UpsertLocationSchema } from './locations';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('UpsertLocationSchema — campos del mapa de escala (P15)', () => {
  it('acepta scaleMapImageId (uuid) y scaleMapNotes', () => {
    const r = UpsertLocationSchema.safeParse({ name: 'Calle', scaleMapImageId: UUID, scaleMapNotes: 'mascota 2x el humano' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scaleMapImageId).toBe(UUID);
      expect(r.data.scaleMapNotes).toBe('mascota 2x el humano');
    }
  });

  it('omitir los campos del mapa es válido (opcionales)', () => {
    expect(UpsertLocationSchema.safeParse({ name: 'Calle' }).success).toBe(true);
  });

  it('rechaza scaleMapImageId que no sea uuid', () => {
    expect(UpsertLocationSchema.safeParse({ name: 'Calle', scaleMapImageId: 'nope' }).success).toBe(false);
  });
});
