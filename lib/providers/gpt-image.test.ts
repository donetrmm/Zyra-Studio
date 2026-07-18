import { describe, it, expect } from 'vitest';
import { buildImageRequest, interpretImageResult } from './gpt-image';

describe('buildImageRequest', () => {
  it('genera desde texto: prompt string y modelo openai/', () => {
    const req = buildImageRequest({ model: 'gpt-image-1', prompt: 'una taza azul' });
    expect(req.model).toBe('openai/gpt-image-1');
    expect(req.prompt).toBe('una taza azul');
    expect(req.providerOptions).toBeUndefined();
  });

  it('edita: prompt.images lleva los buffers de las referencias (base + refs)', () => {
    const base = { buffer: Buffer.from('base'), mimeType: 'image/png' };
    const ref = { buffer: Buffer.from('ref'), mimeType: 'image/png' };
    const req = buildImageRequest({ model: 'gpt-image-2', prompt: 'ponla en mármol', references: [base, ref] });
    expect(typeof req.prompt).toBe('object');
    const p = req.prompt as { text: string; images: Buffer[] };
    expect(p.text).toBe('ponla en mármol');
    expect(p.images).toEqual([base.buffer, ref.buffer]);
  });

  it('quality solo aplica a gpt-image-2', () => {
    const two = buildImageRequest({ model: 'gpt-image-2', prompt: 'x', quality: 'high' });
    expect(two.providerOptions).toEqual({ openai: { quality: 'high' } });
    const one = buildImageRequest({ model: 'gpt-image-1', prompt: 'x', quality: 'high' });
    expect(one.providerOptions).toBeUndefined();
  });

  it('size se propaga cuando viene', () => {
    const req = buildImageRequest({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024' });
    expect(req.size).toBe('1024x1024');
  });
});

describe('interpretImageResult', () => {
  it('convierte base64 a Buffer con su mimeType', () => {
    const b64 = Buffer.from('hola').toString('base64');
    const out = interpretImageResult({ images: [{ base64: b64, mediaType: 'image/webp' }] });
    expect(out.buffer.toString()).toBe('hola');
    expect(out.mimeType).toBe('image/webp');
  });

  it('default mimeType image/png si el proveedor no lo da', () => {
    const b64 = Buffer.from('x').toString('base64');
    expect(interpretImageResult({ images: [{ base64: b64 }] }).mimeType).toBe('image/png');
  });

  it('sin imagen lanza ProviderError', () => {
    expect(() => interpretImageResult({ images: [] })).toThrow();
  });
});
