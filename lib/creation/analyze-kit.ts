import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { gatewayText } from '@/lib/providers/gateway';

// Analiza la imagen del producto para prellenar los campos del Brand Kit
// (nombre, paleta con hex, tono) cuando se crea con IA. Mismo Gemini Flash del
// brief; describe SOLO lo visible, sin inventar claims. La paleta viene con hex
// (a diferencia de analyzeProductBrief, que da nombres) porque el kit los exige.

const MODEL = 'gemini-2.5-flash';

const SYSTEM = `Eres director de marca. Observa la imagen del producto y devuelve SOLO un JSON con esta forma exacta:
{"name":"nombre corto del producto o marca, tal como se vea","colors":[{"name":"nombre del color en español","hex":"#RRGGBB"}],"tone":"tono de marca sugerido, 2-4 palabras en español"}
Reglas: 2-4 colores dominantes REALES del producto, cada uno con su hex aproximado en formato #RRGGBB. Describe SOLO lo visible — no inventes claims ni atributos. JSON válido, sin markdown.`;

const ColorSchema = z.object({
  name: z.string().trim().min(1).max(50).catch('Color'),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const KitFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100).catch('Producto'),
  colors: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr
        .flatMap((c) => {
          const parsed = ColorSchema.safeParse(c);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 6),
    ),
  tone: z.string().trim().max(200).optional().catch(undefined),
});
export type KitFields = z.infer<typeof KitFieldsSchema>;

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export async function analyzeKitImage(input: {
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<KitFields> {
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'kit',
    system: SYSTEM,
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
        { text: 'Analiza el producto y devuelve el JSON.' },
      ],
    }],
    temperature: 0.2,
    maxOutputTokens: 500,
    json: true,
  });
  let json: unknown;
  try { json = JSON.parse(extractJson(raw)); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en analyze-kit', 'unknown', false);
  }
  const parsed = KitFieldsSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError('analyze-kit no cumple el schema', 'unknown', false);
  return parsed.data;
}
