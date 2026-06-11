// lib/refine/turn.ts
// Lógica pura del refinado: aplicar parches, clamp de etapas y validación.
// Sin red ni Supabase — testeable en frío. La acción server es un wrapper.
import { shotBySlug } from '@/lib/shots/catalog';
import { validate } from '@/lib/prompt-director/validators';
import type { FormatDirection } from '@/lib/prompt-director/types';
import { MAX_TURNS, STAGES, type RefineDraft, type Stage } from './types';

export function applyDraftPatch(draft: RefineDraft, patch: Partial<RefineDraft>): RefineDraft {
  const next = { ...draft, ...patch };
  // El shot debe existir en el catálogo; si Gemini alucina un slug, se ignora.
  if (patch.shot !== undefined && patch.shot !== null && !shotBySlug(patch.shot)) {
    next.shot = draft.shot;
  }
  return next;
}

// La etapa solo avanza; al tope de turnos se fuerza la revisión.
export function clampStage(current: Stage, proposed: Stage, userTurns: number): Stage {
  if (userTurns >= MAX_TURNS) return 'review';
  return STAGES.indexOf(proposed) >= STAGES.indexOf(current) ? proposed : current;
}

export function validateDraft(
  draft: RefineDraft,
  ctx: { format: FormatDirection | null },
): { errors: string[]; warnings: string[] } {
  // El formato entra al validador base para que use defaultDurationS en la
  // regla de complejidad (regla 2). Sus required_refs, en cambio, serían
  // errores bloqueantes — en fase de borrador las refs faltantes son
  // advertencia (etapa refs), no bloqueo. Se eliminan del array de errores.
  const REF_ERROR_PREFIXES = ['product: el formato', 'character: el formato', 'packaging: el formato'];
  const base = validate(
    { modelSlug: 'seedance-2.0', scenePrompt: draft.scenePrompt, durationS: draft.durationS ?? undefined },
    { format: ctx.format ?? undefined, scene: draft.scene ? { name: draft.scene, fragment: draft.scenePrompt } : undefined },
  );
  const errors = base.errors.filter(
    (e) => !REF_ERROR_PREFIXES.some((prefix) => e.startsWith(prefix)),
  );
  const warnings = [...base.warnings];
  const required = ctx.format?.requiredRefs ?? [];
  if (required.includes('product') && draft.referenceIds.length === 0) {
    warnings.push('Sin referencia del producto, la fidelidad puede variar entre tomas.');
  }
  if (required.includes('character') && !draft.characterId) {
    warnings.push('Este formato lleva presentador: sin persona del Cast, la identidad cambia en cada generación.');
  }
  return { errors, warnings };
}
