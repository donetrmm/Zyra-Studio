// parseUserPreset extrae un preset usable de una fila `presets` (params jsonb,
// unknown): necesita un prompt string no vacío; keepIdentical opcional (los
// presets guardados hoy no lo persisten → default false). Un bug acá mete un
// preset roto (prompt vacío/no-string) al compositor. Se cubre cada rama.
import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS, parseUserPreset } from '@/lib/studio/presets';

describe('BUILTIN_PRESETS', () => {
  it('cada tipo trae presets con label y prompt no vacíos', () => {
    for (const type of ['product', 'location', 'character'] as const) {
      expect(BUILTIN_PRESETS[type].length).toBeGreaterThan(0);
      for (const p of BUILTIN_PRESETS[type]) {
        expect(p.label.trim().length).toBeGreaterThan(0);
        expect(p.prompt.trim().length).toBeGreaterThan(0);
        expect(typeof p.keepIdentical).toBe('boolean');
      }
    }
  });
});

describe('parseUserPreset', () => {
  it('params con prompt string → preset (label = name, keepIdentical default false)', () => {
    const p = parseUserPreset({ id: 'u1', name: 'Mi preset', params: { prompt: '  haz X  ' } });
    expect(p).toEqual({ id: 'u1', label: 'Mi preset', prompt: 'haz X', keepIdentical: false });
  });

  it('respeta keepIdentical boolean de params', () => {
    const p = parseUserPreset({ id: 'u2', name: 'N', params: { prompt: 'X', keepIdentical: true } });
    expect(p?.keepIdentical).toBe(true);
  });

  it('keepIdentical no-boolean → false', () => {
    const p = parseUserPreset({ id: 'u3', name: 'N', params: { prompt: 'X', keepIdentical: 'sí' } });
    expect(p?.keepIdentical).toBe(false);
  });

  it('params sin prompt → null', () => {
    expect(parseUserPreset({ id: 'u4', name: 'N', params: { model: 'nano' } })).toBeNull();
  });

  it('prompt no-string → null', () => {
    expect(parseUserPreset({ id: 'u5', name: 'N', params: { prompt: 42 } })).toBeNull();
  });

  it('prompt vacío/espacios → null', () => {
    expect(parseUserPreset({ id: 'u6', name: 'N', params: { prompt: '   ' } })).toBeNull();
  });

  it('params no-objeto (null / string) → null', () => {
    expect(parseUserPreset({ id: 'u7', name: 'N', params: null })).toBeNull();
    expect(parseUserPreset({ id: 'u8', name: 'N', params: 'x' })).toBeNull();
  });
});
