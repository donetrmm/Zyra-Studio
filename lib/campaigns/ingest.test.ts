import { describe, it, expect } from 'vitest';
import {
  parseIngestResult,
  mergeVisualDetails,
  mergeBriefOverrides,
  fallbackIngestResult,
} from './ingest';
import type { ProductBrief } from './brief';

const baseBrief: ProductBrief = {
  productName: 'Canvas print',
  category: 'home',
  variants: [],
  palette: [],
  visualDetails: 'A printed canvas.',
  demographic: '',
  market: 'global',
};

describe('parseIngestResult', () => {
  it('reparte medidas a productFacts y NO al narrative; marca inCast', () => {
    const raw = JSON.stringify({
      productFacts: { heightCm: 150, widthCm: 100, weightKg: 3.7, medium: 'matte canvas' },
      productVisualDetails: 'Frameless matte canvas, 2:3 vertical.',
      visualStyle: 'casero',
      guidelines: { safeCrop: '4:5', showFullProduct: true, hookProductHero: true },
      castMentions: ['Marta', 'Desconocida'],
      locationHints: ['bedroom', 'garden'],
      narrative: 'Clip 1: she lifts the canvas.',
      warnings: ['9 clips detectados'],
    });
    const r = parseIngestResult(raw, { castNames: ['Marta'] });
    expect(r.productFacts.heightCm).toBe(150);
    expect(r.narrative).not.toContain('150');
    expect(r.visualStyle).toBe('casero');
    expect(r.guidelines.safeCrop).toBe('4:5');
    const marta = r.castHints.find((c) => c.name === 'Marta');
    const otra = r.castHints.find((c) => c.name === 'Desconocida');
    expect(marta?.inCast).toBe(true);
    expect(otra?.inCast).toBe(false);
  });

  it('tolera fences markdown y campos faltantes', () => {
    const r = parseIngestResult('```json\n{"narrative":"Clip 1: ..."}\n```', { castNames: [] });
    expect(r.narrative).toBe('Clip 1: ...');
    expect(r.visualStyle).toBeNull();
    expect(r.productFacts.heightCm).toBeUndefined();
  });

  it('JSON basura → fallback con warning, narrative vacío', () => {
    const r = parseIngestResult('no soy json', { castNames: [] });
    expect(r.narrative).toBe('');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  // Bug 2026-07-06 (smoke real): Gemini devolvió JSON válido con el reparto pero
  // narrative vacío/no-string → el campo de ideas quedaba vacío en silencio (el
  // fallback solo cubría JSON inválido).
  it('narrative como array de clips: se re-une en una sola cadena', () => {
    const raw = JSON.stringify({ narrative: ['Clip 1: hook.', 'Clip 2: garden.'] });
    const r = parseIngestResult(raw, { castNames: [] });
    expect(r.narrative).toBe('Clip 1: hook.\n\nClip 2: garden.');
  });

  it('respuesta válida con narrative vacío: cae al prompt crudo con aviso y conserva el reparto', () => {
    const raw = JSON.stringify({ productFacts: { heightCm: 150 }, narrative: '' });
    const r = parseIngestResult(raw, { castNames: [], masterPrompt: 'Mi prompt maestro' });
    expect(r.narrative).toBe('Mi prompt maestro');
    expect(r.productFacts.heightCm).toBe(150);
    expect(r.warnings.some((w) => w.includes('guion'))).toBe(true);
  });

  it('JSON inválido con masterPrompt: narrative = el prompt crudo (promesa del spec)', () => {
    const r = parseIngestResult('no soy json', { castNames: [], masterPrompt: 'Mi guion completo' });
    expect(r.narrative).toBe('Mi guion completo');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  // Falla silenciosa (Anuncio #12 V2, 2026-07-08): un producto físico (medium
  // seteado) sin medidas deja a describeProductScale sin ancla → el canvas sale
  // muy chico en el storyboard, sin ningún aviso. El ingest debe marcarlo.
  it('producto físico (medium) sin medidas: avisa que la escala no queda fijada', () => {
    const raw = JSON.stringify({
      productFacts: { medium: 'canvas', weightKg: 3.5, thicknessMm: 7 },
      narrative: 'Clip 1: sostiene el canvas.',
    });
    const r = parseIngestResult(raw, { castNames: [] });
    expect(r.productFacts.heightCm).toBeUndefined();
    const w = r.warnings.find((x) => x.includes('no indica medidas'));
    expect(w).toBeDefined();
    expect(w).toContain('canvas');
  });

  it('producto físico CON medidas: no genera el aviso de medidas', () => {
    const raw = JSON.stringify({
      productFacts: { medium: 'canvas', heightCm: 60, widthCm: 90 },
      narrative: 'Clip 1: sostiene el canvas.',
    });
    const r = parseIngestResult(raw, { castNames: [] });
    expect(r.warnings.some((x) => x.includes('no indica medidas'))).toBe(false);
  });

  it('solo ancho (una dimensión basta): no genera el aviso de medidas', () => {
    const raw = JSON.stringify({
      productFacts: { medium: 'banner', widthCm: 200 },
      narrative: 'Clip 1: ...',
    });
    const r = parseIngestResult(raw, { castNames: [] });
    expect(r.warnings.some((x) => x.includes('no indica medidas'))).toBe(false);
  });

  it('sin medium (servicio o producto sin objeto físico): no avisa aunque falten medidas', () => {
    const raw = JSON.stringify({ productFacts: { weightKg: 2 }, narrative: 'Clip 1: ...' });
    const r = parseIngestResult(raw, { castNames: [] });
    expect(r.warnings.some((x) => x.includes('no indica medidas'))).toBe(false);
  });
});

describe('mergeVisualDetails', () => {
  it('la descripción del usuario va primero y se concatena con la detectada', () => {
    const out = mergeVisualDetails('Detected auto.', 'User fine detail.');
    expect(out.startsWith('User fine detail.')).toBe(true);
    expect(out).toContain('Detected auto.');
  });
  it('no duplica cuando una contiene a la otra', () => {
    expect(mergeVisualDetails('User fine detail.', 'User fine detail.')).toBe('User fine detail.');
  });
  it('capa a 800', () => {
    expect(mergeVisualDetails('a'.repeat(500), 'b'.repeat(500)).length).toBe(800);
  });
});

describe('mergeBriefOverrides', () => {
  it('mergea medidas y aumenta visualDetails, sin tocar lo no provisto', () => {
    const out = mergeBriefOverrides(baseBrief, {
      productFacts: { heightCm: 150, medium: 'matte canvas' },
      productVisualDetails: 'Frameless matte canvas.',
    });
    expect(out.heightCm).toBe(150);
    expect(out.medium).toBe('matte canvas');
    expect(out.visualDetails.startsWith('Frameless matte canvas.')).toBe(true);
    expect(out.productName).toBe('Canvas print');
  });
  it('sin overrides devuelve el brief tal cual', () => {
    expect(mergeBriefOverrides(baseBrief, undefined)).toEqual(baseBrief);
  });
});

describe('fallbackIngestResult', () => {
  it('narrative = prompt saneado y trae un warning', () => {
    const r = fallbackIngestResult('Mi prompt maestro');
    expect(r.narrative).toBe('Mi prompt maestro');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
