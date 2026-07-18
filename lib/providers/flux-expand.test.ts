import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildFillCanvasAndMask, buildFillRequest, interpretImageResult } from './flux-expand';

// Lee un pixel RGB (canal 0..2) de un buffer de imagen decodificado a raw.
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

async function makeBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg()
    .toBuffer();
}

describe('buildFillCanvasAndMask', () => {
  it('el canvas suma las bandas al alto y conserva el ancho (4:5 -> 9:16)', async () => {
    const image = await makeBase(8, 10);
    const { width, height } = await buildFillCanvasAndMask({ image, top: 3, bottom: 3, prompt: 'x' });
    expect(width).toBe(8);
    expect(height).toBe(16); // 10 + 3 + 3
  });

  it('la mascara: bandas BLANCAS (generar) y centro NEGRO (preservar)', async () => {
    const image = await makeBase(8, 10);
    const { mask } = await buildFillCanvasAndMask({ image, top: 3, bottom: 3, prompt: 'x' });
    expect(await pixel(mask, 4, 0)).toEqual([255, 255, 255]); // banda superior
    expect(await pixel(mask, 4, 15)).toEqual([255, 255, 255]); // banda inferior
    expect(await pixel(mask, 4, 7)).toEqual([0, 0, 0]); // zona de la base
  });

  it('el canvas preserva los pixeles de la base en el centro y deja negras las bandas', async () => {
    const image = await makeBase(8, 10);
    const { canvas } = await buildFillCanvasAndMask({ image, top: 3, bottom: 3, prompt: 'x' });
    const [r, g, b] = await pixel(canvas, 4, 7); // dentro de la base (rojo ~200,30,30)
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
    const [tr, tg, tb] = await pixel(canvas, 4, 0); // banda superior negra
    expect(tr).toBeLessThan(40);
    expect(tg).toBeLessThan(40);
    expect(tb).toBeLessThan(40);
  });

  it('lanza si la base no tiene dimensiones legibles', async () => {
    await expect(
      buildFillCanvasAndMask({ image: Buffer.from('no-es-imagen'), top: 3, bottom: 3, prompt: 'x' }),
    ).rejects.toThrow();
  });
});

describe('buildFillRequest', () => {
  const canvas = Buffer.from('canvas');
  const mask = Buffer.from('mask');

  it('usa el slug bfl/flux-pro-1.0-fill y lleva base en images y la mascara en mask', () => {
    const req = buildFillRequest(canvas, mask, 'extiende el fondo');
    expect(req.model).toBe('bfl/flux-pro-1.0-fill');
    expect(req.prompt.text).toBe('extiende el fondo');
    expect(req.prompt.images).toEqual([canvas]);
    expect(req.prompt.mask).toBe(mask);
  });

  it('providerOptions con output jpeg y safety_tolerance por defecto (2), bajo ambos namespaces', () => {
    const req = buildFillRequest(canvas, mask, 'p');
    expect(req.providerOptions.blackForestLabs.outputFormat).toBe('jpeg');
    expect(req.providerOptions.blackForestLabs.safetyTolerance).toBe(2);
    expect(req.providerOptions.bfl).toEqual(req.providerOptions.blackForestLabs);
  });

  it('acota el poll para no exceder el maxDuration del worker', () => {
    const req = buildFillRequest(canvas, mask, 'p');
    expect(req.providerOptions.blackForestLabs.pollTimeoutMillis).toBe(50_000);
  });

  it('respeta un safetyTolerance explicito', () => {
    const req = buildFillRequest(canvas, mask, 'p', 0);
    expect(req.providerOptions.blackForestLabs.safetyTolerance).toBe(0);
  });
});

describe('interpretImageResult', () => {
  it('convierte base64 a Buffer con su mediaType', () => {
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
