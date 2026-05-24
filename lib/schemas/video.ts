import { z } from 'zod';

// Slugs de fal.ai (un slug = un modelo concreto en su catálogo).
// Standard = más rápido/barato; Pro = más calidad pero más caro.
export const KLING_MODELS = [
  'fal-ai/kling-video/v2.6/standard/text-to-video',
  'fal-ai/kling-video/v2.6/pro/text-to-video',
  'fal-ai/kling-video/v2.6/standard/image-to-video',
] as const;

export const VEO_MODELS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-lite-generate-preview',
] as const;

export const SubmitKlingSchema = z.object({
  kind: z.literal('kling'),
  model: z.enum(KLING_MODELS),
  prompt: z.string().trim().min(1).max(2000),
  negativePrompt: z.string().trim().max(500).optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  duration: z.union([z.literal(5), z.literal(10)]),
  cfgScale: z.number().min(0).max(1).optional(),
  imageUrl: z.string().url().optional(), // para image2video
});

export const SubmitVeoSchema = z.object({
  kind: z.literal('veo'),
  model: z.enum(VEO_MODELS),
  prompt: z.string().trim().min(1).max(1024),
  negativePrompt: z.string().trim().max(500).optional(),
  aspectRatio: z.enum(['16:9', '9:16']),
  resolution: z.enum(['720p', '1080p']),
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  imageReference: z
    .object({
      mimeType: z.string(),
      data: z.string(), // base64
    })
    .optional(),
});

export const SubmitVideoSchema = z.discriminatedUnion('kind', [
  SubmitKlingSchema,
  SubmitVeoSchema,
]);

export type SubmitKlingInput = z.infer<typeof SubmitKlingSchema>;
export type SubmitVeoInput = z.infer<typeof SubmitVeoSchema>;
export type SubmitVideoInput = z.infer<typeof SubmitVideoSchema>;
