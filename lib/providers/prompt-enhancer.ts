import 'server-only';
import { z } from 'zod';
import { ProviderError } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// gemini-2.5-flash: rápido, barato, multilingüe, suficiente para reescribir
// un prompt de imagen. La misma GEMINI_API_KEY que usan los modelos image preview.
const MODEL = 'gemini-2.5-flash';

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string() })).optional() })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
  promptFeedback: z
    .object({ blockReason: z.string().optional() })
    .optional(),
});

const SYSTEM_IMAGE = `Eres un experto en prompts de generación de imagen para modelos como FLUX 2 y Nano Banana (Gemini Image). Recibes un prompt y devuelves UNA SOLA versión mejorada, más rica y específica.

Reglas:
- Mantén la intención y el sujeto del prompt original; no cambies el tema.
- Agrega SOLO detalle visual relevante: luz, lente/cámara, atmósfera, composición, colores, materiales, estilo.
- NO inventes ni asumas atributos del sujeto que el usuario no especificó: género, sexo, edad, etnia, color de piel, tipo de cuerpo, ropa específica, identidad. Si el prompt dice "una persona" o "alguien", déjalo neutro; no lo conviertas en "un hombre" / "una mujer". Si el prompt es ambiguo, conserva la ambigüedad.
- Lenguaje conciso y descriptivo. Sin listas, sin viñetas, sin explicaciones, sin emojis.
- Responde en la MISMA lengua que el input.
- Largo objetivo: 1-3 oraciones, máximo 80 palabras.
- Devuelve SOLO el prompt mejorado, sin "Aquí tienes:" ni prefijos ni comillas.`;

const SYSTEM_VIDEO = `Eres un experto en prompts de generación de video para modelos como Veo 3.1 y Kling 3.0. Recibes un prompt y devuelves UNA SOLA versión mejorada optimizada para video.

Reglas:
- Estructura: Sujeto + Acción + Estilo visual + Cámara + Composición + Enfoque + Ambiente.
- Describe movimiento explícitamente: qué se mueve, cómo, a qué velocidad.
- Especifica tipo de cámara: tracking shot, dolly zoom, handheld, static, drone, slow pan.
- Incluye atmósfera temporal: hora del día, clima, iluminación.
- NO inventes atributos del sujeto que el usuario no mencionó.
- Si el modelo soporta audio nativo, incluye cues de audio: diálogos entre comillas, efectos de sonido, ambiente sonoro.
- Lenguaje conciso y descriptivo. Sin listas, sin explicaciones, sin emojis.
- Responde en la MISMA lengua que el input.
- Largo objetivo: 2-4 oraciones, máximo 120 palabras.
- Devuelve SOLO el prompt mejorado.`;

const SYSTEM_AUDIO = `Eres un experto en prompts de texto-a-voz (TTS) para modelos como ElevenLabs V3. Recibes un texto y devuelves una versión mejorada con indicaciones de expresividad.

Reglas:
- Mantén el contenido y significado exacto del texto original.
- Agrega tags expresivos inline donde sea natural: [whispers], [excited], [pause], [laughs], [sighs], [serious], [soft], [loud].
- Usa puntuación estratégica para controlar ritmo: puntos suspensivos para pausas, signos de exclamación para énfasis, comas para respiración.
- NO cambies el idioma del texto original.
- NO agregues contenido nuevo ni cambies el mensaje.
- Devuelve SOLO el texto mejorado con tags.`;

const SYSTEM_INSTRUCTIONS: Record<string, string> = {
  image: SYSTEM_IMAGE,
  video: SYSTEM_VIDEO,
  audio: SYSTEM_AUDIO,
};

export type EnhanceHint = 'photoreal' | 'illustration' | 'text-in-image';
export type EnhanceType = 'image' | 'video' | 'audio';

export async function enhancePrompt(input: {
  prompt: string;
  hint?: EnhanceHint;
  type?: EnhanceType;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);
  }

  const hintLine = input.hint
    ? `\nIntención del usuario: ${input.hint}.`
    : '';
  const userText = `Prompt original:\n"""${input.prompt.trim()}"""${hintLine}\n\nDevuelve el prompt mejorado:`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTIONS[input.type ?? 'image'] ?? SYSTEM_INSTRUCTIONS.image }] },
    contents: [{ role: 'user' as const, parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.7,
      // 800 tokens da margen suficiente para 1-3 oraciones (~80 palabras).
      maxOutputTokens: 800,
      responseMimeType: 'text/plain',
      // CRÍTICO: Gemini 2.5 Flash usa thinking por default y los thinking tokens
      // se cuentan dentro de maxOutputTokens. Para un rewrite cortito eso se
      // come todo el budget y devuelve la respuesta cortada (o vacía).
      // Desactivarlo deja todo el cap disponible para el output visible.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `Gemini enhance ${res.status}: ${text.slice(0, 200)}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }

  const parsed = ResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada de Gemini Flash: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }

  if (parsed.data.promptFeedback?.blockReason) {
    throw new ProviderError(
      `Gemini bloqueó la mejora (${parsed.data.promptFeedback.blockReason}).`,
      'safety',
      false,
    );
  }

  const candidate = parsed.data.candidates[0];
  const enhanced = (candidate.content?.parts ?? [])
    .map((p) => p.text)
    .join('')
    .trim()
    // Quitar comillas accidentales que el modelo a veces agrega.
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!enhanced) {
    const reason = candidate.finishReason;
    if (reason === 'MAX_TOKENS') {
      throw new ProviderError(
        'Gemini se quedó sin tokens al mejorar. Intenta de nuevo.',
        'server',
        true,
      );
    }
    if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') {
      throw new ProviderError(
        'Gemini rechazó la mejora por políticas de seguridad.',
        'safety',
        false,
      );
    }
    throw new ProviderError(
      `Gemini no devolvió texto${reason ? ` (${reason})` : ''}.`,
      'unknown',
      false,
    );
  }
  return enhanced;
}
