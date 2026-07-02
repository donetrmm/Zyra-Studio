import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';

// Perfil de luz y espacio de una LOCACIÓN desde su imagen maestra (2026-07-02):
// el LLM VE la locación y destila su luz real (fuentes, dirección, temperatura,
// rebotes) y su espacio (profundidad, dónde para una persona) para que el prompt
// del panel integre personajes con la luz de la escena — el "match the light"
// genérico no basta cuando el modelo no sabe QUÉ luz es. Mismo patrón que
// describeCharacterImage (Gemini Flash, <10s, permitido en server action).

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

const SYSTEM = `Eres director de fotografía. Observa la imagen de una LOCACIÓN (un lugar sin personas) y destila su luz y su espacio para integrar después a una persona en la escena. Devuelve SOLO un JSON con esta forma exacta:
{"profile":"en INGLÉS, 2-3 frases"}
El profile cubre, en este orden: (1) las fuentes de luz visibles con su dirección, temperatura de color y suavidad; (2) los materiales de piso y paredes y qué reflejos o luz rebotada producen; (3) la profundidad de la escena y dónde pararía naturalmente una persona (sobre qué superficie y a qué distancia de cámara). Solo lo VISIBLE — no inventes fuentes ni objetos; no menciones personas ni texto. JSON válido, sin markdown.`;

const ReplySchema = z.object({
  profile: z.string().trim().min(1).max(600),
});

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

export async function deriveLightProfileFromImage(input: {
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const parts: Array<Record<string, unknown>> = [
    { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
    { text: 'Destila la luz y el espacio de esta locación y devuelve el JSON.' },
  ];

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
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
    throw new ProviderError(`Gemini locación ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const parsed = GeminiResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError('Respuesta inesperada de Gemini al perfilar la locación', 'unknown', false);
  }
  const raw = (parsed.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido al perfilar la locación', 'unknown', false);
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) {
    throw new ProviderError('El perfil de luz no cumple el schema', 'unknown', false);
  }
  return reply.data.profile.trim();
}
