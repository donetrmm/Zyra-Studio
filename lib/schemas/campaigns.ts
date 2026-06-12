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
    // Entero no negativo de 32 bits: es lo que acepta fal; negativo → 422.
    seed: z.number().int().min(0).max(2147483647).optional(),
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
// El workspace NUNCA viene del cliente: la server action lo lee de la sesión
// (requireWorkspace). Lo mismo aplica a user_id.

export const CreateCampaignStudioSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.enum(['awareness', 'conversion', 'mixed']).default('mixed'),
    market: z.string().trim().max(80).optional(),
    // Camino sin walls (specs/v2/06 §4.4): el wizard acepta imágenes de
    // producto directas; el Brand Kit se crea implícito. Elegir un kit
    // existente es la alternativa secundaria.
    brandKitId: z.string().uuid().optional(),
    productImageIds: z.array(z.string().uuid()).min(1).max(6).optional(),
    // Página del producto: su texto enriquece la auto-detección del brief.
    productUrl: z.string().trim().url().max(500).optional(),
    // Idioma del diálogo hablado de los videos (el prompt va en inglés siempre).
    language: z.enum(['es', 'en']).default('es'),
    // Pool de personajes de la campaña (máx 3). El primero es el principal.
    characterIds: z.array(z.string().uuid()).max(3).default([]),
    // Si la campaña usa las imágenes de empaque del Brand Kit (migración 032).
    // Con false, el plan omite formatos que exigen empaque y la generación no
    // envía packaging_image_ids.
    includePackaging: z.boolean().default(true),
    dateStart: z.coerce.date().optional(),
    dateEnd: z.coerce.date().optional(),
  })
  .refine((d) => Boolean(d.brandKitId) || (d.productImageIds?.length ?? 0) > 0, {
    message: 'Sube al menos una imagen de producto o elige un Brand Kit',
  });

export const GeneratePlanSchema = z.object({
  campaignId: z.string().uuid(),
  // Solo aplica al plan sugerido SIN ideas (mix por categoría). Con ideas,
  // el matcher deriva cuántos creativos salen (specs/v2/07). El techo demo
  // de 30 lo aplica el planner en ambos caminos (doc V2 §5.5).
  totalItems: z.number().int().min(2).max(30).default(6),
  // Ideas en lenguaje natural (specs/v2/07): el plan se construye de ellas —
  // un creativo por idea (más si pide cantidad), formato custom si no encaja.
  userIdeas: z.string().trim().max(2000).optional(),
});

export const ApproveBatchSchema = z.object({
  campaignId: z.string().uuid(),
  formatId: z.string().uuid(),
  mode: z.enum(['sample', 'full']),
});

export const RequestFinalSchema = z.object({
  itemId: z.string().uuid(),
});

// ============ Fase D: plantillas vivas y variantes ============

export const DistillTemplateSchema = z.object({
  generationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export const GenerateSeriesSchema = z.object({
  templateId: z.string().uuid(),
  count: z.number().int().min(2).max(8),
  rotateCharacters: z.boolean().default(false),
});

export const CreateVariantSchema = z
  .object({
    generationId: z.string().uuid(),
    mode: z.enum(['extend', 'replace_character', 'change_action', 'bridge']),
    // extend: cuántos segundos y qué pasa en la continuación
    extendSeconds: z.number().int().min(4).max(8).optional(),
    continuation: z.string().trim().max(500).optional(),
    // replace_character: el nuevo personaje del Cast
    characterId: z.string().uuid().optional(),
    // change_action: nueva acción/desenlace; sujeto, escena y cámara se conservan
    newAction: z.string().trim().max(500).optional(),
    // bridge: el clip destino — la escena puente conecta el final del origen
    // con el inicio del destino
    targetGenerationId: z.string().uuid().optional(),
    bridgeSeconds: z.number().int().min(4).max(8).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'extend' && !val.extendSeconds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'extend requiere extendSeconds' });
    }
    if (val.mode === 'replace_character' && !val.characterId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'replace_character requiere characterId' });
    }
    if (val.mode === 'change_action' && !val.newAction?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'change_action requiere newAction' });
    }
    if (val.mode === 'bridge') {
      if (!val.targetGenerationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'bridge requiere targetGenerationId' });
      }
      if (val.targetGenerationId === val.generationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'El puente necesita dos clips distintos' });
      }
    }
  });

export const CampaignItemSchema = z.object({
  formatId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  modelSlug: z.enum(SEEDANCE_MODELS),
  durationS: z.number().int().min(4).max(15).optional(),
  aspectRatio: z.enum(SEEDANCE_ASPECT_RATIOS).default('9:16'),
  scene: z.string().trim().max(200).optional(),
  audio: z.boolean().default(true),
  characterId: z.string().uuid().optional(),
  // Multi-personaje (máx 3, orden = referencias del prompt). characterId se
  // mantiene como principal sincronizado (= characterIds[0]).
  characterIds: z.array(z.string().uuid()).max(3).optional(),
  scenePrompt: z.string().trim().min(1).max(4000),
  // copy para publicar el creativo; nunca se compila dentro del prompt
  caption: z.string().trim().max(2200).optional(),
  scheduledDate: z.coerce.date().optional(),
});

export const UpdateCampaignItemSchema = CampaignItemSchema.partial().extend({
  itemId: z.string().uuid(),
});

// Agregar un creativo suelto al plan (specs/v2/03 tarea 1: addItem).
// El modelo y el caption los decide el server (tier draft + caption generado).
export const AddCampaignItemSchema = z.object({
  campaignId: z.string().uuid(),
  formatId: z.string().uuid(),
  scenePrompt: z.string().trim().min(1).max(4000),
  scene: z.string().trim().max(200).optional(),
  characterId: z.string().uuid().optional(),
  // Multi-personaje (máx 3, orden = referencias del prompt). characterId se
  // mantiene como principal sincronizado (= characterIds[0]).
  characterIds: z.array(z.string().uuid()).max(3).optional(),
  durationS: z.number().int().min(4).max(15).optional(),
  scheduledDate: z.coerce.date().optional(),
});

// ============ Plantillas vivas ============

export const CreateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sourceGenerationId: z.string().uuid(),
  formatId: z.string().uuid().optional(),
  fixedParams: z.record(z.string(), z.unknown()),
  slots: z.record(z.string(), z.unknown()),
});

// ============ Formatos custom ============

export const CreateFormatSchema = z.object({
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
export type CreateCampaignStudioInput = z.infer<typeof CreateCampaignStudioSchema>;
export type CampaignItemInput = z.infer<typeof CampaignItemSchema>;
export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;
export type CreateFormatInput = z.infer<typeof CreateFormatSchema>;
