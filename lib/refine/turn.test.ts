// lib/refine/turn.test.ts
import { describe, expect, it } from 'vitest';
import { applyDraftPatch, clampStage, validateDraft } from './turn';
import { emptyDraft, type Stage } from './types';

const FORMAT = {
  slug: 'voz-cercana', name: 'Voz Cercana', register: 'conversacional',
  cameraStyle: 'selfie handheld', pacing: 'natural',
  requiredRefs: ['product', 'character'] as Array<'product' | 'character' | 'packaging'>,
  defaultDurationS: 8, defaultAudio: true,
};

describe('applyDraftPatch', () => {
  it('mezcla solo claves del draft y conserva el resto', () => {
    const d = emptyDraft('11111111-1111-4111-8111-111111111111');
    const out = applyDraftPatch(d, { scenePrompt: 'la persona destapa el frasco', shot: 'close-up' });
    expect(out.scenePrompt).toBe('la persona destapa el frasco');
    expect(out.shot).toBe('close-up');
    expect(out.formatId).toBe(d.formatId);
  });

  it('ignora un shot que no existe en el catálogo', () => {
    const out = applyDraftPatch(emptyDraft(null), { shot: 'toma-inventada' });
    expect(out.shot).toBeNull();
  });
});

describe('clampStage', () => {
  it('nunca retrocede de etapa', () => {
    expect(clampStage('refs' as Stage, 'what' as Stage, 3)).toBe('refs');
  });
  it('fuerza review al llegar al tope de turnos', () => {
    expect(clampStage('what' as Stage, 'shot' as Stage, 10)).toBe('review');
  });
});

describe('validateDraft', () => {
  it('marca error si falta la escena', () => {
    const res = validateDraft(emptyDraft(null), { format: FORMAT, hasCharacter: false });
    expect(res.errors.length).toBeGreaterThan(0);
  });
  it('advierte cuando el formato exige referencias y no hay', () => {
    const d = { ...emptyDraft(null), scenePrompt: 'persona muestra el producto y sonríe' };
    const res = validateDraft(d, { format: FORMAT, hasCharacter: false });
    expect(res.warnings.join(' ')).toMatch(/referencia/i);
  });
});
