import { describe, it, expect } from 'vitest';
import { buildBody } from './nano-banana';
import type { NanoBananaParams } from './types';

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
