import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { safeAreaBands, centralSafeCrop } from './safe-area';

describe('safeAreaBands', () => {
  it('360 de ancho -> canvas 640, banda 95', () => {
    expect(safeAreaBands(360)).toEqual({ bandPx: 95, canvasHeight: 640 });
  });
  it('la base 4:5 + 2 bandas reconstruye el canvas 9:16', () => {
    const { bandPx, canvasHeight } = safeAreaBands(360);
    const baseHeight = Math.round(360 * 5 / 4);
    expect(baseHeight + 2 * bandPx).toBe(canvasHeight);
  });
});

describe('centralSafeCrop', () => {
  it('de un 9:16 (360x640) recorta el 4:5 central (360x450)', async () => {
    const panel = await sharp({
      create: { width: 360, height: 640, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const cropped = await centralSafeCrop(panel);
    const meta = await sharp(cropped).metadata();
    expect(meta.width).toBe(360);
    expect(meta.height).toBe(450);
  });
});
