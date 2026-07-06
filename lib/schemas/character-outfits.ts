import { z } from 'zod';

// Vestuario (specs/v2/16): validación de createCharacterOutfitAction. Vive aquí
// (no en el módulo 'use server') porque un archivo 'use server' solo puede
// exportar funciones async. Espejo de character-states.ts.
export const CreateCharacterOutfitSchema = z.object({
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  outfitImageId: z.string().uuid(),
  description: z.string().trim().max(300).optional(),
});

export const UpdateCharacterOutfitImageSchema = z.object({
  outfitId: z.string().uuid(),
  outfitImageId: z.string().uuid(),
});
