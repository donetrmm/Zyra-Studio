import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';

export type GeneratedImage = { generationId: string; refId: string; previewUrl: string; storagePath: string };
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
  return { generationId, refId: ref.data.id, previewUrl: ref.data.previewUrl, storagePath: ref.data.storagePath };
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

// Hornea una VARIANTE DE ESTADO de un personaje (P05) desde su hoja maestra,
// vía editUploaded (la master entra como referencia). Preserva la identidad
// EXACTA; cambia solo el estado fisico (vestuario/piel). El `state` describe el
// estado ("wet hair and soaked clothing, sweat on the forehead").
export async function generateCharacterState(
  masterRef: { id: string; storagePath: string },
  state: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Same exact face, hairstyle, build and identity as the reference person, now with ${state}. ` +
    `Keep the person's identity perfectly consistent — only the physical state (wardrobe and skin) changes. ` +
    `Same plain background and even studio lighting.`;
  return editUploaded(masterRef, prompt);
}

// Vista 3/4 de un PRODUCTO (P01). El producto suele ser una foto SUBIDA, así que
// va por editUploaded (la foto entra como referencia de Nano Banana, no como parent
// conversacional). Rota la cámara preservando la identidad del producto; NO altera
// ni inventa la etiqueta (respeta "no fabricar texto de marca").
const PRODUCT_ANGLE_PROMPT: Record<'three-quarter', string> = {
  'three-quarter':
    'Rotate the camera to show the exact same product from a three-quarter angle (turned about 45 degrees), so its front and one side are both visible at once. This MUST be a newly rendered view from a clearly different angle — do NOT return the original framing or a copy of the input image. Keep the product identity perfectly consistent: identical shape, colors, label, logo, materials and proportions; same soft even studio lighting and clean plain background. Do not alter or invent any label text.',
};

export async function generateProductAngle(
  productRef: { id: string; storagePath: string },
  view: 'three-quarter',
): Promise<GeneratedImage | GenError> {
  return editUploaded(productRef, PRODUCT_ANGLE_PROMPT[view]);
}

// Refina un ESTADO ya generado (P05): re-edita la imagen del estado con una
// instrucción libre del usuario, preservando identidad y composición. Va por
// editUploaded (el estado entra como referencia, sin cadena conversacional).
export async function refineCharacterState(
  stateRef: { id: string; storagePath: string },
  instruction: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Keep the exact same person identity, face, hairstyle and overall framing as the reference image. ` +
    `Apply only this change: ${instruction}. ` +
    `Same plain background and even studio lighting unless the change explicitly says otherwise.`;
  return editUploaded(stateRef, prompt);
}

// Mapa de escala (P15): diagrama top-down del set desde una descripción. FLUX
// text2image, no photoreal (queremos un esquema plano, no una foto). Legítimo
// porque es un esquema de proporciones, no una foto fiel de un producto/persona.
function buildScaleMapPrompt(description: string): string {
  return (
    `Top-down schematic floor-plan diagram of ${description}. ` +
    'Flat simple line drawing seen directly from above, labeled, showing the relative positions ' +
    'and proportional sizes of the elements; plain background, no perspective, no photorealism, ' +
    'no shadows, no people, no text other than short element labels.'
  );
}

export async function generateScaleMap(description: string): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildScaleMapPrompt(description),
    aspectRatio: '1:1' as const,
    megapixels: 2 as const,
    photoreal: false,
    references: [],
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
