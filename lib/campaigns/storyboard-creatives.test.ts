import { describe, it, expect } from 'vitest';
import { buildCreatives, type CreativeRow } from './storyboard-creatives';

function row(p: Partial<CreativeRow> & { id: string }): CreativeRow {
  return {
    sequenceId: null,
    sequenceLabel: null,
    formatName: null,
    scenePrompt: '',
    sceneIndex: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...p,
  };
}

describe('buildCreatives', () => {
  it('un item suelto = un creativo single etiquetado por su formato', () => {
    const out = buildCreatives([row({ id: 'a', formatName: 'Reel vertical', createdAt: '2026-01-01T00:00:00Z' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'a',
      kind: 'single',
      sequenceId: null,
      representativeItemId: 'a',
      label: 'Reel vertical',
      beatIds: ['a'],
    });
  });

  it('una secuencia agrupa sus escenas y las ordena por scene_index', () => {
    const out = buildCreatives([
      row({ id: 's2', sequenceId: 'seq', sequenceLabel: 'Anuncio', sceneIndex: 2 }),
      row({ id: 's0', sequenceId: 'seq', sequenceLabel: 'Anuncio', sceneIndex: 0 }),
      row({ id: 's1', sequenceId: 'seq', sequenceLabel: 'Anuncio', sceneIndex: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'seq',
      kind: 'sequence',
      sequenceId: 'seq',
      label: 'Anuncio',
      representativeItemId: 's0',
      beatIds: ['s0', 's1', 's2'],
    });
  });

  it('dos secuencias quedan como creativos separados', () => {
    const out = buildCreatives([
      row({ id: 'a0', sequenceId: 'A', sequenceLabel: 'Uno', sceneIndex: 0, createdAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'b0', sequenceId: 'B', sequenceLabel: 'Dos', sceneIndex: 0, createdAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(out.map((c) => c.key)).toEqual(['A', 'B']);
  });

  it('ordena los creativos por el created_at mas temprano', () => {
    const out = buildCreatives([
      row({ id: 'late', formatName: 'L', createdAt: '2026-03-01T00:00:00Z' }),
      row({ id: 'early', formatName: 'E', createdAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(out.map((c) => c.key)).toEqual(['early', 'late']);
  });

  it('usa fallbacks cuando faltan label/formato', () => {
    const out = buildCreatives([
      row({ id: 'x', sequenceId: 'seq', sequenceLabel: null, createdAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'y', formatName: null, createdAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(out.find((c) => c.key === 'seq')?.label).toBe('Secuencia');
    expect(out.find((c) => c.key === 'y')?.label).toBe('Creativo');
  });

  it('desambigua labels repetidos con sufijo numerico', () => {
    const out = buildCreatives([
      row({ id: 'a', formatName: 'Reel', createdAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'b', formatName: 'Reel', createdAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(out.map((c) => c.label)).toEqual(['Reel 1', 'Reel 2']);
  });

  it('un clip suelto se etiqueta "formato · resumen de la escena"', () => {
    const out = buildCreatives([
      row({ id: 'a', formatName: 'Reel', scenePrompt: 'Mujer abre el empaque en la cocina y sonríe' }),
    ]);
    expect(out[0].label).toBe('Reel · Mujer abre el empaque en la cocina y sonríe');
  });

  it('recorta el resumen largo con elipsis y, sin formato, usa solo el resumen', () => {
    const longPrompt =
      'Plano general de la cocina con luz natural mientras la protagonista prepara el desayuno lentamente';
    const out = buildCreatives([row({ id: 'a', formatName: null, scenePrompt: longPrompt })]);
    expect(out[0].label.endsWith('…')).toBe(true);
    expect(out[0].label.length).toBeLessThanOrEqual(49);
  });

  it('dos clips del mismo formato se distinguen por su resumen', () => {
    const out = buildCreatives([
      row({ id: 'a', formatName: 'Reel', scenePrompt: 'Primer plano del producto', createdAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'b', formatName: 'Reel', scenePrompt: 'Testimonial en exteriores', createdAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(out.map((c) => c.label)).toEqual([
      'Reel · Primer plano del producto',
      'Reel · Testimonial en exteriores',
    ]);
  });

  it('no toca labels unicos', () => {
    const out = buildCreatives([
      row({ id: 'a', formatName: 'Reel', createdAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'b', formatName: 'Historia', createdAt: '2026-01-02T00:00:00Z' }),
    ]);
    expect(out.map((c) => c.label)).toEqual(['Reel', 'Historia']);
  });
});
