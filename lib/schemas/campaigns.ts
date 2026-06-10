import { z } from 'zod';

// Schemas de la capa de campañas V2 (specs/v2/01-fundacion-v2.md, tarea 9).
// Las server actions de Fase C validan TODO input con estos schemas antes
// de tocar la base.

// Slugs de Seedance 2.0 en fal.ai (un slug = operación × tier).
export const SEEDANCE_MODELS = [
  'bytedance/seedance-2.0/text-to-video',
  'bytedance/seedance-2.0/image-to-video',
  'bytedance/seedance-2.0/reference-to-video',
  'bytedance/seedance-2.0/fast/text-to-video',
  'bytedance/seedance-2.0/fast/image-to-video',
  'bytedance/seedance-2.0/fast/reference-to-video',
] as const;

export const SEEDANCE_ASPECT_RATIOS = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

// Submit de una generación Seedance suelta. Se integra al discriminated
// union de SubmitVideoSchema cuando la UI lo exponga (Fase C); mientras,
// lo consume el orquestador de campañas.
export const SubmitSeedanceSchema = z
  .object({
    kind: z.literal('seedance'),
    model: z.enum(SEEDANCE_MODELS),
    prompt: z.string().trim().min(1).max(4000),
    aspectRatio: z.enum(SEEDANCE_ASPECT_RATIOS).default('auto'),
    resolution: z.enum(SEEDANCE_RESOLUTIONS).default('720p'),
    duration: z.number().int().min(4).max(15).optional(), // undefined → auto
    generateAudio: z.boolean().default(true),
    seed: z.number().int().optional(),
    referenceStoragePath: z.string().optional(),          // image2video: frame inicial
    endReferenceStoragePath: z.string().optional(),
    referenceImagePaths: z.array(z.string()).max(9).optional(),
    referenceVideoPaths: z.array(z.string()).max(3).optional(),
    referenceAudioPaths: z.array(z.string()).max(3).optional(),
    campaignId: z.string().uuid().optional(),
    campaignItemId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    const total =
      (val.referenceImagePaths?.length ?? 0) +
      (val.referenceVideoPaths?.length ?? 0) +
      (val.referenceAudioPaths?.length ?? 0);
    if (total > 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Máximo 12 archivos de referencia en total (9 imágenes + 3 videos + 3 audios)',
      });
    }
    if (val.resolution === '1080p' && val.model.includes('/fast/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El tier fast no soporta 1080p',
      });
    }
  });

// ============ Campañas ============

export const CreateCampaignSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  goal: z.enum(['awareness', 'conversion', 'mixed']).default('mixed'),
  market: z.string().trim().max(80).optional(),
  dateStart: z.coerce.date().optional(),
  dateEnd: z.coerce.date().optional(),
  // referencia de producto: path de imagen subida o URL pública de la tienda
  productReferencePath: z.string().optional(),
  productUrl: z.string().url().optional(),
});

export const CampaignItemSchema = z.object({
  campaignId: z.string().uuid(),
  formatId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  modelSlug: z.enum(SEEDANCE_MODELS),
  durationS: z.number().int().min(4).max(15).optional(),
  aspectRatio: z.enum(SEEDANCE_ASPECT_RATIOS).default('9:16'),
  scene: z.string().trim().max(200).optional(),
  audio: z.boolean().default(true),
  characterId: z.string().uuid().optional(),
  scenePrompt: z.string().trim().min(1).max(4000),
  // copy para publicar el creativo; nunca se compila dentro del prompt
  caption: z.string().trim().max(2200).optional(),
  scheduledDate: z.coerce.date().optional(),
});

export const UpdateCampaignItemSchema = CampaignItemSchema.partial().extend({
  itemId: z.string().uuid(),
});

// ============ Plantillas vivas ============

export const CreateTemplateSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  sourceGenerationId: z.string().uuid(),
  formatId: z.string().uuid().optional(),
  fixedParams: z.record(z.string(), z.unknown()),
  slots: z.record(z.string(), z.unknown()),
});

// ============ Formatos custom ============

export const CreateFormatSchema = z.object({
  workspaceId: z.string().uuid(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug en kebab-case'),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  register: z.string().trim().max(300).optional(),
  cameraStyle: z.string().trim().max(300).optional(),
  pacing: z.string().trim().max(200).optional(),
  requiredRefs: z.array(z.enum(['product', 'character', 'packaging'])).default([]),
  defaultDurationS: z.number().int().min(4).max(15).default(8),
  defaultAudio: z.boolean().default(true),
});

export type SubmitSeedanceInput = z.infer<typeof SubmitSeedanceSchema>;
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type CampaignItemInput = z.infer<typeof CampaignItemSchema>;
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
export type CreateFormatInput = z.infer<typeof CreateFormatSchema>;
