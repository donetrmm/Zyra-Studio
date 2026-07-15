// Compiler de Nano Banana (specs/v2/02 tarea 5): EDICIÓN referenciada sobre
// imágenes ya generadas — su rol en V2 (doc V2 §7.1). Regla de oro: UN cambio
// por iteración, declarando qué cambiar Y qué preservar. Para ajustes
// sucesivos el orquestador usa el modo conversational multi-turn del provider
// (gotcha conocido: chat multi-turn mantiene composición real al editar).

import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
import type { CompiledPrompt, CompiledReference, CompileRequest, DirectorContext } from '../types';

export function compileNanoBanana(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const warnings: string[] = [];
  // T5: paridad single — primer producto de la lista (multi real llega después).
  const product = ctx.products?.[0];

  // Heurística de "un cambio por iteración": múltiples instrucciones de cambio
  // en el mismo prompt son menos fiables que iterar.
  const changeCount = req.scenePrompt
    .split(/[.;]+/)
    .map((s) => s.trim())
    .filter((s) => /\b(change|replace|add|remove|swap|insert|cambia|reemplaza|agrega|quita|inserta)\b/i.test(s)).length;
  if (changeCount > 1) {
    warnings.push('edición: más de un cambio en la misma instrucción; un cambio por iteración es más fiable');
  }

  const sections: string[] = [
    req.scenePrompt.trim().replace(/\.?$/, '.'),
    'Keep everything else exactly the same — same composition, framing, lighting, colors and proportions.',
  ];
  if (product) {
    sections.push('The product packaging, label and logo must remain exactly as in the reference; never restyle the product.');
  }
  // Personaje: la hoja maestra se ancla como referencia para que la identidad no
  // derive (el storyboard la genera/edita con Nano Banana por su fidelidad de ref).
  if ((ctx.characters ?? []).some((c) => c.masterImagePath)) {
    sections.push('Keep the people exactly as in their reference image(s): same face, hair and build; do not change their identity.');
  }
  // Locación: el lugar como referencia de escena (consistencia entre paneles).
  if ((ctx.location?.imagePaths?.length ?? 0) > 0) {
    sections.push('Keep the setting exactly as in the location reference image: same place, architecture and background.');
  }

  // Guías creativas opt-in de la campaña: encuadre producto-completo / hook-hero /
  // recorte seguro. El panel es el fotograma de apertura; las tres guías aplican.
  const guidelineClauses = creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: req.isOpeningBeat });
  if (guidelineClauses) sections.push(guidelineClauses.trim());

  // Referencias: producto (3) + personaje (3 master) + locación (environment).
  const references: CompiledReference[] = [];
  for (const storagePath of product?.imagePaths.slice(0, 3) ?? []) {
    references.push({ storagePath, kind: 'image', role: 'product' });
  }
  for (const character of (ctx.characters ?? []).slice(0, 3)) {
    if (character.masterImagePath) {
      references.push({
        storagePath: character.masterImagePath,
        kind: 'image',
        role: 'character',
        scope: 'rostro, peinado y complexión; no la ropa ni el fondo',
      });
    }
  }
  for (const path of ctx.location?.imagePaths ?? []) {
    references.push({ storagePath: path, kind: 'image', role: 'environment' });
  }

  return {
    modelSlug: req.modelSlug,
    prompt: sections.join(' '),
    params: {
      // El orquestador decide conversational/previousTurn según haya
      // iteraciones previas del mismo asset (NanoBananaParams en providers/types).
      aspectRatio: req.aspectRatio,
    },
    references,
    warnings,
  };
}
