// Compiler de Veo 3.1: prosa ≤1024 chars (límite del schema V1), duraciones
// fijas 4/6/8 s.

import { buildVideoProse, firstProductReference } from './video-prose';
import type { CompiledPrompt, CompileRequest, DirectorContext } from '../types';

const VEO_MAX_PROMPT = 1024;
const VEO_DURATIONS = [4, 6, 8] as const;

function clampDuration(d: number | undefined): 4 | 6 | 8 {
  if (d === undefined) return 8;
  let best: 4 | 6 | 8 = 8;
  let dist = Infinity;
  for (const v of VEO_DURATIONS) {
    const diff = Math.abs(v - d);
    if (diff < dist) {
      dist = diff;
      best = v;
    }
  }
  return best;
}

export function compileVeo(req: CompileRequest, ctx: DirectorContext): CompiledPrompt {
  const warnings: string[] = [];
  const duration = clampDuration(req.durationS);
  if (req.durationS !== undefined && duration !== req.durationS) {
    warnings.push(`duración: Veo solo soporta 4/6/8 s; ${req.durationS}s → ${duration}s`);
  }
  const aspectRatio = req.aspectRatio === '9:16' ? '9:16' : '16:9';
  if (req.aspectRatio && req.aspectRatio !== aspectRatio) {
    warnings.push(`ratio: Veo solo soporta 16:9 y 9:16; ${req.aspectRatio} → ${aspectRatio}`);
  }

  return {
    modelSlug: req.modelSlug,
    prompt: buildVideoProse(req, ctx, VEO_MAX_PROMPT),
    params: {
      aspectRatio,
      resolution: req.resolution === '1080p' ? '1080p' : '720p',
      durationSeconds: duration,
    },
    references: firstProductReference(ctx),
    warnings,
  };
}
