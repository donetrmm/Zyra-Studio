import { describe, it, expect } from 'vitest';
import { validate } from './validators';
import type { CompileRequest, DirectorContext } from './types';

const ctx: DirectorContext = {};
function warnings(scenePrompt: string, durationS?: number): string[] {
  return validate({ modelSlug: 'seedance-2', scenePrompt, durationS } as CompileRequest, ctx).warnings;
}

describe('validators P14 — actuación sin desglosar', () => {
  it('avisa cuando hay un verbo abstracto sin micro-acciones', () => {
    expect(warnings('a person dances in the street').some((w) => w.startsWith('actuación:'))).toBe(true);
  });
  it('no avisa cuando la acción ya está desglosada', () => {
    const w = warnings('a person dances: two head nods, a shoulder roll, a knee bend');
    expect(w.some((x) => x.startsWith('actuación:'))).toBe(false);
  });
});
