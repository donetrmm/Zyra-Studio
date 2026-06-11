// Prosa de video compartida para Veo y Kling (specs/v2/02 tarea 5, "adaptan
// las guías existentes de docs/modelos/"). Estos modelos no soportan el
// sistema @ de Seedance: una sola imagen de referencia vía params y todo lo
// demás en texto. Útiles sobre todo cuando hay personas reales (la restricción
// anti-deepfake de Seedance no aplica aquí).

import { describeProduct } from '../inventory';
import { directionFor } from '../format-director';
import type { CompiledReference, CompileRequest, DirectorContext } from '../types';

export function buildVideoProse(req: CompileRequest, ctx: DirectorContext, maxChars: number): string {
  const sections: string[] = [];
  if (ctx.scene?.fragment) sections.push(`${ctx.scene.fragment}.`);
  sections.push(req.scenePrompt.trim().replace(/\.?$/, '.'));
  if (ctx.product) sections.push(describeProduct(ctx.product));
  if (ctx.format) {
    const d = directionFor(ctx.format);
    const direction = [d.framing, d.pacing].filter(Boolean).join(' ');
    if (direction) sections.push(direction);
  }
  sections.push('No on-screen text, captions or watermarks.');

  let prose = sections.filter(Boolean).join(' ');
  if (prose.length > maxChars) {
    // Recortar en el límite de la última oración completa que quepa.
    prose = prose.slice(0, maxChars);
    const lastStop = prose.lastIndexOf('.');
    if (lastStop > maxChars * 0.5) prose = prose.slice(0, lastStop + 1);
  }
  return prose;
}

export function firstProductReference(ctx: DirectorContext): CompiledReference[] {
  const path = ctx.product?.imagePaths[0];
  return path ? [{ storagePath: path, kind: 'image', role: 'product' }] : [];
}
