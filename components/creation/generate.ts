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

// Genera un ángulo del MISMO personaje para consistencia multi-toma (guía
// Morphic §4.2: paquete frontal + perfil + 3/4). Es legítimo porque el personaje
// es ficticio: rota la cámara manteniendo identidad, no fabrica un producto real.
// Va por editImage (parent conversacional) para preservar cara, pelo, ropa y luz.
const ANGLE_PROMPT: Record<'profile' | 'three-quarter', string> = {
  profile:
    'Show the exact same person from a direct side profile view (90 degrees). Identical face, hairstyle, build, skin and clothing; same soft even studio lighting and plain light gray background. Only the camera angle changes — keep the identity perfectly consistent.',
  'three-quarter':
    'Show the exact same person from a three-quarter view (about 45 degrees). Identical face, hairstyle, build, skin and clothing; same soft even studio lighting and plain light gray background. Only the camera angle changes — keep the identity perfectly consistent.',
};

export async function generateAngle(
  masterGenerationId: string,
  view: 'profile' | 'three-quarter',
): Promise<GeneratedImage | GenError> {
  return editImage(masterGenerationId, ANGLE_PROMPT[view]);
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

// Producto CONCEPTO desde cero (marca sin foto): FLUX desde la descripción.
// Legítimo solo cuando no hay producto real — es un concepto, no una foto fiel.
function buildProductPrompt(description: string): string {
  return (
    `Studio product photograph of ${description}. ` +
    'Centered on a clean seamless background, soft even commercial lighting that shows form, ' +
    'material and texture, sharp focus, high detail, professional product photography. ' +
    'No text, no watermark.'
  );
}

export async function generateProductConcept(description: string): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildProductPrompt(description),
    aspectRatio: '1:1' as const,
    megapixels: 2 as const,
    photoreal: true,
    references: [],
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

// Empaque a partir del producto REAL (la foto entra como referencia): la IA
// diseña una caja/etiqueta coherente con el producto, sin alterarlo ni fabricar
// texto de marca que no esté a la vista.
export async function generatePackaging(
  productRef: { id: string; storagePath: string },
  notes: string,
): Promise<GeneratedImage | GenError> {
  const detail = notes.trim() ? ` ${notes.trim()}.` : '';
  const res = await submitGenerationAction({
    provider: 'nano-banana' as const,
    model: 'gemini-3-pro-image-preview' as const,
    variant: '2k' as const,
    prompt:
      `Design retail packaging (a box or labeled container) for the exact product shown in the reference image.${detail} ` +
      'Keep the product identity, label, logo and colors consistent with the reference. ' +
      'Studio product shot on a clean plain background, soft even lighting. Do not invent brand text or claims beyond what is visible in the reference.',
    conversational: false,
    references: [productRef],
    noBackground: false,
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

export function isGenError(x: GeneratedImage | GenError): x is GenError {
  return 'error' in x;
}
