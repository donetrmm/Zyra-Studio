import { z } from 'zod';

export const StudioProviderSchema = z.enum(['nano-banana', 'gpt-image', 'flux']);
export const StudioAssetTypeSchema = z.enum(['product', 'location', 'character', 'panel']);
export type StudioProvider = z.infer<typeof StudioProviderSchema>;
export type StudioAssetType = z.infer<typeof StudioAssetTypeSchema>;

export const CreateStudioSessionSchema = z.object({
  assetType: StudioAssetTypeSchema,
  assetId: z.string().uuid(),
  provider: StudioProviderSchema.default('nano-banana'),
  modelId: z.string().min(1).default('gemini-3-pro-image-preview'),
});
export type CreateStudioSessionInput = z.infer<typeof CreateStudioSessionSchema>;

// Modelos y variants válidos por proveedor. El schema los ata al provider (via
// superRefine) para que la validación sea la frontera real — un combo inválido
// (p. ej. nano-banana + gpt-image-2) se rechaza aquí, no aguas abajo en el
// estimador. El pricing sigue siendo la autoridad final del combo model×variant.
const NANO_MODELS = ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'];
const NANO_VARIANTS = ['1k', '2k', '4k'];
const GPT_MODELS = ['gpt-image-2', 'gpt-image-1', 'gpt-image-1-mini'];
const GPT_VARIANTS = ['low', 'medium', 'high', 'default'];
// FLUX.2 [pro]/[max] por el gateway (bfl/…): sin sub-calidad, variant fija.
const FLUX_MODELS = ['flux-2-pro', 'flux-2-max'];
const FLUX_VARIANTS = ['default'];

const MODELS_BY_PROVIDER: Record<StudioProvider, [string[], string[]]> = {
  'nano-banana': [NANO_MODELS, NANO_VARIANTS],
  'gpt-image': [GPT_MODELS, GPT_VARIANTS],
  flux: [FLUX_MODELS, FLUX_VARIANTS],
};

export const SubmitStudioTurnSchema = z
  .object({
    sessionId: z.string().uuid(),
    provider: StudioProviderSchema,
    model: z.string().min(1),
    variant: z.string().min(1), // '1k'/'2k'/'4k' (nano) | 'low'/'medium'/'high'/'default' (gpt-image)
    prompt: z.string().min(1).max(12000),
    referenceIds: z.array(z.string().uuid()).max(6).optional(),
    parentGenerationId: z.string().uuid().nullable().optional(),
    keepIdentical: z.boolean().optional(),
    aspectRatio: z.string().optional(),
    assetType: StudioAssetTypeSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const [models, variants] = MODELS_BY_PROVIDER[val.provider];
    if (!models.includes(val.model)) {
      ctx.addIssue({ code: 'custom', path: ['model'], message: `model inválido para ${val.provider}` });
    }
    if (!variants.includes(val.variant)) {
      ctx.addIssue({ code: 'custom', path: ['variant'], message: `variant inválida para ${val.provider}` });
    }
    // El gateway soporta hasta 4 imágenes de entrada para gpt-image (nano tolera
    // más). Se rechaza temprano en vez de dejar que el gateway falle el turno.
    if (val.provider === 'gpt-image' && (val.referenceIds?.length ?? 0) > 4) {
      ctx.addIssue({ code: 'custom', path: ['referenceIds'], message: 'gpt-image acepta máximo 4 referencias' });
    }
  });
export type SubmitStudioTurnInput = z.infer<typeof SubmitStudioTurnSchema>;

// Adjuntar una imagen generada en el estudio a un rol del activo (locación,
// personaje, producto). role se valida contra ATTACH_ROLES[assetType] en la
// action (no aquí: el mapa vive en lib/studio/attach-merge.ts para no crear
// una dependencia de schemas → lib/studio).
export const AttachStudioImageSchema = z.object({
  assetType: StudioAssetTypeSchema,
  assetId: z.string().uuid(),
  role: z.string().min(1),
  referenceId: z.string().uuid(),
});
export type AttachStudioImageInput = z.infer<typeof AttachStudioImageSchema>;
