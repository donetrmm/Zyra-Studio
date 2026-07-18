import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';

export type GeneratedImage = { generationId: string; refId: string; previewUrl: string; storagePath: string };
export type GenError = { error: string; message?: string };

// Convierte una generación 'done' en media_reference (preview + id para guardar).
async function fixAsReference(generationId: string): Promise<GeneratedImage | GenError> {
  const ref = await addGenerationAsReferenceAction({ generationId });
  if (!ref.ok) return { error: ref.error, message: ref.message };
  return { generationId, refId: ref.data.id, previewUrl: ref.data.previewUrl, storagePath: ref.data.storagePath };
}

// Mejora una imagen SUBIDA por el usuario (no generada): la foto entra como
// referencia de Nano Banana (no como parent conversacional, porque no hay un
// turn previo del modelo). Respeta el producto: la instrucción solo ajusta
// fondo/luz, nunca inventa el producto.
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

// Retoque genérico de una imagen SUBIDA (feedback 2026-07-04: las fotos propias
// no se podían editar con IA en la plataforma). Guarda genérica: solo cambia lo
// pedido, el resto de la imagen se preserva. El resultado es una generación
// (queda en la Biblioteca) y una media_reference reutilizable.
export async function retouchUploaded(
  reference: { id: string; storagePath: string },
  instruction: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Apply only this change to the reference image: ${instruction.trim()}. ` +
    `Keep everything else exactly as in the original — same subject, framing, colors and detail.`;
  return editUploaded(reference, prompt);
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

// Cuerpo completo base (specs/v2/16): ancla el vestuario — la maestra es
// head-and-shoulders y no fija la ropa. Identidad EXACTA, pose neutra.
export async function generateFullBody(
  masterRef: { id: string; storagePath: string },
): Promise<GeneratedImage | GenError> {
  const prompt =
    'Show the exact same person standing in a full-body shot from head to shoes, neutral relaxed pose, arms at the sides. ' +
    'Identical face, hairstyle, build and skin; complete their wardrobe in the same style as the clothing visible in the reference. ' +
    'Same soft even lighting and plain background. This is a wardrobe reference: the complete outfit must be clearly visible.';
  return editUploaded(masterRef, prompt);
}

// Outfit (specs/v2/16): variante de vestuario del cuerpo completo base.
// Cambia SOLO la ropa; identidad, pose y encuadre intactos.
export async function generateOutfit(
  fullBodyRef: { id: string; storagePath: string },
  outfit: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    'Keep the exact same person, pose, framing, lighting and background. ' +
    `Change ONLY the clothing: they now wear ${outfit}. ` +
    'Identical face, hairstyle, build and skin. The complete new outfit must be clearly visible from head to shoes.';
  return editUploaded(fullBodyRef, prompt);
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

// Mapa de escala (P15) RESPETANDO la imagen maestra de la locación: Nano Banana
// redibuja la foto del lugar como un esquema top-down conservando los elementos
// y su disposición reales (patrón editUploaded — la maestra entra como
// referencia, no como text2image). `guidance` opcional = la descripción de la
// locación para reforzar el redibujo. Es el camino correcto cuando hay maestra;
// generateScaleMap (FLUX desde texto) queda como fallback sin maestra.
export async function generateScaleMapFromMaster(
  masterRef: { id: string; storagePath: string },
  guidance?: string,
): Promise<GeneratedImage | GenError> {
  const detail = guidance?.trim() ? ` Context: ${guidance.trim()}.` : '';
  const instruction =
    `Redraw the exact location shown in the reference image as a TOP-DOWN schematic floor-plan, seen ` +
    `directly from straight above. Keep the same elements (walls, furniture, objects, landmarks) and ` +
    `their real relative positions and proportional sizes as in the reference; do not invent or remove ` +
    `elements.${detail} ` +
    `Flat simple labeled line diagram, plain background, no perspective, no photorealism, no shadows, no people.`;
  return editUploaded(masterRef, instruction);
}

export function isGenError(x: GeneratedImage | GenError): x is GenError {
  return 'error' in x;
}
