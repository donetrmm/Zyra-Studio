import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { safeAreaBands, composeOnto916, centralSafeCrop, pinCenter } from './safe-area';

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}
async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
}
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

describe('safeAreaBands', () => {
  it('calcula banda y alto del lienzo 9:16 desde el ancho de la base 4:5', () => {
    // 360 -> canvas 640 (360*16/9), base 450 (360*5/4), banda (640-450)/2 = 95.
    expect(safeAreaBands(360)).toEqual({ bandPx: 95, canvasHeight: 640 });
  });
});

describe('composeOnto916', () => {
  it('centra la base 4:5 en un lienzo 9:16 con bandas negras', async () => {
    const base = await solid(360, 450, [200, 30, 30]); // rojo
    const out = await composeOnto916(base);
    expect(await dims(out)).toEqual({ w: 360, h: 640 });
    expect(await pixel(out, 180, 320)).toEqual([200, 30, 30]); // centro = base
    expect(await pixel(out, 180, 10)).toEqual([0, 0, 0]); // banda superior negra
    expect(await pixel(out, 180, 630)).toEqual([0, 0, 0]); // banda inferior negra
  });
});

describe('centralSafeCrop', () => {
  it('recupera el 4:5 central de un 9:16 (roundtrip con compose)', async () => {
    const base = await solid(360, 450, [30, 160, 60]); // verde
    const panel = await composeOnto916(base);
    const back = await centralSafeCrop(panel);
    expect(await dims(back)).toEqual({ w: 360, h: 450 });
    expect(await pixel(back, 180, 225)).toEqual([30, 160, 60]);
    expect(await pixel(back, 5, 5)).toEqual([30, 160, 60]);
  });
});

describe('pinCenter', () => {
  it('pega la base original sobre el centro; las bandas vienen del extendido', async () => {
    const extended = await solid(360, 640, [20, 40, 200]); // azul (simula salida Nano)
    const base = await solid(360, 450, [200, 30, 30]); // rojo
    const out = await pinCenter(extended, base);
    expect(await dims(out)).toEqual({ w: 360, h: 640 });
    expect(await pixel(out, 180, 320)).toEqual([200, 30, 30]); // centro = base
    expect(await pixel(out, 180, 10)).toEqual([20, 40, 200]); // banda = extendido
    expect(await pixel(out, 180, 630)).toEqual([20, 40, 200]);
  });
});
