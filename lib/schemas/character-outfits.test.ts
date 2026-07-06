import { describe, it, expect } from 'vitest';
import { CreateCharacterOutfitSchema } from './character-outfits';

// Nota: zod v4 valida el nibble de version del UUID (posicion 15 debe ser
// 1-8 y el nibble de variante 8/9/a/b). El literal '...000000000001' del
// brief no matchea ese regex (solo el nil-UUID exacto o el max-UUID son
// casos especiales), asi que se usa un UUID v4-valido para poder llegar a
// GREEN real.
const VALID_IMAGE_ID = '11111111-1111-1111-8111-111111111111';

describe('CreateCharacterOutfitSchema', () => {
  it('acepta label + imagen', () => {
    const r = CreateCharacterOutfitSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000',
      label: 'deportivo',
      outfitImageId: VALID_IMAGE_ID,
    });
    expect(r.success).toBe(true);
  });
  it('rechaza label vacío o >40', () => {
    expect(CreateCharacterOutfitSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000', label: ' ', outfitImageId: VALID_IMAGE_ID,
    }).success).toBe(false);
    expect(CreateCharacterOutfitSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000', label: 'x'.repeat(41), outfitImageId: VALID_IMAGE_ID,
    }).success).toBe(false);
  });
});
