// Compiler de Kling 3.0: prosa ≤2000 chars, duración 5-10 s, ratios 16:9/9:16/1:1.

import { buildVideoProse, firstProductReference } from './video-prose';
import type { CompiledPrompt, CompileRequest, DirectorContext } from '../types';

const KLING_MAX_PROMPT = 2000;

export function compileKling(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const warnings: string[] = [];
  let duration = req.durationS ?? 5;
  if (duration < 5 || duration > 10) {
    const clamped = Math.min(10, Math.max(5, duration));
    warnings.push(`duración: Kling soporta 5-10 s; ${duration}s → ${clamped}s`);
    duration = clamped;
  }
  const validRatios = ['16:9', '9:16', '1:1'];
  const aspectRatio = validRatios.includes(req.aspectRatio ?? '') ? (req.aspectRatio as string) : '9:16';
  if (req.aspectRatio && aspectRatio !== req.aspectRatio) {
    warnings.push(`ratio: Kling soporta 16:9/9:16/1:1; ${req.aspectRatio} → ${aspectRatio}`);
  }

  return {
    modelSlug: req.modelSlug,
    prompt: buildVideoProse(req, ctx, KLING_MAX_PROMPT),
    params: {
      aspectRatio,
      duration,
      generateAudio: req.generateAudio ?? true,
    },
    references: firstProductReference(ctx),
    warnings,
  };
}
