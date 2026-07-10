import { z } from 'zod';

export const StudioProviderSchema = z.enum(['nano-banana', 'gpt-image']);
export const StudioAssetTypeSchema = z.enum(['product', 'location', 'character']);
export type StudioProvider = z.infer<typeof StudioProviderSchema>;
export type StudioAssetType = z.infer<typeof StudioAssetTypeSchema>;

export const CreateStudioSessionSchema = z.object({
  assetType: StudioAssetTypeSchema,
  assetId: z.string().uuid(),
  provider: StudioProviderSchema.default('nano-banana'),
  modelId: z.string().min(1).default('gemini-3-pro-image-preview'),
});
export type CreateStudioSessionInput = z.infer<typeof CreateStudioSessionSchema>;

export const SubmitStudioTurnSchema = z.object({
  sessionId: z.string().uuid(),
  provider: StudioProviderSchema,
  model: z.string().min(1),
  variant: z.string().min(1), // '1k'/'2k'/'4k' (nano) | 'low'/'medium'/'high' (gpt-image-2) | 'default'
  prompt: z.string().min(1).max(12000),
  referenceIds: z.array(z.string().uuid()).max(6).optional(),
  parentGenerationId: z.string().uuid().nullable().optional(),
  keepIdentical: z.boolean().optional(),
  aspectRatio: z.string().optional(),
});
export type SubmitStudioTurnInput = z.infer<typeof SubmitStudioTurnSchema>;
