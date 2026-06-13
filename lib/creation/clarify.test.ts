// lib/creation/clarify.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { clarifyCharacter } from './clarify';

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('clarifyCharacter', () => {
  it('devuelve preguntas y enrichedPrompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      questions: [{ id: 'wardrobe', question: '¿Vestuario?', suggestions: ['linen', 'denim'] }],
      enrichedPrompt: 'a kitchen content creator with curly dark hair, relaxed delivery',
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await clarifyCharacter({ text: 'una creadora de cocina', hasReference: false });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].id).toBe('wardrobe');
    expect(res.enrichedPrompt).toContain('kitchen content creator');
  });

  it('limpia marcadores de edad del enrichedPrompt (red de seguridad)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      questions: [],
      enrichedPrompt: 'a young woman with short hair',
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await clarifyCharacter({ text: 'mujer de pelo corto', hasReference: false });
    expect(res.enrichedPrompt).not.toMatch(/young/i);
    expect(res.enrichedPrompt).toContain('woman with short hair');
  });

  it('reintenta una vez ante un 429 y luego propaga', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate' } as Response));
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await expect(
      clarifyCharacter({ text: 'algo', hasReference: false, retryDelayMs: 0 }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
