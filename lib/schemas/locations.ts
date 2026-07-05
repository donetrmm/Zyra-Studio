import { z } from 'zod';

// Locación: el "dónde" reutilizable de una secuencia. master_image_id OPCIONAL.
// Vive aquí (no en el módulo 'use server') porque se exporta para test determinista
// y un archivo 'use server' solo puede exportar funciones async.
export const UpsertLocationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // 2000: cabe una descripción exacta o un prompt pegado (feedback 2026-07-04);
  // el techo del prompt final de generación es 8000.
  description: z.string().trim().max(2000).optional(),
  masterImageId: z.string().uuid().optional(),
  referenceImageIds: z.array(z.string().uuid()).max(4).default([]),
  // P15: esquema top-down de escala/posición (opcional).
  scaleMapImageId: z.string().uuid().optional(),
  scaleMapNotes: z.string().trim().max(300).optional(),
});
