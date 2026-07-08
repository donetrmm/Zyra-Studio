import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { gatewayText, type GatewayPart } from '@/lib/providers/gateway';

// Perfil de luz y espacio de una LOCACIÓN desde su imagen maestra (2026-07-02):
// el LLM VE la locación y destila su luz real (fuentes, dirección, temperatura,
// rebotes) y su espacio (profundidad, dónde para una persona) para que el prompt
// del panel integre personajes con la luz de la escena — el "match the light"
// genérico no basta cuando el modelo no sabe QUÉ luz es. Mismo patrón que
// describeCharacterImage (Gemini Flash, <10s, permitido en server action).

const MODEL = 'gemini-2.5-flash';

const SYSTEM = `Eres director de fotografía. Observa la imagen de una LOCACIÓN (un lugar sin personas) y destila su luz y su espacio para integrar después a una persona en la escena. Devuelve SOLO un JSON con esta forma exacta:
{"profile":"en INGLÉS, 2-3 frases"}
El profile cubre, en este orden: (1) las fuentes de luz visibles con su dirección, temperatura de color y suavidad; (2) los materiales de piso y paredes y qué reflejos o luz rebotada producen; (3) la profundidad de la escena y dónde pararía naturalmente una persona (sobre qué superficie y a qué distancia de cámara). Solo lo VISIBLE — no inventes fuentes ni objetos; no menciones personas ni texto. JSON válido, sin markdown.`;

const ReplySchema = z.object({
  profile: z.string().trim().min(1).max(600),
});

export async function deriveLightProfileFromImage(input: {
  imageBuffer: Buffer;
  mimeType: string;
}): Promise<string> {
  const parts: GatewayPart[] = [
    { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
    { text: 'Destila la luz y el espacio de esta locación y devuelve el JSON.' },
  ];

  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'locación',
    system: SYSTEM,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    maxOutputTokens: 400,
    json: true,
  });
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
