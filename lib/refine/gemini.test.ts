// lib/refine/gemini.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestRefineTurn } from './gemini';

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('requestRefineTurn', () => {
  it('devuelve un TurnReply validado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      reply: '¿Qué momento quieres mostrar?', stage: 'what',
      chips: ['El problema', 'Cómo se usa'], draftPatch: {},
    })));
    process.env.GEMINI_API_KEY = 'test';
    const out = await requestRefineTurn({ system: 'sys', history: [{ role: 'user', text: 'hola' }] });
    expect(out.stage).toBe('what');
    expect(out.chips).toHaveLength(2);
  });

  it('lanza si el JSON no cumple el contrato', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ reply: 'x', stage: 'volando' })));
    process.env.GEMINI_API_KEY = 'test';
    await expect(requestRefineTurn({ system: 's', history: [] })).rejects.toThrow();
  });
});
