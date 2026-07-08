// lib/refine/gemini.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/types';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({
  gatewayText: gatewayTextMock,
}));

const { requestRefineTurn } = await import('./gemini');

afterEach(() => {
  vi.unstubAllGlobals();
  gatewayTextMock.mockReset();
});

describe('requestRefineTurn', () => {
  it('devuelve un TurnReply validado', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({
        reply: '¿Qué momento quieres mostrar?', stage: 'what',
        chips: ['El problema', 'Cómo se usa'], draftPatch: {},
      }),
      finishReason: 'stop',
    });
    const out = await requestRefineTurn({ system: 'sys', history: [{ role: 'user', text: 'hola' }] });
    expect(out.stage).toBe('what');
    expect(out.chips).toHaveLength(2);
  });

  it('lanza si el JSON no cumple el contrato', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({ reply: 'x', stage: 'volando' }),
      finishReason: 'stop',
    });
    await expect(requestRefineTurn({ system: 's', history: [] })).rejects.toThrow();
  });

  it('marca rate limit como reintentable', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Rate limit Gemini', 'rate_limit', true));
    await expect(requestRefineTurn({ system: 's', history: [] })).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
    });
  });

  it('clasifica 403 como error de auth', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Auth inválida con AI Gateway', 'auth', false));
    await expect(requestRefineTurn({ system: 's', history: [] })).rejects.toMatchObject({
      code: 'auth',
    });
  });
});
