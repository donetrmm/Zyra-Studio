// lib/refine/gemini.ts
// Turno de conversación contra Gemini Flash. Patrón de lib/campaigns/brief.ts:
// fetch directo, responseMimeType JSON, zod siempre. Una llamada por turno,
// segundos de latencia → server action directa, sin cola.
import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { TurnReplySchema, type ChatTurn, type TurnReply } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

export async function requestRefineTurn(input: {
  system: string;
  history: ChatTurn[];
}): Promise<TurnReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: input.history.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.text }],
      })),
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1200,
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
    throw new ProviderError(`Gemini refine ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }
  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en refine', 'unknown', false);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en refine', 'unknown', false);
  }
  const parsed = TurnReplySchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`Turno no cumple el contrato: ${parsed.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return parsed.data;
}
