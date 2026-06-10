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
