import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';

// Auto-detección del brief (specs/v2/03 tarea 2): con la imagen del producto
// inferir categoría, variantes, paleta y demográfico. Principio del doc V2:
// nunca preguntar lo que se puede inferir. Usa el mismo Gemini Flash del
// prompt-enhancer (rápido, <10s, permitido en server action).

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export const PRODUCT_CATEGORIES = [
  'beverage', 'food', 'beauty', 'apparel', 'accessories',
  'electronics', 'software', 'home', 'fitness', 'other',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const ProductBriefSchema = z.object({
  productName: z.string().min(1).max(120),
  category: z.enum(PRODUCT_CATEGORIES),
  variants: z.array(z.string().max(60)).max(12).default([]),
  palette: z.array(z.string().max(40)).max(6).default([]),
  // Detalles visibles del empaque: material, forma, acabado, tipografía.
  visualDetails: z.string().max(400).default(''),
  demographic: z.string().max(160).default(''),
  market: z.string().max(80).default('global'),
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

const SYSTEM = `Eres un estratega de marketing. Analiza la imagen del producto y devuelve SOLO un JSON con esta forma exacta:
{
  "productName": "nombre visible o descriptivo corto",
  "category": "beverage|food|beauty|apparel|accessories|electronics|software|home|fitness|other",
  "variants": ["variantes/sabores/SKUs visibles, si los hay"],
  "palette": ["2-4 colores dominantes del empaque, en inglés"],
  "visualDetails": "material, forma, acabado y detalles del empaque visibles, en inglés, 1-2 frases",
  "demographic": "demográfico aparente del producto, breve",
  "market": "mercado aparente (global salvo señales claras de región)"
}
Reglas: describe SOLO lo visible — no inventes claims, ingredientes ni atributos. Si no hay variantes visibles, variants=[]. JSON válido, sin markdown.`;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
});

export async function analyzeProductBrief(input: {
  imageBuffer: Buffer;
  mimeType: string;
  // Texto extra opcional (ej. contenido de la URL de la tienda).
  extraContext?: string;
}): Promise<ProductBrief> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const parts: Array<Record<string, unknown>> = [
    { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
  ];
  if (input.extraContext) {
    parts.push({ text: `Contexto adicional del producto:\n${input.extraContext.slice(0, 4000)}` });
  }
  parts.push({ text: 'Analiza el producto y devuelve el JSON.' });

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini brief ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const parsed = GeminiResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError('Respuesta inesperada de Gemini en brief', 'unknown', false);
  }
  const raw = (parsed.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en brief', 'unknown', false);
  }
  const brief = ProductBriefSchema.safeParse(json);
  if (!brief.success) {
    throw new ProviderError(`Brief no cumple el schema: ${brief.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return brief.data;
}
