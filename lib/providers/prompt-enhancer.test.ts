import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({ gatewayText: gatewayTextMock }));

const { enhancePrompt } = await import('./prompt-enhancer');

describe('enhancePrompt', () => {
  beforeEach(() => gatewayTextMock.mockReset());

  it('devuelve el texto mejorado sin comillas accidentales', async () => {
    gatewayTextMock.mockResolvedValue({ text: '"un atardecer cálido"', finishReason: 'stop' });
    expect(await enhancePrompt({ prompt: 'atardecer' })).toBe('un atardecer cálido');
    expect(gatewayTextMock.mock.calls[0][0].json).toBe(false);
    expect(gatewayTextMock.mock.calls[0][0].temperature).toBe(0.7);
  });

  it('salida vacía con finishReason length -> server retryable', async () => {
    gatewayTextMock.mockResolvedValue({ text: '', finishReason: 'length' });
    await expect(enhancePrompt({ prompt: 'x' })).rejects.toMatchObject({
      code: 'server', retryable: true,
    });
  });

  it('salida vacía con finishReason content-filter -> safety', async () => {
    gatewayTextMock.mockResolvedValue({ text: '', finishReason: 'content-filter' });
    await expect(enhancePrompt({ prompt: 'x' })).rejects.toMatchObject({ code: 'safety' });
  });
});
