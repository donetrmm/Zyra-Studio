import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';

export type GeneratedImage = { generationId: string; refId: string; previewUrl: string };
export type GenError = { error: string; message?: string };

// Scaffold de retrato neutro (mismo criterio que buildMasterPrompt de CastPage):
// el Prompt Director espera frontal, luz pareja, persona ficticia.
function buildMasterPrompt(appearance: string): string {
  return (
    `Frontal head-and-shoulders portrait of a fictional person: ${appearance}. ` +
    'Neutral relaxed expression, looking straight at the camera, soft even studio lighting, ' +
    'plain light gray seamless background, sharp focus on the face, natural skin texture, ' +
    'no text, no watermark.'
  );
}

// Convierte una generación 'done' en media_reference (preview + id para guardar).
async function fixAsReference(generationId: string): Promise<GeneratedImage | GenError> {
  const ref = await addGenerationAsReferenceAction({ generationId });
  if (!ref.ok) return { error: ref.error, message: ref.message };
  return { generationId, refId: ref.data.id, previewUrl: ref.data.previewUrl };
}

// Genera el personaje desde su apariencia (FLUX, síncrono para imágenes).
// `reference` opcional = inspiración de estilo (image-ref).
export async function generateCharacter(
  appearance: string,
  reference?: { id: string; storagePath: string },
): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildMasterPrompt(appearance),
    aspectRatio: '3:4' as const,
    megapixels: 2 as const,
    photoreal: true,
    references: reference ? [reference] : [],
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

// Edita una imagen previa con Nano Banana multi-turn (un cambio por iteración).
// `parentGenerationId` = la versión actual; el server reconstruye el turn previo.
export async function editImage(
  parentGenerationId: string,
  instruction: string,
  opts?: { noBackground?: boolean },
): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'nano-banana' as const,
    model: 'gemini-3-pro-image-preview' as const,
    variant: '2k' as const,
    prompt: instruction,
    conversational: true,
    parentGenerationId,
    references: [],
    noBackground: opts?.noBackground ?? false,
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

// Mejora una imagen SUBIDA por el usuario (no generada): la foto entra como
// referencia de Nano Banana (no como parent conversacional, porque no hay un
// turn previo del modelo). Las mejoras siguientes sobre el resultado ya usan
// editImage (parent). Respeta el producto: la instrucción solo ajusta fondo/luz,
// nunca inventa el producto.
export async function editUploaded(
  reference: { id: string; storagePath: string },
  instruction: string,
  opts?: { noBackground?: boolean },
): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'nano-banana' as const,
    model: 'gemini-3-pro-image-preview' as const,
    variant: '2k' as const,
    prompt: instruction,
    conversational: false,
    references: [reference],
    noBackground: opts?.noBackground ?? false,
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

export function isGenError(x: GeneratedImage | GenError): x is GenError {
  return 'error' in x;
}
