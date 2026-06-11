// lib/prompt-director/format-matcher.ts
// Format matcher (specs/v2/07): texto libre del usuario → formato existente
// o propuesta de formato custom. Lo consumen el wizard (sembrar el plan) y
// el refinado (cuando la conversación se sale del catálogo).
// Patrón Gemini: fetch directo + responseMimeType JSON (como lib/campaigns/brief.ts).

import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export type MatcherFormat = { id: string; slug: string; name: string; description: string | null };

export const CustomFormatSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  register: z.string().max(200),
  cameraStyle: z.string().max(200),
  pacing: z.string().max(120),
  requiredRefs: z.array(z.enum(['product', 'character', 'packaging'])).max(3),
  defaultDurationS: z.number().int().min(4).max(15),
  defaultAudio: z.boolean(),
});
export type CustomFormat = z.infer<typeof CustomFormatSchema>;

const MatchSchema = z.object({
  ideaText: z.string().min(1).max(500),
  formatId: z.string().nullable(),
  customFormat: CustomFormatSchema.nullable(),
});
const MatcherReplySchema = z.object({ matches: z.array(MatchSchema).max(8) });
export type MatcherResult = z.infer<typeof MatcherReplySchema>;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

const SYSTEM = `Eres director creativo de una plataforma de anuncios con IA.
Recibes ideas de campaña en lenguaje natural y un catálogo de formatos.
Por cada idea distinta devuelve un match:
- Si encaja en un formato del catálogo: formatId con su id exacto y customFormat null.
- Si NO encaja: formatId null y customFormat con registro, estilo de cámara y
  ritmo inferidos de la idea. slug en kebab-case, nombres en español.
Nunca inventes atributos del producto. Devuelve SOLO el JSON:
{"matches":[{"ideaText":"...","formatId":"...|null","customFormat":{...}|null}]}`;

export async function matchIdeas(input: {
  ideasText: string;
  formats: MatcherFormat[];
}): Promise<MatcherResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const catalog = input.formats
    .map((f) => `- id=${f.id} slug=${f.slug} "${f.name}": ${f.description ?? ''}`)
    .join('\n');

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [{ text: `Catálogo:\n${catalog}\n\nIdeas del usuario:\n${input.ideasText.slice(0, 2000)}` }],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini matcher ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en matcher', 'unknown', false);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en matcher', 'unknown', false);
  }
  const parsed = MatcherReplySchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`Matcher no cumple el schema: ${parsed.error.message.slice(0, 200)}`, 'unknown', false);
  }

  // Saneo: formatId debe existir en el catálogo recibido; si no, null.
  const known = new Set(input.formats.map((f) => f.id));
  return {
    matches: parsed.data.matches.map((m) => ({
      ...m,
      formatId: m.formatId && known.has(m.formatId) ? m.formatId : null,
    })),
  };
}
