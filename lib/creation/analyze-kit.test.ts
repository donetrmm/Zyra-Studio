import { beforeEach, describe, it, expect, vi } from 'vitest';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({ gatewayText: gatewayTextMock }));

const { analyzeKitImage } = await import('./analyze-kit');

describe('analyzeKitImage', () => {
  beforeEach(() => gatewayTextMock.mockReset());

  it('devuelve nombre, paleta con hex y tono', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({
        name: 'Té Matcha 330ml',
        colors: [{ name: 'Verde salvia', hex: '#9CAF88' }, { name: 'Blanco', hex: '#FFFFFF' }],
        tone: 'minimalista y fresco',
      }),
      finishReason: 'stop',
    });
    const res = await analyzeKitImage({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(res.name).toBe('Té Matcha 330ml');
    expect(res.colors).toHaveLength(2);
    expect(res.colors[0].hex).toBe('#9CAF88');
    expect(res.tone).toBe('minimalista y fresco');
  });

  it('descarta colores con hex inválido y recorta a 6', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({
        name: 'Producto',
        colors: [
          { name: 'ok', hex: '#112233' },
          { name: 'malo', hex: 'rojo' },           // hex inválido → se descarta
          { name: 'sin hex' },
        ],
      }),
      finishReason: 'stop',
    });
    const res = await analyzeKitImage({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' });
    expect(res.colors).toHaveLength(1);
    expect(res.colors[0].hex).toBe('#112233');
  });
});
