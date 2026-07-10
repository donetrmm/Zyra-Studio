import { describe, it, expect } from 'vitest';
import { buildImageRequest, interpretImageResult } from './flux-gateway';

describe('buildImageRequest (flux-gateway)', () => {
  it('genera desde texto: prompt string y slug bfl/', () => {
    const req = buildImageRequest({ model: 'flux-2-pro', prompt: 'una taza azul' });
    expect(req.model).toBe('bfl/flux-2-pro');
    expect(req.prompt).toBe('una taza azul');
    expect(req.aspectRatio).toBeUndefined();
  });

  it('flux-2-max mapea a bfl/flux-2-max', () => {
    expect(buildImageRequest({ model: 'flux-2-max', prompt: 'x' }).model).toBe('bfl/flux-2-max');
  });

  it('edita: prompt.images lleva los buffers de las referencias (base + refs)', () => {
    const base = { buffer: Buffer.from('base'), mimeType: 'image/png' };
    const ref = { buffer: Buffer.from('ref'), mimeType: 'image/png' };
    const req = buildImageRequest({ model: 'flux-2-pro', prompt: 'ponla en mármol', references: [base, ref] });
    expect(typeof req.prompt).toBe('object');
    const p = req.prompt as { text: string; images: Buffer[] };
    expect(p.text).toBe('ponla en mármol');
    expect(p.images).toEqual([base.buffer, ref.buffer]);
  });

  it('aspectRatio se propaga cuando viene', () => {
    const req = buildImageRequest({ model: 'flux-2-pro', prompt: 'x', aspectRatio: '9:16' });
    expect(req.aspectRatio).toBe('9:16');
  });
});

describe('interpretImageResult (flux-gateway)', () => {
  it('convierte base64 a Buffer con su mimeType', () => {
    const b64 = Buffer.from('hola').toString('base64');
    const out = interpretImageResult({ images: [{ base64: b64, mediaType: 'image/webp' }] });
    expect(out.buffer.toString()).toBe('hola');
    expect(out.mimeType).toBe('image/webp');
  });

  it('default mimeType image/jpeg si el proveedor no lo da', () => {
    const b64 = Buffer.from('x').toString('base64');
    expect(interpretImageResult({ images: [{ base64: b64 }] }).mimeType).toBe('image/jpeg');
  });

  it('sin imagen lanza ProviderError', () => {
    expect(() => interpretImageResult({ images: [] })).toThrow();
  });
});
