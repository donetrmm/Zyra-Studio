// lib/prompt-director/format-matcher.ts
// Format matcher (specs/v2/07): texto libre del usuario → formato existente
// o propuesta de formato custom. Lo consumen el wizard (sembrar el plan) y
// el refinado (cuando la conversación se sale del catálogo).
// Patrón Gemini: fetch directo + responseMimeType JSON (como lib/campaigns/brief.ts).

import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { CustomFormatSchema, type CustomFormat } from './custom-format-schema';
export { CustomFormatSchema, type CustomFormat };

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export type MatcherFormat = { id: string; slug: string; name: string; description: string | null };

const MatchSchema = z.object({
  ideaText: z.string().min(1).max(500),
  formatId: z.string().nullable(),
  customFormat: CustomFormatSchema.nullable(),
  // Cuántos creativos pide la idea ("3 versiones de..."). Sin cantidad
  // explícita el matcher devuelve 1; el techo total del plan lo pone el planner.
  count: z.number().int().min(1).max(10).catch(1).default(1),
  // Concepto concreto de la idea en inglés: va directo al scenePrompt del
  // item para que el creativo refleje lo que el usuario escribió.
  scenePrompt: z.string().trim().min(1).max(600).nullable().catch(null).default(null),
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
- count: cuántos creativos pide la idea, SOLO si menciona una cantidad
  explícita ("3 versiones", "varios" = 3). Sin cantidad, count = 1.
- scenePrompt: la acción concreta de la idea, en INGLÉS, 1-2 frases, con el
  producto como ancla. Si la idea solo nombra un formato sin acción concreta
  ("quiero unboxings"), scenePrompt = null.
Nunca inventes atributos del producto. Devuelve SOLO el JSON:
{"matches":[{"ideaText":"...","formatId":"...|null","customFormat":{...}|null,"count":1,"scenePrompt":"...|null"}]}`;

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
        maxOutputTokens: 2000,
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
