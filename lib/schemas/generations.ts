import { z } from 'zod';

const NanoBananaAspectRatios = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
] as const;

const ResolutionEnum = z.enum(['1k', '2k', '4k']);

const ReferenceItem = z.object({
  id: z.string().uuid(),
  storagePath: z.string().min(1),
});

export const NanoBananaInputSchema = z.object({
  provider: z.literal('nano-banana'),
  model: z.enum(['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview']),
  variant: ResolutionEnum,
  prompt: z.string().min(1).max(8000),
  negativePrompt: z.string().max(2000).optional(),
  aspectRatio: z.enum(NanoBananaAspectRatios).default('1:1'),
  references: z.array(ReferenceItem).max(14).default([]),
  hasTextInImage: z.boolean().default(false),
  conversational: z.boolean().default(false),
  useGrounding: z.boolean().default(false),
});

export const FluxInputSchema = z.object({
  provider: z.literal('flux'),
  model: z.literal('flux-2-pro-preview'),
  variant: z.literal('default'),
  prompt: z.string().min(1).max(8000),
  negativePrompt: z.string().max(2000).optional(),
  aspectRatio: z.enum(['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4']).default('1:1'),
  megapixels: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  references: z.array(ReferenceItem).max(8).default([]),
  photoreal: z.boolean().default(false),
});

export const SubmitGenerationSchema = z.discriminatedUnion('provider', [
  NanoBananaInputSchema,
  FluxInputSchema,
]);

export type NanoBananaInput = z.infer<typeof NanoBananaInputSchema>;
export type FluxInput = z.infer<typeof FluxInputSchema>;
export type SubmitGenerationInput = z.infer<typeof SubmitGenerationSchema>;

export const PreviewCostSchema = SubmitGenerationSchema;

export const CreateMediaReferenceSchema = z.object({
  storagePath: z.string().min(1),
  type: z.enum(['image', 'audio', 'video']),
  name: z.string().max(120).optional(),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export const GetUploadUrlSchema = z.object({
  filename: z.string().min(1).max(180),
  mimeType: z
    .string()
    .regex(/^image\/(jpeg|png|webp|gif|bmp|tiff)$/i, 'mimeType inválido'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, 'Tamaño máximo 10 MB'),
});

const ASPECT_RATIO_DIMENSIONS: Record<string, [number, number]> = {
  '1:1': [1, 1],
  '3:2': [3, 2],
  '2:3': [2, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:3': [4, 3],
  '3:4': [3, 4],
};

export function fluxDimensions(aspectRatio: string, megapixels: number): { width: number; height: number } {
  const [aw, ah] = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? [1, 1];
  const targetPixels = megapixels * 1_000_000;
  const ratio = aw / ah;
  const heightF = Math.sqrt(targetPixels / ratio);
  const widthF = heightF * ratio;
  const round = (n: number) => Math.round(n / 32) * 32;
  return { width: Math.max(256, round(widthF)), height: Math.max(256, round(heightF)) };
}
