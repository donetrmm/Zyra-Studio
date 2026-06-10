// Compiler de FLUX (specs/v2/02 tarea 5): generación de imagen desde cero.
// Estructura: sujeto + entorno + iluminación (palanca de calidad #1) + estilo
// + paleta. Sin keyword soup (el antislop limpia al final en index.ts).

import { describeProduct } from '../inventory';
import type { CompiledPrompt, CompiledReference, CompileRequest, DirectorContext } from '../types';

// FLUX trabaja con width/height explícitos (lib/providers/types.ts).
const DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
  '21:9': { width: 1536, height: 640 },
};

export function compileFlux(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const sections: string[] = [];

  sections.push(req.scenePrompt.trim().replace(/\.?$/, '.'));
  if (ctx.scene?.fragment) sections.push(`Setting: ${ctx.scene.fragment}.`);
  if (ctx.product) sections.push(describeProduct(ctx.product));
  // Iluminación por defecto orientada a producto si el prompt no la trae.
  if (!/light|lighting|luz|iluminaci/i.test(req.scenePrompt)) {
    sections.push('Soft directional lighting that shows form, volume and material texture.');
  }
  if (ctx.format?.register) sections.push(`Mood: ${ctx.format.register}.`);

  const dims = DIMENSIONS[req.aspectRatio ?? '1:1'] ?? DIMENSIONS['1:1'];

  const references: CompiledReference[] = (ctx.product?.imagePaths.slice(0, 4) ?? []).map(
    (storagePath) => ({ storagePath, kind: 'image', role: 'product' }),
  );

  return {
    modelSlug: req.modelSlug,
    prompt: sections.filter(Boolean).join(' '),
    params: {
      width: dims.width,
      height: dims.height,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    },
    references,
    warnings: [],
  };
}
