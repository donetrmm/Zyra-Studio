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

// Devuelve el contexto SIN referencias de media: vacía las imágenes de
// producto/personaje/locación/extra y quita video de plantilla y audio. Conserva
// las DESCRIPCIONES de texto. Lo usa el modo storyboard-video (image2video): el
// panel es el first_frame, así que el compiler NO debe emitir citas @image/@video/
// @audio que apunten a referencias que no se envían.
// También limpia `format.requiredRefs`: el validador (resolveRequiredRefs) bloquea
// el compile si el formato exige imágenes de producto/empaque y no las hay. En
// image2video el panel YA trae producto/personaje/escena, así que ese requisito
// no aplica (sin esto, el item se saltaba con "el formato necesita imágenes…").
export function withoutReferences(ctx: DirectorContext): DirectorContext {
  return {
    ...ctx,
    format: ctx.format ? { ...ctx.format, requiredRefs: [] } : undefined,
    product: ctx.product
      ? { ...ctx.product, imagePaths: [], packagingImagePaths: [] }
      : undefined,
    characters: ctx.characters?.map((c) => ({ ...c, masterImagePath: '', angleImagePaths: [] })),
    location: ctx.location ? { ...ctx.location, imagePaths: [] } : undefined,
    extraImagePaths: [],
    templateVideoPath: undefined,
    audioRefPath: undefined,
  };
}
