import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { stripAgeWords } from '@/lib/prompt-director/inventory';

// Descripción de personaje desde su hoja maestra (doc V2 §4.4): el LLM VE la
// imagen y escribe la apariencia que el Prompt Director necesita para anclar la
// identidad, en vez de depender de que el usuario la teclee. Mismo Gemini Flash
// del brief (rápido, <10s, permitido en server action). Reglas duras del
// inventario: SOLO lo visible, sin marcadores de edad (el stripAgeWords es la
// red de seguridad final) ni claims inventados.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

const SYSTEM = `Eres director de casting. Observa el retrato y describe la apariencia del personaje para usarla en un prompt de video. Devuelve SOLO un JSON con esta forma exacta:
{"description":"apariencia física, peinado, vestuario y manera de actuar, en INGLÉS, 1-2 frases"}
Reglas: describe SOLO lo visible — rasgos, peinado/cabello, vestuario y actitud. NUNCA menciones edad ni rangos de edad (nada de young/old/teen/elderly/niño/anciano…). No inventes nombres, marcas, etnias asumidas ni claims. No describas el fondo. JSON válido, sin markdown.`;

const ReplySchema = z.object({
  description: z.string().trim().min(1).max(600),
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

export async function describeCharacterImage(input: {
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const parts: Array<Record<string, unknown>> = [
    { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
    { text: 'Describe al personaje del retrato y devuelve el JSON.' },
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
    throw new ProviderError(`Gemini cast ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const parsed = GeminiResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError('Respuesta inesperada de Gemini al describir personaje', 'unknown', false);
  }
  const raw = (parsed.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido al describir personaje', 'unknown', false);
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) {
    throw new ProviderError('La descripción no cumple el schema', 'unknown', false);
  }

  // Red de seguridad: aunque el prompt prohíbe la edad, el Prompt Director es
  // age-blind y aquí se limpia cualquier marcador que se haya colado.
  const { text } = stripAgeWords(reply.data.description);
  const clean = text.trim();
  if (!clean) {
    throw new ProviderError('La descripción quedó vacía tras limpiar marcadores de edad', 'unknown', false);
  }
  return clean;
}
