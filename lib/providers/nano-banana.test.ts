import { describe, it, expect } from 'vitest';
import { buildBody, interpretResponse } from './nano-banana';
import { ProviderError, type NanoBananaParams } from './types';

const img = (data: string) => ({ buffer: Buffer.from(data), mimeType: 'image/png' });
const b64 = (data: string) => Buffer.from(data).toString('base64');

// Aplana los inline_data.data de un set de parts para aserciones legibles.
function imageDataIn(parts: Array<unknown>): string[] {
  return parts
    .map((p) => (p as { inline_data?: { data: string } }).inline_data?.data)
    .filter((d): d is string => typeof d === 'string');
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

describe('buildBody — chatReferences en modo chat', () => {
  it('en chat real, las references normales se descartan y chatReferences se incluyen', () => {
    const body = buildBody({ ...chatBase, chatReferences: [img('productref')] });
    const contents = body.contents as Array<{ role?: string; parts: Array<unknown> }>;
    // Chat = 3 turnos: user(prev) / model(prev img) / user(nuevo).
    expect(contents).toHaveLength(3);
    const lastUser = contents[2];
    expect(lastUser.role).toBe('user');
    const data = imageDataIn(lastUser.parts);
    // El producto SÍ viaja; la ref normal de personaje NO (refSlots=0 en chat).
    expect(data).toContain(b64('productref'));
    expect(data).not.toContain(b64('charref'));
  });

  it('en chat sin chatReferences, el turno nuevo no lleva imágenes', () => {
    const body = buildBody({ ...chatBase });
    const contents = body.contents as Array<{ parts: Array<unknown> }>;
    expect(imageDataIn(contents[2].parts)).toHaveLength(0);
  });

  it('fuera de chat (sin previousTurn), chatReferences se ignora y las references normales van', () => {
    const body = buildBody({
      model: 'gemini-3-pro-image-preview',
      prompt: 'fresh panel',
      references: [img('charref')],
      chatReferences: [img('productref')],
    });
    const contents = body.contents as Array<{ parts: Array<unknown> }>;
    expect(contents).toHaveLength(1);
    const data = imageDataIn(contents[0].parts);
    expect(data).toContain(b64('charref'));
    expect(data).not.toContain(b64('productref'));
  });
});

describe('interpretResponse — Gemini puede devolver 200 sin parts', () => {
  const imagePart = (data: string) => ({
    inlineData: { mimeType: 'image/png', data: Buffer.from(data).toString('base64') },
  });

  it('decodifica la imagen de una respuesta válida', () => {
    const res = interpretResponse({
      candidates: [{ content: { parts: [imagePart('pixels')] }, finishReason: 'STOP' }],
    });
    expect(res.buffer.toString()).toBe('pixels');
    expect(res.mimeType).toBe('image/png');
  });

  // El bug reportado: candidato con content pero SIN parts (bloqueo) → antes
  // crasheaba con 'Respuesta inesperada' (zod). Ahora surfacea el finishReason.
  it('candidato sin parts + finishReason de seguridad → ProviderError safety con el motivo', () => {
    try {
      interpretResponse({
        candidates: [{ content: { role: 'model' }, finishReason: 'IMAGE_SAFETY' }],
      });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).code).toBe('safety');
      expect((e as ProviderError).message).toContain('IMAGE_SAFETY');
    }
  });

  it('promptFeedback.blockReason → ProviderError safety', () => {
    try {
      interpretResponse({ candidates: [{ content: {} }], promptFeedback: { blockReason: 'SAFETY' } });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect((e as ProviderError).code).toBe('safety');
    }
  });

  it('MAX_TOKENS sin imagen → error reintentable con mensaje accionable', () => {
    try {
      interpretResponse({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).retryable).toBe(true);
      expect((e as ProviderError).message).toMatch(/token/i);
    }
  });

  it('respuesta solo-texto (sin imagen) → reporta el finishReason, no crashea', () => {
    try {
      interpretResponse({
        candidates: [{ content: { parts: [{ text: 'no puedo generar eso' }] }, finishReason: 'STOP' }],
      });
      expect.unreachable('debió lanzar ProviderError');
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).message).toContain('STOP');
    }
  });
});
