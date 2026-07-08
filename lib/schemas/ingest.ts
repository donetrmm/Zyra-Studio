import { z } from 'zod';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

// Cap holgado (Gemini 2.5 Flash tiene contexto de sobra); el tope solo atrapa
// pegados patológicos. 60000 admite briefs multi-archivo (p. ej. un guion de
// 7 clips en 2 archivos ronda los 50k). Única fuente de verdad del límite:
// lo consumen el slice pre-Gemini, el matcher, userIdeas y los textareas.
export const MASTER_PROMPT_MAX = 60000;

// Input: solo el prompt maestro crudo.
export const IngestInputSchema = z.object({
  masterPrompt: z.string().trim().min(1).max(MASTER_PROMPT_MAX),
});
export type IngestInput = z.infer<typeof IngestInputSchema>;

const EMPTY_PRODUCT_FACTS = { heightCm: null, widthCm: null, weightKg: null, thicknessMm: null, medium: null };
const EMPTY_GUIDELINES = { safeCrop: null, showFullProduct: false, hookProductHero: false };

// El guion debe ser UNA cadena, pero el modelo a veces lo devuelve como array de
// clips (bug 2026-07-06: el campo de ideas quedaba vacío en silencio). Array de
// strings → se re-une; cualquier otra forma → '' (el parse pone el fallback al
// prompt crudo).
function coerceNarrative(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

// Salida CRUDA de Gemini: laxo, cada campo con catch/default para que un valor
// malformado no tire el objeto (la salida del LLM es estocástica).
export const IngestRawSchema = z.object({
  productFacts: z
    .object({
      heightCm: z.number().positive().max(2000).nullable().catch(null).default(null),
      widthCm: z.number().positive().max(2000).nullable().catch(null).default(null),
      weightKg: z.number().positive().max(1000).nullable().catch(null).default(null),
      thicknessMm: z.number().positive().max(500).nullable().catch(null).default(null),
      medium: z.string().trim().max(120).nullable().catch(null).default(null),
    })
    .catch(EMPTY_PRODUCT_FACTS)
    .default(EMPTY_PRODUCT_FACTS),
  productVisualDetails: z.string().trim().max(800).nullable().catch(null).default(null),
  visualStyle: z
    .enum(['ultra_realista', 'casero', 'fantasia', 'animado'])
    .nullable()
    .catch(null)
    .default(null),
  guidelines: z
    .object({
      safeCrop: z.union([z.literal('4:5'), z.null()]).catch(null).default(null),
      showFullProduct: z.boolean().catch(false).default(false),
      hookProductHero: z.boolean().catch(false).default(false),
    })
    .catch(EMPTY_GUIDELINES)
    .default(EMPTY_GUIDELINES),
  castMentions: z.array(z.string().trim().min(1).max(60)).catch([]).default([]),
  locationHints: z.array(z.string().trim().min(1).max(200)).catch([]).default([]),
  narrative: z.unknown().transform(coerceNarrative).default(''),
  warnings: z.array(z.string().trim().min(1).max(300)).catch([]).default([]),
});
export type IngestRaw = z.infer<typeof IngestRawSchema>;

// Overrides de ficha que la ingesta propone y el wizard pasa a la creación.
export type IngestBriefOverrides = {
  productFacts?: {
    heightCm?: number;
    widthCm?: number;
    weightKg?: number;
    thicknessMm?: number;
    medium?: string;
  };
  productVisualDetails?: string;
};

// Resultado final que consume el wizard (castHints computado desde castMentions).
export type IngestResult = {
  productFacts: NonNullable<IngestBriefOverrides['productFacts']>;
  productVisualDetails: string | null;
  visualStyle: VisualStyle | null;
  guidelines: { safeCrop: '4:5' | null; showFullProduct: boolean; hookProductHero: boolean };
  castHints: Array<{ name: string; inCast: boolean; note: string }>;
  locationHints: string[];
  narrative: string;
  warnings: string[];
};
