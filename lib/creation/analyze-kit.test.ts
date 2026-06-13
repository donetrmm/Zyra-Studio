import { afterEach, describe, it, expect, vi } from 'vitest';
import { analyzeKitImage } from './analyze-kit';

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('analyzeKitImage', () => {
  it('devuelve nombre, paleta con hex y tono', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      name: 'Té Matcha 330ml',
      colors: [{ name: 'Verde salvia', hex: '#9CAF88' }, { name: 'Blanco', hex: '#FFFFFF' }],
      tone: 'minimalista y fresco',
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await analyzeKitImage({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(res.name).toBe('Té Matcha 330ml');
    expect(res.colors).toHaveLength(2);
    expect(res.colors[0].hex).toBe('#9CAF88');
    expect(res.tone).toBe('minimalista y fresco');
  });

  it('descarta colores con hex inválido y recorta a 6', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      name: 'Producto',
      colors: [
        { name: 'ok', hex: '#112233' },
        { name: 'malo', hex: 'rojo' },           // hex inválido → se descarta
        { name: 'sin hex' },
      ],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await analyzeKitImage({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(res.colors).toHaveLength(1);
    expect(res.colors[0].hex).toBe('#112233');
  });
});
