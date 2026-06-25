import { describe, it, expect } from 'vitest';
import { CreateCharacterStateSchema } from './character-states';

const uuid = '11111111-1111-4111-a111-111111111111';

describe('CreateCharacterStateSchema', () => {
  it('acepta characterId/label/stateImageId válidos', () => {
    expect(CreateCharacterStateSchema.safeParse({
      characterId: uuid, label: 'sudado', stateImageId: uuid, description: 'corriendo bajo el sol',
    }).success).toBe(true);
  });
  it('rechaza label vacío', () => {
    expect(CreateCharacterStateSchema.safeParse({ characterId: uuid, label: '', stateImageId: uuid }).success).toBe(false);
  });
  it('rechaza label demasiado largo', () => {
    expect(CreateCharacterStateSchema.safeParse({ characterId: uuid, label: 'x'.repeat(41), stateImageId: uuid }).success).toBe(false);
  });
  it('rechaza stateImageId no-uuid', () => {
    expect(CreateCharacterStateSchema.safeParse({ characterId: uuid, label: 'sudado', stateImageId: 'no' }).success).toBe(false);
  });
});
