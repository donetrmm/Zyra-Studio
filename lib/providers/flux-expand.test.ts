import { describe, it, expect } from 'vitest';
import { buildExpandBody } from './flux-expand';

describe('buildExpandBody', () => {
  const image = Buffer.from('hello-image');
  it('lleva la imagen en base64 raw (sin prefijo data:)', () => {
    const body = buildExpandBody({ image, top: 95, bottom: 95, prompt: 'p' });
    expect(body.image).toBe(image.toString('base64'));
    expect(String(body.image)).not.toContain('data:');
  });
  it('pasa top/bottom y deja left/right en 0 por defecto', () => {
    const body = buildExpandBody({ image, top: 95, bottom: 95, prompt: 'p' });
    expect(body.top).toBe(95);
    expect(body.bottom).toBe(95);
    expect(body.left).toBe(0);
    expect(body.right).toBe(0);
  });
  it('incluye el prompt, output_format jpeg y safety_tolerance por defecto', () => {
    const body = buildExpandBody({ image, top: 95, bottom: 95, prompt: 'extiende' });
    expect(body.prompt).toBe('extiende');
    expect(body.output_format).toBe('jpeg');
    expect(body.safety_tolerance).toBe(2);
  });
});
