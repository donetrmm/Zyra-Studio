import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const generateTextMock = vi.fn();
vi.mock('ai', () => {
  class APICallError extends Error {
    statusCode: number | undefined;
    constructor(options: { message: string; url: string; requestBodyValues: unknown; statusCode?: number }) {
      super(options.message);
      this.statusCode = options.statusCode;
    }
    static isInstance(err: unknown): err is APICallError {
      return err instanceof APICallError;
    }
  }
  return { generateText: generateTextMock, APICallError };
});

// Import dinámico DESPUÉS del mock para que el módulo vea el 'ai' mockeado.
const { buildRequest, interpretResult, generate, isChatSignatureRejection } = await import('./nano-banana');
const { APICallError } = await import('ai');
const { ProviderError } = await import('./types');
type NanoBananaParams = import('./types').NanoBananaParams;

const img = (data: string) => ({ buffer: Buffer.from(data), mimeType: 'image/png' });

// Aplana los file parts (mediaType 'file') de un set de content parts en sus
// datos como string, para aserciones legibles sobre qué referencias viajaron.
function flattenData(content: unknown): string[] {
  const parts = content as Array<{ type?: string; data?: Buffer }>;
  return parts
    .filter((p) => p.type === 'file' && Buffer.isBuffer(p.data))
    .map((p) => (p.data as Buffer).toString());
}

const chatBase: NanoBananaParams = {
  model: 'gemini-3-pro-image-preview',
  prompt: 'reframe as a tight product close-up',
  references: [img('charref')],
  previousTurn: {
    prompt: 'prev panel prompt',
    imageBuffer: Buffer.from('previmg'),
    mimeType: 'image/png',
    thoughtSignature: 'sig-123',
  },
};

describe('buildRequest — chatReferences en modo chat', () => {
  it('en chat real, las references normales se descartan y chatReferences se incluyen', () => {
    const req = buildRequest({ ...chatBase, chatReferences: [img('productref')] });
    // Chat = 3 mensajes: user(prev texto) / assistant(imagen previa+sig) / user(nuevo).
    expect(req.messages).toHaveLength(3);
    const lastUser = req.messages[2] as { role: string; content: unknown };
    expect(lastUser.role).toBe('user');
    const data = flattenData(lastUser.content);
    // El producto SÍ viaja; la ref normal de personaje NO (refSlots=0 en chat).
    expect(data).toContain('productref');
    expect(data).not.toContain('charref');
  });

  it('en chat sin chatReferences, el turno nuevo no lleva imágenes', () => {
    const req = buildRequest({ ...chatBase });
    const lastUser = req.messages[2] as { content: unknown };
    expect(flattenData(lastUser.content)).toHaveLength(0);
  });

  it('fuera de chat (sin previousTurn), chatReferences se ignora y las references normales van', () => {
    const req = buildRequest({
      model: 'gemini-3-pro-image-preview',
      prompt: 'fresh panel',
      references: [img('charref')],
      chatReferences: [img('productref')],
    });
    expect(req.messages).toHaveLength(1);
    const data = flattenData((req.messages[0] as { content: unknown }).content);
    expect(data).toContain('charref');
    expect(data).not.toContain('productref');
  });

  it('el turno previo viaja como assistant con thoughtSignature en providerOptions.google', () => {
    const req = buildRequest({ ...chatBase });
    const assistantMsg = req.messages[1] as {
      role: string;
      content: Array<{ type: string; data: Buffer; providerOptions?: { google?: { thoughtSignature?: string } } }>;
    };
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toHaveLength(1);
    expect(assistantMsg.content[0].type).toBe('file');
    expect(assistantMsg.content[0].data.toString()).toBe('previmg');
    expect(assistantMsg.content[0].providerOptions?.google?.thoughtSignature).toBe('sig-123');
  });

  it('sin firma previa, degrada a single-turn adjuntando la imagen previa como ref normal', () => {
    const req = buildRequest({
      model: 'gemini-3-pro-image-preview',
      prompt: 'reframe',
      references: [img('charref')],
      previousTurn: {
        prompt: 'prev',
        imageBuffer: Buffer.from('previmg'),
        mimeType: 'image/png',
        thoughtSignature: undefined,
      },
    });
    expect(req.messages).toHaveLength(1);
    const single = req.messages[0] as { role: string; content: Array<{ type: string; text?: string }> };
    expect(single.role).toBe('user');
    const data = flattenData(single.content);
    // La imagen previa cuenta como ref normal + la ref de personaje también cabe.
    expect(data).toContain('previmg');
    expect(data).toContain('charref');
    expect((single.content[0] as { text?: string }).text).toContain('Edit the previous image');
  });
});

describe('buildRequest — providerOptions.google', () => {
  it('siempre incluye responseModalities IMAGE y omite imageConfig/tools por defecto', () => {
    const req = buildRequest({ model: 'gemini-3-pro-image-preview', prompt: 'x' });
    expect(req.providerOptions.google.responseModalities).toEqual(['IMAGE']);
    expect(req.providerOptions.google.imageConfig).toBeUndefined();
    expect(req.providerOptions.google.tools).toBeUndefined();
  });

  it('incluye imageConfig cuando hay aspectRatio o resolution', () => {
    const req = buildRequest({
      model: 'gemini-3-pro-image-preview',
      prompt: 'x',
      aspectRatio: '16:9',
      resolution: '2K',
    });
    expect(req.providerOptions.google.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '2K' });
  });

  it('incluye tools google_search cuando useGrounding', () => {
    const req = buildRequest({ model: 'gemini-3-pro-image-preview', prompt: 'x', useGrounding: true });
    expect(req.providerOptions.google.tools).toEqual([{ google_search: {} }]);
  });
});

describe('interpretResult — decodifica GenerationResult o clasifica el error', () => {
  const fileOf = (data: string, mediaType = 'image/png') => ({
    uint8Array: new Uint8Array(Buffer.from(data)),
    mediaType,
  });

  it('decodifica la imagen de un resultado con files', () => {
    const res = interpretResult({ files: [fileOf('pixels')], finishReason: 'stop' });
    expect(res.buffer.toString()).toBe('pixels');
    expect(res.mimeType).toBe('image/png');
    expect(res.thoughtSignature).toBeUndefined();
  });

  it('incluye el thoughtSignature de providerMetadata.google', () => {
    const res = interpretResult({
      files: [fileOf('pixels')],
      finishReason: 'stop',
      providerMetadata: { google: { thoughtSignature: 'sig-abc' } },
    });
    expect(res.thoughtSignature).toBe('sig-abc');
  });

  it('ignora providerMetadata.google.thoughtSignature si no es string', () => {
    const res = interpretResult({
      files: [fileOf('pixels')],
      finishReason: 'stop',
      providerMetadata: { google: { thoughtSignature: 12345 } },
    });
    expect(res.thoughtSignature).toBeUndefined();
  });

  it('files vacío + finishReason content-filter -> ProviderError safety', () => {
    try {
      interpretResult({ files: [], finishReason: 'content-filter' });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as InstanceType<typeof ProviderError>).code).toBe('safety');
    }
  });

  it('files vacío + finishReason length -> ProviderError server retryable', () => {
    try {
      interpretResult({ files: [], finishReason: 'length' });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as InstanceType<typeof ProviderError>).code).toBe('server');
      expect((e as InstanceType<typeof ProviderError>).retryable).toBe(true);
      expect((e as InstanceType<typeof ProviderError>).message).toMatch(/token/i);
    }
  });

  it('files vacío + otro finishReason -> unknown con el motivo en el mensaje', () => {
    try {
      interpretResult({ files: [], finishReason: 'stop' });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as InstanceType<typeof ProviderError>).code).toBe('unknown');
      expect((e as InstanceType<typeof ProviderError>).message).toContain('stop');
    }
  });
});

describe('isChatSignatureRejection', () => {
  it('trata 404 o mensaje con NOT_FOUND como rechazo del thought_signature', () => {
    expect(isChatSignatureRejection(404, 'boom')).toBe(true);
    expect(isChatSignatureRejection(200, 'Requested entity was not found. NOT_FOUND')).toBe(true);
  });

  it('no trata otros errores como rechazo de firma', () => {
    expect(isChatSignatureRejection(400, 'INVALID_ARGUMENT')).toBe(false);
    expect(isChatSignatureRejection(500, 'boom')).toBe(false);
    expect(isChatSignatureRejection(403, 'PERMISSION_DENIED')).toBe(false);
  });
});

describe('generate — fallback single-turn cuando Gemini rechaza el thought_signature', () => {
  const OLD_KEY = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    generateTextMock.mockReset();
  });
  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = OLD_KEY;
  });

  const okResult = {
    files: [{ uint8Array: new Uint8Array(Buffer.from('pixels')), mediaType: 'image/png' }],
    finishReason: 'stop',
  };

  it('lanza auth si falta AI_GATEWAY_API_KEY', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    await expect(generate({ ...chatBase })).rejects.toMatchObject({ code: 'auth', retryable: false });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('al recibir 404 NOT_FOUND en modo chat, reintenta sin la firma (single-turn) y entrega la imagen', async () => {
    generateTextMock
      .mockRejectedValueOnce(
        new APICallError({
          message: 'Requested entity was not found.',
          url: '',
          requestBodyValues: {},
          statusCode: 404,
        }),
      )
      .mockResolvedValueOnce(okResult);

    const result = await generate({ ...chatBase });

    expect(result.buffer.toString()).toBe('pixels');
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    // 1er intento: chat (3 mensajes con la firma). 2o intento: single-turn (1 mensaje) sin firma.
    const firstMessages = generateTextMock.mock.calls[0][0].messages as unknown[];
    const secondMessages = generateTextMock.mock.calls[1][0].messages as unknown[];
    expect(firstMessages).toHaveLength(3);
    expect(secondMessages).toHaveLength(1);
  });

  it('no reintenta si el 404 no es en modo chat (sin firma previa)', async () => {
    generateTextMock.mockRejectedValue(
      new APICallError({ message: 'nope', url: '', requestBodyValues: {}, statusCode: 404 }),
    );

    await expect(
      generate({ model: 'gemini-3-pro-image-preview', prompt: 'fresh', references: [img('x')] }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('401/403 -> ProviderError auth no retryable', async () => {
    generateTextMock.mockRejectedValue(
      new APICallError({ message: 'forbidden', url: '', requestBodyValues: {}, statusCode: 403 }),
    );
    await expect(generate({ model: 'gemini-3-pro-image-preview', prompt: 'x' })).rejects.toMatchObject({
      code: 'auth',
      retryable: false,
    });
  });

  it('400 -> ProviderError invalid_input', async () => {
    generateTextMock.mockRejectedValue(
      new APICallError({ message: 'bad request', url: '', requestBodyValues: {}, statusCode: 400 }),
    );
    await expect(generate({ model: 'gemini-3-pro-image-preview', prompt: 'x' })).rejects.toMatchObject({
      code: 'invalid_input',
      retryable: false,
    });
  });

  it('5xx -> ProviderError server retryable', async () => {
    generateTextMock.mockRejectedValue(
      new APICallError({ message: 'boom', url: '', requestBodyValues: {}, statusCode: 503 }),
    );
    await expect(generate({ model: 'gemini-3-pro-image-preview', prompt: 'x' })).rejects.toMatchObject({
      code: 'server',
      retryable: true,
    });
  });
});
