// Compiler de Seedance 2.0 (specs/v2/02 tarea 4): produce el prompt CRAFT
// (Context → Reference → Action → Framing → Timing) con referencias @ en el
// orden exacto en que el handler las firma y envía. Guía completa en
// docs/modelos/06-seedance-2.md.

import { describeCharacter, describeProduct } from '../inventory';
import { directionFor } from '../format-director';
import type {
  CompiledPrompt,
  CompiledReference,
  CompileRequest,
  DirectorContext,
} from '../types';

// Cláusula negativa fija: el video nunca renderiza texto ni rostros reales.
const NEGATIVE_CLAUSE =
  'No on-screen text, no captions, no subtitles, no watermarks, no rendered logos or typography. No real identifiable faces.';

// Construye las referencias EN ORDEN (la posición define @Image1.., @Video1..).
// Prioridad ante el tope de 12: producto > empaque > personaje > cámara > audio
// (tier list de la guía Morphic §8).
export function buildReferences(ctx: DirectorContext): {
  references: CompiledReference[];
  lines: string[];
  warnings: string[];
} {
  const references: CompiledReference[] = [];
  const lines: string[] = [];
  const warnings: string[] = [];
  let imageN = 0;

  const pushImage = (storagePath: string, role: CompiledReference['role'], line: (n: number) => string, scope?: string) => {
    imageN += 1;
    references.push({ storagePath, kind: 'image', role, scope });
    lines.push(line(imageN));
  };

  // Producto: máx 3 ángulos como referencia (frontal, perfil, detalle) para
  // dejar slots libres; el Brand Kit puede traer más.
  const productImages = ctx.product?.imagePaths.slice(0, 3) ?? [];
  for (const path of productImages) {
    pushImage(
      path,
      'product',
      (n) => `@Image${n} is the product — exact packaging, colors, logo placement and proportions.`,
    );
  }

  // Empaque (solo si el formato lo exige está en el contexto).
  const packagingImages = ctx.product?.packagingImagePaths?.slice(0, 2) ?? [];
  for (const path of packagingImages) {
    pushImage(path, 'packaging', (n) => `@Image${n} is the product packaging, shown exactly as in the reference.`);
  }

  // Personaje: hoja maestra + hasta 2 ángulos.
  if (ctx.character?.masterImagePath) {
    pushImage(
      ctx.character.masterImagePath,
      'character',
      (n) =>
        `@Image${n} is the presenter — keep the exact appearance: same face, same hair, same build. Only the face, hair and build come from this reference; wardrobe and expression follow the scene description.`,
      'rostro, peinado y complexión; no la ropa ni el fondo',
    );
    for (const path of ctx.character.angleImagePaths?.slice(0, 2) ?? []) {
      pushImage(path, 'character', (n) => `@Image${n} shows the same presenter from another angle, for consistency.`);
    }
  }

  // Video de plantilla viva: estructura, cámara y ritmo.
  if (ctx.templateVideoPath) {
    references.push({ storagePath: ctx.templateVideoPath, kind: 'video', role: 'camera_motion' });
    lines.push(
      '@Video1 is the structural reference — replicate its camera moves, shot structure, editing rhythm and color grading exactly; replace only the product and scene contents as described below.',
    );
  }

  // Audio de referencia: mood y ritmo.
  if (ctx.audioRefPath) {
    references.push({ storagePath: ctx.audioRefPath, kind: 'audio', role: 'audio_rhythm' });
    lines.push('@Audio1 sets the background audio mood and rhythm; sync scene energy to its beats.');
  }

  if (references.length > 12) {
    // Recorte por prioridad: el orden de construcción YA es la prioridad,
    // así que basta cortar desde el final.
    const dropped = references.length - 12;
    references.length = 12;
    lines.length = Math.min(lines.length, 12);
    warnings.push(`referencias: ${dropped} recortadas por el tope de 12 archivos (prioridad: producto > empaque > personaje > cámara > audio)`);
  }

  return { references, lines, warnings };
}

export function compileSeedance(
  req: CompileRequest,
  ctx: DirectorContext,
): CompiledPrompt {
  const warnings: string[] = [];
  const { references, lines, warnings: refWarnings } = buildReferences(ctx);
  warnings.push(...refWarnings);

  const sections: string[] = [];

  // R — Referencias primero, cada @ con propósito declarado.
  if (lines.length) sections.push(lines.join(' '));

  // C — Contexto: la escena.
  if (ctx.scene?.fragment) sections.push(`Scene: ${ctx.scene.fragment}.`);

  // Fidelidad de producto y personaje (reglas duras del inventario).
  if (ctx.product) sections.push(describeProduct(ctx.product));
  if (ctx.character) {
    const { text, ageWordsRemoved } = describeCharacter(ctx.character);
    sections.push(text);
    if (ageWordsRemoved.length) {
      warnings.push(`edad: se removieron marcadores de la descripción del personaje (${ageWordsRemoved.join(', ')})`);
    }
  }

  // A — Acción: el scene_prompt del plan, sin reescritura.
  sections.push(req.scenePrompt.trim().replace(/\.?$/, '.'));

  // F + T — Encuadre, registro y ritmo del formato.
  if (ctx.format) {
    const d = directionFor(ctx.format);
    const direction = [d.framing, d.register, d.pacing].filter(Boolean).join(' ');
    if (direction) sections.push(direction);
  }

  // Audio dirigido: qué se oye, no "agrega música".
  const generateAudio = req.generateAudio ?? ctx.format?.defaultAudio ?? true;
  if (generateAudio && !ctx.audioRefPath) {
    sections.push('Audio: natural diegetic sound that matches the scene; no music unless the register calls for it.');
  }

  sections.push(NEGATIVE_CLAUSE);

  const duration = req.durationS ?? ctx.format?.defaultDurationS;
  const hasRefs = references.length > 0;

  return {
    modelSlug: req.modelSlug,
    prompt: sections.filter(Boolean).join('\n'),
    params: {
      operation: hasRefs ? 'reference2video' : 'text2video',
      duration,
      aspectRatio: req.aspectRatio ?? '9:16',
      resolution: req.resolution ?? (req.modelSlug.includes('/fast/') ? '480p' : '720p'),
      generateAudio,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    },
    references,
    warnings,
  };
}
