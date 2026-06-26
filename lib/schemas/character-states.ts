import { z } from 'zod';

// P05: validación de createCharacterStateAction. Vive aquí (no en el módulo
// 'use server') porque un archivo 'use server' solo puede exportar funciones async.
export const CreateCharacterStateSchema = z.object({
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  stateImageId: z.string().uuid(),
  description: z.string().trim().max(300).optional(),
});

// P05 refinado: reemplaza la imagen de un estado por una version re-editada.
export const UpdateCharacterStateImageSchema = z.object({
  stateId: z.string().uuid(),
  stateImageId: z.string().uuid(),
});
