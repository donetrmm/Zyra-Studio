// Prompt Director — el oficio encapsulado (doc V2 §4.3, specs/v2/02).
// compile() valida producibilidad, despacha al compiler del modelo y aplica
// antislop como paso final. Determinista: mismo input → mismo output.
//
// El Prompt Assistant de V1 (lib/providers/prompt-enhancer.ts) sigue siendo
// la utilidad LLM del flujo de generación suelta; el Campaign Studio usa
// este módulo.

import { stripSlop } from './antislop';
import { compileFlux } from './compilers/flux';
import { compileKling } from './compilers/kling';
import { compileNanoBanana } from './compilers/nano-banana';
import { compileSeedance } from './compilers/seedance';
import { compileVeo } from './compilers/veo';
import { validate } from './validators';
import type { CompiledPrompt, CompileRequest, CompileResult, DirectorContext } from './types';

export type { CompiledPrompt, CompiledReference, CompileRequest, CompileResult, DirectorContext, FormatDirection } from './types';
export { fromFormatRow } from './format-director';

function dispatch(req: CompileRequest, ctx: DirectorContext): CompiledPrompt | null {
  const slug = req.modelSlug;
  if (slug.includes('seedance')) return compileSeedance(req, ctx);
  if (slug.includes('flux')) return compileFlux(req, ctx);
  if (slug.includes('gemini') && slug.includes('image')) return compileNanoBanana(req, ctx);
  if (slug.includes('veo')) return compileVeo(req, ctx);
  if (slug.includes('kling')) return compileKling(req, ctx);
  return null;
}

export function compile(req: CompileRequest, ctx: DirectorContext = {}): CompileResult {
  const { errors, warnings } = validate(req, ctx);
  if (errors.length) {
    return { ok: false, errors, warnings };
  }

  const compiled = dispatch(req, ctx);
  if (!compiled) {
    return { ok: false, errors: [`modelo no soportado por el Prompt Director: ${req.modelSlug}`], warnings };
  }

  // Antislop como paso final sobre el prompt completo.
  const { text, removed } = stripSlop(compiled.prompt);
  if (removed.length) {
    compiled.warnings.push(`antislop: removidos ${removed.join(', ')}`);
  }

  return {
    ok: true,
    compiled: {
      ...compiled,
      prompt: text,
      warnings: [...warnings, ...compiled.warnings],
    },
  };
}

// Conserva los personajes del contexto pero quita producto/locación/extra/plantilla/audio. Para el video del storyboard
// (image2video) queremos mandar la hoja maestra del cast como reference_image y
// citarla (@image1) para re-anclar la identidad durante la acción; producto/locación
// ya están en el panel (first_frame), así que se quitan. Limpia requiredRefs para que
// el validador no bloquee por las imágenes de producto que ya no van.
export function onlyCharacterRefs(ctx: DirectorContext): DirectorContext {
  return {
    ...ctx,
    format: ctx.format ? { ...ctx.format, requiredRefs: [] } : undefined,
    product: ctx.product ? { ...ctx.product, imagePaths: [], packagingImagePaths: [] } : undefined,
    location: ctx.location ? { ...ctx.location, imagePaths: [] } : undefined,
    extraImagePaths: [],
    templateVideoPath: undefined,
    audioRefPath: undefined,
    // La voz (como la música) no está en el panel; se re-ancla vía buildCastR2VRefs
    // desde el baseDirCtx, solo en beats R2V. Aquí se quita para no doble-citarla.
    voiceRefPath: undefined,
    // Solo la HOJA MAESTRA del cast (sin ángulos): re-ancla la identidad con una
    // referencia canónica, igual que la cadena de secuencias (que usa master
    // explícita, no las refs compiladas que mezclan master y ángulos).
    characters: ctx.characters?.map((c) => ({ ...c, angleImagePaths: [] })),
  };
}
