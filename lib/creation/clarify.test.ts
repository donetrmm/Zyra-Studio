// lib/creation/clarify.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/types';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({
  gatewayText: gatewayTextMock,
}));

const { clarifyCharacter } = await import('./clarify');

afterEach(() => {
  vi.unstubAllGlobals();
  gatewayTextMock.mockReset();
});

describe('clarifyCharacter', () => {
  it('devuelve preguntas y enrichedPrompt', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({
        questions: [{ id: 'wardrobe', question: '¿Vestuario?', suggestions: ['linen', 'denim'] }],
        enrichedPrompt: 'a kitchen content creator with curly dark hair, relaxed delivery',
      }),
      finishReason: 'stop',
    });
    const res = await clarifyCharacter({ text: 'una creadora de cocina', hasReference: false });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].id).toBe('wardrobe');
    expect(res.enrichedPrompt).toContain('kitchen content creator');
  });

  it('limpia marcadores de edad del enrichedPrompt (red de seguridad)', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({
        questions: [],
        enrichedPrompt: 'a young woman with short hair',
      }),
      finishReason: 'stop',
    });
    const res = await clarifyCharacter({ text: 'mujer de pelo corto', hasReference: false });
    expect(res.enrichedPrompt).not.toMatch(/young/i);
    expect(res.enrichedPrompt).toContain('woman with short hair');
  });

  it('reintenta una vez ante un 429 y luego propaga', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Rate limit Gemini', 'rate_limit', true));
    await expect(
      clarifyCharacter({ text: 'algo', hasReference: false, retryDelayMs: 0 }),
    ).rejects.toThrow();
    expect(gatewayTextMock).toHaveBeenCalledTimes(2);
  });
});
