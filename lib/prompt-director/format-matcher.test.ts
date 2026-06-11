// lib/prompt-director/format-matcher.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchIdeas, type MatcherFormat } from './format-matcher';

const FORMATS: MatcherFormat[] = [
  { id: 'f1', slug: 'el-descubrimiento', name: 'El Descubrimiento', description: 'Unboxing / revelación' },
  { id: 'f2', slug: 'voz-cercana', name: 'Voz Cercana', description: 'Testimonio de creador' },
];

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('matchIdeas', () => {
  it('mapea una idea a un formato existente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing del producto', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing del producto', formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
    expect(res.matches[0].customFormat).toBeNull();
  });

  it('propone formato custom cuando no encaja', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'mi perro usa el producto',
        formatId: null,
        customFormat: {
          slug: 'mascota-protagonista', name: 'Mascota protagonista',
          description: 'El producto en la vida de una mascota',
          register: 'casero y tierno', cameraStyle: 'handheld a ras de suelo',
          pacing: 'pausado', requiredRefs: ['product'],
          defaultDurationS: 8, defaultAudio: true,
        },
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'mi perro usa el producto', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull();
    expect(res.matches[0].customFormat?.slug).toBe('mascota-protagonista');
  });

  it('rechaza JSON que no cumple el schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ matches: [{ bogus: true }] })));
    process.env.GEMINI_API_KEY = 'test';
    await expect(matchIdeas({ ideasText: 'algo', formats: FORMATS })).rejects.toThrow();
  });

  it('descarta formatId que no existe en la lista', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'x', formatId: 'inventado', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull(); // saneado a custom pendiente o null
  });
});
