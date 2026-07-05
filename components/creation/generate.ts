import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { buildCharacterMasterPrompt, cleanAssetDescription } from '@/lib/prompt-director/asset-prompts';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

export type GeneratedImage = { generationId: string; refId: string; previewUrl: string; storagePath: string };
export type GenError = { error: string; message?: string };

// Convierte una generación 'done' en media_reference (preview + id para guardar).
async function fixAsReference(generationId: string): Promise<GeneratedImage | GenError> {
  const ref = await addGenerationAsReferenceAction({ generationId });
  if (!ref.ok) return { error: ref.error, message: ref.message };
  return { generationId, refId: ref.data.id, previewUrl: ref.data.previewUrl, storagePath: ref.data.storagePath };
}

// Genera el personaje desde su apariencia (FLUX, síncrono para imágenes).
// `reference` opcional = inspiración de estilo (image-ref). `style`/`customText`
// opcionales = perfil de estilo visual (default ultra_realista); con perfil
// no-realista la directiva photoreal del provider se apaga para no pelear
// contra el look pedido.
export async function generateCharacter(
  appearance: string,
  reference?: { id: string; storagePath: string },
  style?: VisualStyle,
  customText?: string,
): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildCharacterMasterPrompt(appearance, style, customText),
    aspectRatio: '3:4' as const,
    megapixels: 2 as const,
    // Solo ultra_realista: la PHOTOREAL_DIRECTIVE de FLUX describe cámara
    // full-frame profesional y contradiría el bloque smartphone de 'casero'.
    photoreal: (style ?? 'ultra_realista') === 'ultra_realista',
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

// Vistas de un PRODUCTO (P01 + feedback 2026-07-04): 3/4 y perfil 90°. El
// producto suele ser una foto SUBIDA, así que va por editUploaded (la foto
// entra como referencia de Nano Banana, no como parent conversacional). Rota
// la cámara preservando la identidad del producto; NO altera ni inventa la
// etiqueta (respeta "no fabricar texto de marca").
export type ProductAngleView = 'three-quarter' | 'profile';

const PRODUCT_ANGLE_PROMPT: Record<ProductAngleView, string> = {
  'three-quarter':
    'Rotate the camera to show the exact same product from a three-quarter angle (turned about 45 degrees), so its front and one side are both visible at once. This MUST be a newly rendered view from a clearly different angle — do NOT return the original framing or a copy of the input image. Keep the product identity perfectly consistent: identical shape, colors, label, logo, materials and proportions; same soft even studio lighting and clean plain background. Do not alter or invent any label text.',
  profile:
    'Rotate the camera to show the exact same product from a direct side profile view (turned 90 degrees), so only its side is visible. This MUST be a newly rendered view from a clearly different angle — do NOT return the original framing or a copy of the input image. Keep the product identity perfectly consistent: identical shape, colors, label, logo, materials and proportions; same soft even studio lighting and clean plain background. Do not alter or invent any label text.',
};

export async function generateProductAngle(
  productRef: { id: string; storagePath: string },
  view: ProductAngleView,
): Promise<GeneratedImage | GenError> {
  return editUploaded(productRef, PRODUCT_ANGLE_PROMPT[view]);
}

// Retoca una VISTA de producto (subida o generada) con una instrucción libre,
// preservando la identidad del producto (feedback 2026-07-04: las vistas
// generadas no se podían corregir — solo borrar y regenerar).
export async function refineProductImage(
  productRef: { id: string; storagePath: string },
  instruction: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Apply only this change to the reference image: ${instruction.trim()}. ` +
    `Keep the product identity perfectly consistent — identical shape, colors, label, logo, ` +
    `materials and proportions. Do not alter or invent any label text.`;
  return editUploaded(productRef, prompt);
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

// Re-edita la HOJA MAESTRA de un personaje YA GUARDADO (feedback 2026-07-04:
// antes solo se podía editar durante la creación en el wizard). Guarda de
// identidad: cara, complexión y piel se preservan; la instrucción manda sobre
// lo demás (peinado, ropa, expresión). Mantiene el encuadre de hoja maestra.
export async function refineCharacterMaster(
  masterRef: { id: string; storagePath: string },
  instruction: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Keep the exact same person identity as the reference image — same face, complexion and build — ` +
    `and keep the head-and-shoulders master-portrait framing with its plain background and even lighting. ` +
    `Apply only this change: ${instruction}. ` +
    `The result must still read as the same person's master reference portrait.`;
  return editUploaded(masterRef, prompt);
}

// Re-edita la MAESTRA de una locación (feedback 2026-07-04: las locaciones no
// tenían edición iterativa). Guarda de lugar: misma arquitectura, disposición y
// encuadre; la instrucción cambia luz/hora/elementos. Sin personas salvo que la
// instrucción lo pida (contrato de escenario de las locaciones).
export async function refineLocationMaster(
  masterRef: { id: string; storagePath: string },
  instruction: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Keep the exact same place as the reference image — same architecture, layout, surfaces and camera framing. ` +
    `Apply only this change: ${instruction}. ` +
    `The result must still read as the same location, empty of people unless the change explicitly says otherwise.`;
  return editUploaded(masterRef, prompt);
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
// y su disposición reales (patrón editUploaded, como generatePackaging — la
// maestra entra como referencia, no como text2image). `guidance` opcional = la
// descripción de la locación para reforzar el redibujo. Es el camino correcto
// cuando hay maestra; generateScaleMap (FLUX desde texto) queda como fallback
// sin maestra.
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

// Producto CONCEPTO desde cero (marca sin foto): FLUX desde la descripción.
// Legítimo solo cuando no hay producto real — es un concepto, no una foto fiel.
// Contexto de la toma (feedback 2026-07-04): estudio (packshot, default),
// lifestyle (en su contexto de uso) o casero (foto de celular/UGC).
export type ProductShot = 'estudio' | 'lifestyle' | 'casero';

const PRODUCT_SHOT_BLOCKS: Record<ProductShot, string> = {
  // Balance neutro explícito (feedback 2026-07-04: controlar la dominante
  // amarilla): los generadores tienen warm-bias y el packshot lo hereda.
  estudio:
    'Studio product photograph: centered on a clean seamless background, soft even commercial ' +
    'lighting that shows form, material and texture, neutral white balance with true-to-life ' +
    'colors and no warm yellow cast, sharp focus, high detail.',
  lifestyle:
    'Lifestyle product photograph: the product placed in a natural real-world setting where it ' +
    'would actually be used, believable ambient light with true-to-life colors and a neutral ' +
    'white balance, the product clearly the hero of the frame, sharp focus on it.',
  casero:
    'Casual photo taken handheld on a modern smartphone: the product in an everyday spot, ' +
    'slightly imperfect framing, natural automatic exposure, neutral white balance with ' +
    'true-to-life colors — a spontaneous snapshot, not a staged production.',
};

export function buildProductPrompt(
  description: string,
  shot: ProductShot = 'estudio',
  referenceCount = 0,
): string {
  // Sanea la descripción del usuario igual que locación/personaje (auditoría BD
  // 2026-07-04): keyword soup pegada de otras herramientas ("8k, photorealistic")
  // reintroducía el look de render — los prompts de producto no pasan por compiler.
  const clean = cleanAssetDescription(description);
  // Con inspiración: seguir su lenguaje de diseño sin copiarla literal — cubre
  // boceto, producto parecido y logo por integrar.
  const refClause =
    referenceCount > 0
      ? ' Follow the provided reference images for the design language — shape, materials, colors and any logo or label shown in them, integrated faithfully into one coherent product.'
      : '';
  const noText = referenceCount > 0 ? 'No text beyond what the references show, no watermark.' : 'No text, no watermark.';
  return `${shot === 'estudio' ? 'Studio product photograph of' : shot === 'lifestyle' ? 'Product photograph of' : 'Photo of'} ${clean}. ${PRODUCT_SHOT_BLOCKS[shot]}${refClause} ${noText}`;
}

export async function generateProductConcept(
  description: string,
  opts?: { references?: { id: string; storagePath: string }[]; shot?: ProductShot },
): Promise<GeneratedImage | GenError> {
  const shot = opts?.shot ?? 'estudio';
  const references = (opts?.references ?? []).slice(0, 2);
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildProductPrompt(description, shot, references.length),
    aspectRatio: '1:1' as const,
    megapixels: 2 as const,
    // casero: la PHOTOREAL_DIRECTIVE de FLUX (cámara full-frame) contradice el
    // bloque smartphone — su lenguaje de captura ya viaja en el prompt.
    photoreal: shot !== 'casero',
    references,
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
