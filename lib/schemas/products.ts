import { z } from 'zod';

// Ficha física del producto. Todo opcional salvo el nombre: un producto puede
// existir con solo un nombre y una imagen. Las medidas anclan la escala en el
// storyboard (sin ellas sale a tamaño arbitrario).
export const CreateProductSchema = z.object({
  brandId: z.string().uuid().nullable().optional(), // null = producto sin marca
  name: z.string().trim().min(1).max(120),
  medium: z.string().trim().max(120).optional().nullable(),
  heightCm: z.number().positive().max(10000).optional().nullable(),
  widthCm: z.number().positive().max(10000).optional().nullable(),
  thicknessMm: z.number().positive().max(100000).optional().nullable(),
  weightKg: z.number().positive().max(100000).optional().nullable(),
  visualDetails: z.string().trim().max(2000).optional().nullable(),
  palette: z.array(z.string().trim().min(1).max(50)).max(12).optional().nullable(),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

// Update: mismo shape, todos los campos opcionales (patch parcial) salvo que
// name, si viene, sigue siendo no vacío.
export const UpdateProductSchema = CreateProductSchema.partial().extend({
  name: z.string().trim().min(1).max(120).optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// Imágenes de producto/empaque: ids de media_references del workspace (ownership
// se valida en la action). Máximos como el kit (4 producto, 2 empaque).
export const SetProductImagesSchema = z.object({
  productImageIds: z.array(z.string().uuid()).max(4),
  packagingImageIds: z.array(z.string().uuid()).max(2),
});
export type SetProductImagesInput = z.infer<typeof SetProductImagesSchema>;
