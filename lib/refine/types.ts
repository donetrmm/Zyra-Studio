// lib/refine/types.ts
// Contrato del refinado conversacional (specs/v2/07). El borrador (draft)
// vive en el cliente durante la conversación y solo se persiste al aceptar.
import { z } from 'zod';
import { CustomFormatSchema } from '@/lib/prompt-director/custom-format-schema';

export const STAGES = ['what', 'shot', 'refs', 'review'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  what: 'Qué mostrar',
  shot: 'Toma',
  refs: 'Referencias',
  review: 'Revisión',
};

export const MAX_TURNS = 10;

export const RefineDraftSchema = z.object({
  formatId: z.string().uuid().nullable(),
  customFormat: CustomFormatSchema.nullable(),
  scene: z.string().max(120).nullable(),
  scenePrompt: z.string().max(2000),
  // Resumen display de la escena en el idioma de la campaña (033). El
  // scenePrompt sigue en inglés; esto es lo que el usuario lee en el panel.
  sceneSummary: z.string().max(300).nullable(),
  shot: z.string().max(60).nullable(),
  characterId: z.string().uuid().nullable(),
  referenceIds: z.array(z.string().uuid()).max(9),
  durationS: z.number().int().min(4).max(15).nullable(),
  aspectRatio: z.string().max(8).nullable(),
  caption: z.string().max(300).nullable(),
});
export type RefineDraft = z.infer<typeof RefineDraftSchema>;

export const emptyDraft = (formatId: string | null): RefineDraft => ({
  formatId, customFormat: null, scene: null, scenePrompt: '', sceneSummary: null, shot: null,
  characterId: null, referenceIds: [], durationS: null, aspectRatio: null, caption: null,
});

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(4000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

// Lo que Gemini devuelve por turno (validado con zod, nunca confiado).
export const TurnReplySchema = z.object({
  reply: z.string().min(1).max(2000),
  stage: z.enum(STAGES),
  chips: z.array(z.string().max(80)).max(4),
  draftPatch: RefineDraftSchema.partial(),
});
export type TurnReply = z.infer<typeof TurnReplySchema>;
