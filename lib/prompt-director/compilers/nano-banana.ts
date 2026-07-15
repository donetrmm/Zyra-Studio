// Compiler de Nano Banana (specs/v2/02 tarea 5): EDICIÓN referenciada sobre
// imágenes ya generadas — su rol en V2 (doc V2 §7.1). Regla de oro: UN cambio
// por iteración, declarando qué cambiar Y qué preservar. Para ajustes
// sucesivos el orquestador usa el modo conversational multi-turn del provider
// (gotcha conocido: chat multi-turn mantiene composición real al editar).

import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
import { describeProductCompact, multiProductCountClause } from '../inventory';
import type { CompiledPrompt, CompiledReference, CompileRequest, DirectorContext } from '../types';

export function compileNanoBanana(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const warnings: string[] = [];
  const products = ctx.products ?? [];
  const product = products[0];

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
  if (products.length === 1) {
    sections.push('The product packaging, label and logo must remain exactly as in the reference; never restyle the product.');
  } else if (products.length > 1) {
    // Multi: ficha compacta por producto + anti-conteo (mismo criterio que Seedance,
    // spec multi-producto 2026-07-15).
    for (const p of products) sections.push(describeProductCompact(p));
    sections.push(multiProductCountClause(products.map((p) => p.name)));
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

  // Referencias: producto (3, o 1 por producto en multi) + personaje (3 master)
  // + locación (environment).
  const references: CompiledReference[] = [];
  // Multi: 1 imagen por producto (mitigación anti-conteo, spec 2026-07-15) — con
  // varios productos, varias vistas del mismo producto multiplica la confusión.
  const productPaths =
    products.length > 1
      ? products.map((p) => p.imagePaths[0]).filter((p): p is string => !!p)
      : (product?.imagePaths.slice(0, 3) ?? []);
  for (const storagePath of productPaths) {
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
