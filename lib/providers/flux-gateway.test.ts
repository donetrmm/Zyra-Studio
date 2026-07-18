import { describe, it, expect } from 'vitest';
import { buildImageRequest, interpretImageResult, fluxDimensions } from './flux-gateway';

describe('fluxDimensions', () => {
  it('mapea el aspecto del estudio a dimensiones exactas', () => {
    expect(fluxDimensions('1:1')).toEqual({ width: 1024, height: 1024 });
    expect(fluxDimensions('4:5')).toEqual({ width: 1024, height: 1280 });
    expect(fluxDimensions('9:16')).toEqual({ width: 864, height: 1536 });
    expect(fluxDimensions('16:9')).toEqual({ width: 1536, height: 864 });
  });
  it('4:5 respeta la proporción (0.8) que el set discreto de FLUX no soporta', () => {
    const d = fluxDimensions('4:5');
    expect(d.width / d.height).toBeCloseTo(0.8, 5);
  });
  it('aspecto ausente o desconocido -> 1:1 (1024x1024)', () => {
    expect(fluxDimensions(undefined)).toEqual({ width: 1024, height: 1024 });
    expect(fluxDimensions('raro')).toEqual({ width: 1024, height: 1024 });
  });
});

describe('buildImageRequest (flux-gateway)', () => {
  it('genera desde texto: prompt string, slug bfl/ y dims en ambos namespaces', () => {
    const req = buildImageRequest({ model: 'flux-2-pro', prompt: 'una taza azul', aspectRatio: '9:16' });
    expect(req.model).toBe('bfl/flux-2-pro');
    expect(req.prompt).toBe('una taza azul');
    // width/height fuerzan la proporción, bajo bfl y blackForestLabs (namespace
    // ambiguo por el gateway).
    expect(req.providerOptions.bfl).toEqual({ width: 864, height: 1536 });
    expect(req.providerOptions.blackForestLabs).toEqual({ width: 864, height: 1536 });
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

  it('sin aspecto usa dims default 1024x1024', () => {
    const req = buildImageRequest({ model: 'flux-2-pro', prompt: 'x' });
    expect(req.providerOptions.bfl).toEqual({ width: 1024, height: 1024 });
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
