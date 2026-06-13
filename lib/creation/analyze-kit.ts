import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';

// Analiza la imagen del producto para prellenar los campos del Brand Kit
// (nombre, paleta con hex, tono) cuando se crea con IA. Mismo Gemini Flash del
// brief; describe SOLO lo visible, sin inventar claims. La paleta viene con hex
// (a diferencia de analyzeProductBrief, que da nombres) porque el kit los exige.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
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

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export async function analyzeKitImage(input: {
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<KitFields> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
          { text: 'Analiza el producto y devuelve el JSON.' },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini kit ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en analyze-kit', 'unknown', false);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(extractJson(raw)); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en analyze-kit', 'unknown', false);
  }
  const parsed = KitFieldsSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError('analyze-kit no cumple el schema', 'unknown', false);
  return parsed.data;
}
