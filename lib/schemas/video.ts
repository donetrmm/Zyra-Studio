import { z } from 'zod';

// Slugs de fal.ai (un slug = un modelo concreto en su catálogo).
// Standard = más rápido/barato; Pro = más calidad pero más caro.
// i2v se selecciona automáticamente cuando el usuario sube imagen de referencia.
export const KLING_MODELS = [
  'fal-ai/kling-video/v3/standard/text-to-video',
  'fal-ai/kling-video/v3/pro/text-to-video',
  'fal-ai/kling-video/v3/standard/image-to-video',
] as const;

export const KLING_T2V_MODELS = [
  'fal-ai/kling-video/v3/standard/text-to-video',
  'fal-ai/kling-video/v3/pro/text-to-video',
] as const;

export const VEO_MODELS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-lite-generate-preview',
] as const;

export const SubmitKlingSchema = z.object({
  kind: z.literal('kling'),
  model: z.enum(KLING_T2V_MODELS),
  prompt: z.string().trim().min(1).max(2000),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  duration: z.number().int().min(5).max(10),
  cfgScale: z.number().min(0).max(1).optional(),
  generateAudio: z.boolean().optional(),
  referenceStoragePath: z.string().optional(),
  endReferenceStoragePath: z.string().optional(),
  campaignId: z.string().uuid().optional(),
});

export const SubmitVeoSchema = z.object({
  kind: z.literal('veo'),
  model: z.enum(VEO_MODELS),
  prompt: z.string().trim().min(1).max(1024),
  aspectRatio: z.enum(['16:9', '9:16']),
  resolution: z.enum(['720p', '1080p']),
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  referenceStoragePath: z.string().optional(),
  campaignId: z.string().uuid().optional(),
});

export const SubmitVideoSchema = z.discriminatedUnion('kind', [
  SubmitKlingSchema,
  SubmitVeoSchema,
]);

export type SubmitKlingInput = z.infer<typeof SubmitKlingSchema>;
export type SubmitVeoInput = z.infer<typeof SubmitVeoSchema>;
export type SubmitVideoInput = z.infer<typeof SubmitVideoSchema>;
