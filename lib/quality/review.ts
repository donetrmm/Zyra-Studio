import 'server-only';
import { z } from 'zod';
import { gatewayText } from '@/lib/providers/gateway';

// Auto-review de calidad (fase 1: detectar y marcar — specs/v2/19).
// Puntúa una imagen generada y marca defectos típicos. Corre como job
// best-effort post-finalize: nunca bloquea ni cobra.

const MODEL = 'gemini-2.5-flash';

// Códigos cerrados: la UI los traduce; lo que el modelo invente fuera de esta
// lista se descarta (los LLM no son fiables generando enums libres).
export const QUALITY_FLAGS = [
  'deformed_hands',
  'distorted_face',
  'deformed_body',
  'garbled_text',
  'warped_product',
  'artifacts',
] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

const SYSTEM = `Eres un revisor de control de calidad de imágenes generadas por IA para anuncios publicitarios. Recibes UNA imagen y el prompt que la generó.

Devuelve SOLO un JSON con esta forma exacta:
{"score": 0-100, "flags": ["código", ...], "summary": "string|null"}

Códigos permitidos en flags (usa SOLO estos, vacío si no hay defectos):
- deformed_hands: manos con dedos de más/de menos, fusionados o imposibles
- distorted_face: rostro derretido, asimétrico o con rasgos corruptos
- deformed_body: extremidades extra, proporciones anatómicas imposibles
- garbled_text: texto en la imagen ilegible, con caracteres inventados o mal deletreado
- warped_product: el producto/objeto principal aparece deformado o derretido
- artifacts: glitches, patrones de ruido, costuras o duplicaciones evidentes

Reglas:
- score: 100 = publicable sin defectos; 0 = inutilizable. Un defecto grave en el sujeto principal pesa más que uno en el fondo.
- Solo marca defectos DE GENERACIÓN. Estilo, composición o iluminación intencional NO son defectos.
- summary: una sola frase corta en español describiendo el defecto principal, o null si no hay flags.
Devuelve SOLO el JSON válido, sin markdown.`;

const ResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  flags: z.array(z.string()).default([]),
  summary: z.string().nullable().default(null),
});

export type QualityReview = {
  score: number;
  flags: QualityFlag[];
  summary: string | null;
};

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export async function reviewImageQuality(params: {
  imageBuffer: Buffer;
  mimeType: string;
  prompt: string;
}): Promise<QualityReview> {
  const { text } = await gatewayText({
    model: MODEL,
    label: 'quality-review',
    system: SYSTEM,
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: params.mimeType, data: params.imageBuffer.toString('base64') } },
          // El prompt acota el juicio (qué ES el sujeto principal); capado
          // para no inflar el input con prompts de campaña andamiados.
          { text: `Prompt de la generación: ${params.prompt.slice(0, 2000)}` },
        ],
      },
    ],
    temperature: 0,
    maxOutputTokens: 1024,
    json: true,
  });

  const parsed = ResultSchema.parse(JSON.parse(extractJson(text)));
  const known = new Set<string>(QUALITY_FLAGS);
  return {
    score: parsed.score,
    flags: parsed.flags.filter((f): f is QualityFlag => known.has(f)),
    summary: parsed.summary,
  };
}
