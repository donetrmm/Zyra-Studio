// Compiler de Nano Banana (specs/v2/02 tarea 5): EDICIÓN referenciada sobre
// imágenes ya generadas — su rol en V2 (doc V2 §7.1). Regla de oro: UN cambio
// por iteración, declarando qué cambiar Y qué preservar. Para ajustes
// sucesivos el orquestador usa el modo conversational multi-turn del provider
// (gotcha conocido: chat multi-turn mantiene composición real al editar).

import type { CompiledPrompt, CompiledReference, CompileRequest, DirectorContext } from '../types';

export function compileNanoBanana(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const warnings: string[] = [];

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
  if (ctx.product) {
    sections.push('The product packaging, label and logo must remain exactly as in the reference; never restyle the product.');
  }

  const references: CompiledReference[] = (ctx.product?.imagePaths.slice(0, 3) ?? []).map(
    (storagePath) => ({ storagePath, kind: 'image', role: 'product' }),
  );

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
