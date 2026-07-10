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

// Modelos y variants válidos por proveedor. El schema los ata al provider (via
// superRefine) para que la validación sea la frontera real — un combo inválido
// (p. ej. nano-banana + gpt-image-2) se rechaza aquí, no aguas abajo en el
// estimador. El pricing sigue siendo la autoridad final del combo model×variant.
const NANO_MODELS = ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'];
const NANO_VARIANTS = ['1k', '2k', '4k'];
const GPT_MODELS = ['gpt-image-2', 'gpt-image-1', 'gpt-image-1-mini'];
const GPT_VARIANTS = ['low', 'medium', 'high', 'default'];

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
    const [models, variants] =
      val.provider === 'nano-banana' ? [NANO_MODELS, NANO_VARIANTS] : [GPT_MODELS, GPT_VARIANTS];
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
