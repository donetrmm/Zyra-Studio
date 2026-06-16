// Prosa de video compartida para Veo y Kling (specs/v2/02 tarea 5, "adaptan
// las guías existentes de docs/modelos/"). Estos modelos no soportan el
// sistema @ de Seedance: una sola imagen de referencia vía params y todo lo
// demás en texto. Útiles sobre todo cuando hay personas reales (la restricción
// anti-deepfake de Seedance no aplica aquí).

import { describeProduct } from '../inventory';
import { directionFor } from '../format-director';
import { DIALOGUE_LANGUAGE, sceneHasVoice } from './seedance';
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
  // Idioma/acento de la voz solo cuando la escena trae habla o narración: en un
  // clip de puro producto la directiva sobra y arriesga una voz en off espuria.
  const generateAudio = req.generateAudio ?? ctx.format?.defaultAudio ?? true;
  if (generateAudio && sceneHasVoice(req.scenePrompt)) {
    sections.push(DIALOGUE_LANGUAGE[ctx.language ?? 'es']);
  }

  // El guard anti-texto es obligatorio (evita captions/watermarks renderizados).
  // Va SIEMPRE al final y nunca se recorta: si la prosa excede el presupuesto se
  // trunca solo el cuerpo, reservando espacio para el guard. Antes el guard era
  // la última sección y cualquier recorte por presupuesto se lo comía.
  const guard = 'No on-screen text, captions or watermarks.';
  let body = sections.filter(Boolean).join(' ');
  if (body.length + 1 + guard.length > maxChars) {
    const budget = Math.max(0, maxChars - guard.length - 1);
    body = body.slice(0, budget);
    // Recortar en el límite de la última oración completa que quepa.
    const lastStop = body.lastIndexOf('.');
    if (lastStop > budget * 0.5) body = body.slice(0, lastStop + 1);
  }
  return body ? `${body} ${guard}` : guard;
}

export function firstProductReference(ctx: DirectorContext): CompiledReference[] {
  const path = ctx.product?.imagePaths[0];
  return path ? [{ storagePath: path, kind: 'image', role: 'product' }] : [];
}
