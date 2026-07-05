import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { stripAgeWords } from '@/lib/prompt-director/inventory';
import { ClarifyResultSchema, type ClarifyInput, type ClarifyResult } from '@/lib/schemas/creation';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

// Aclaración del modo character: persona FICTICIA, age-blind, sin claims.
const SYSTEM = `Eres director de casting de una plataforma de anuncios con IA. El usuario describe un personaje ficticio para generarlo como imagen. Devuelve SOLO un JSON con esta forma exacta:
{"questions":[{"id":"kebab","question":"pregunta corta en ESPAÑOL","suggestions":["chip1","chip2"]}],
 "enrichedPrompt":"apariencia completa del personaje en INGLÉS"}
Reglas:
- questions: incluye 0-3 SOLO si falta algo crítico para generar (vestuario, peinado, tono/actitud, contexto). Si el texto ya basta, questions=[]. Las suggestions son 2-4 chips cortos accionables.
- enrichedPrompt: apariencia física, peinado/cabello, vestuario y manera de actuar, en INGLÉS. Conserva TODOS los detalles que el usuario dio — si escribió una descripción larga o un prompt exacto, intégralo completo (traducido si hace falta), NUNCA lo resumas ni descartes detalles; solo añade lo que falte. Persona FICTICIA. NUNCA menciones edad ni rangos (nada de young/old/teen/elderly/niño/anciano). No inventes nombres, marcas ni claims. No describas fondo.
JSON válido, sin markdown.`;

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

export async function clarifyCharacter(
  input: ClarifyInput & { retryDelayMs?: number },
): Promise<ClarifyResult> {
  try {
    return await requestClarify(input);
  } catch (err) {
    if (err instanceof ProviderError && err.retryable) {
      await new Promise((r) => setTimeout(r, input.retryDelayMs ?? 2000));
      return requestClarify(input);
    }
    throw err;
  }
}

async function requestClarify(input: ClarifyInput): Promise<ClarifyResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const userText = `Personaje pedido: ${input.text.slice(0, 2000)}${
    input.hasReference ? '\n(El usuario adjuntó una imagen de referencia de estilo/apariencia.)' : ''
  }`;

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.3,
        // 1200: el enrichedPrompt conserva íntegro el texto del usuario (hasta
        // 2000 chars) más las preguntas; 600 lo truncaba y rompía el JSON.
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini clarify ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en clarify', 'unknown', true);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(extractJson(raw)); } catch {
    throw new ProviderError(`Gemini devolvió JSON inválido en clarify: ${raw.slice(0, 180)}`, 'unknown', true);
  }
  const parsed = ClarifyResultSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError('Clarify no cumple el schema', 'unknown', true);

  // Red de seguridad: el Prompt Director es age-blind; limpia cualquier marcador
  // que se haya colado en el enrichedPrompt.
  const { text } = stripAgeWords(parsed.data.enrichedPrompt);
  const clean = text.trim();
  if (!clean) throw new ProviderError('enrichedPrompt vacío tras limpiar edad', 'unknown', true);
  return { questions: parsed.data.questions, enrichedPrompt: clean };
}
