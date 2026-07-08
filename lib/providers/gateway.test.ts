import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from './types';

const generateTextMock = vi.fn();
vi.mock('ai', () => {
  class APICallError extends Error {
    statusCode: number | undefined;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
    static isInstance(err: unknown): err is APICallError {
      return err instanceof APICallError;
    }
  }
  return { generateText: generateTextMock, APICallError };
});

// Import dinámico DESPUÉS del mock para que el módulo vea el 'ai' mockeado.
const { gatewayText, toGatewayModel, stripFences } = await import('./gateway');
const { APICallError } = await import('ai');

function ok(text: string, finishReason = 'stop') {
  return { text, finishReason };
}

describe('toGatewayModel', () => {
  it('prefija el slug interno con google/', () => {
    expect(toGatewayModel('gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
  });
});

describe('stripFences', () => {
  it('quita fences ```json', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('deja el texto sin fences intacto', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('gatewayText', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
  });

  it('lanza auth si falta AI_GATEWAY_API_KEY', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'auth', retryable: false });
  });

  it('traduce contents nativos a messages del AI SDK y pasa thinkingBudget 0', async () => {
    generateTextMock.mockResolvedValue(ok('respuesta'));
    await gatewayText({
      model: 'gemini-2.5-flash', label: 'test', json: false, system: 'SYS',
      contents: [{
        role: 'user',
        parts: [{ text: 'hola' }, { inline_data: { mime_type: 'image/png', data: 'AAAA' } }],
      }],
      temperature: 0.4, maxOutputTokens: 1200,
    });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.model).toBe('google/gemini-2.5-flash');
    expect(args.system).toBe('SYS');
    expect(args.temperature).toBe(0.4);
    expect(args.maxOutputTokens).toBe(1200);
    expect(args.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'hola' },
        { type: 'file', mediaType: 'image/png', data: 'AAAA' },
      ],
    }]);
    expect(args.providerOptions.google).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(args.providerOptions.vertex).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it('mapea role model a assistant', async () => {
    generateTextMock.mockResolvedValue(ok('x'));
    await gatewayText({
      model: 'gemini-2.5-flash', label: 'test', json: true,
      contents: [
        { role: 'user', parts: [{ text: 'pregunta' }] },
        { role: 'model', parts: [{ text: 'respuesta previa' }] },
        { role: 'user', parts: [{ text: 'siguiente' }] },
      ],
      temperature: 0.4, maxOutputTokens: 1200,
    });
    const roles = generateTextMock.mock.calls[0][0].messages.map(
      (m: { role: string }) => m.role,
    );
    expect(roles).toEqual(['user', 'assistant', 'user']);
  });

  it('con json:true limpia fences del texto', async () => {
    generateTextMock.mockResolvedValue(ok('```json\n{"a":1}\n```'));
    const result = await gatewayText({
      model: 'gemini-2.5-flash', label: 'test', json: true,
      contents: [{ role: 'user', parts: [{ text: 'x' }] }],
      temperature: 0.2, maxOutputTokens: 100,
    });
    expect(result.text).toBe('{"a":1}');
    expect(result.finishReason).toBe('stop');
  });

  it('429 -> ProviderError rate_limit retryable (sin reintento interno)', async () => {
    generateTextMock.mockRejectedValue(new APICallError('too many', 429));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryable: true });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('401/403 -> auth no retryable', async () => {
    generateTextMock.mockRejectedValue(new APICallError('forbidden', 403));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'auth', retryable: false });
  });

  it('5xx -> server retryable con el label en el mensaje', async () => {
    generateTextMock.mockRejectedValue(new APICallError('boom', 503));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'matcher', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'server', retryable: true, message: expect.stringContaining('matcher') });
  });

  it('error no-API -> unknown no retryable', async () => {
    generateTextMock.mockRejectedValue(new Error('red caída'));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'unknown', retryable: false });
  });
});
