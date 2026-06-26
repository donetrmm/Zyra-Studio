import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  averageHash,
  hammingDistance,
  isNearlyIdentical,
  NEARLY_IDENTICAL_MAX_DISTANCE,
} from './similarity';

// Genera un PNG solido (local, sin red) para los tests deterministas.
function solidPng(r: number, g: number, b: number, size = 32): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

// Mitad negra / mitad blanca, partida en vertical: un patron con estructura.
function halfSplitPng(size = 32): Promise<Buffer> {
  const channels = 3;
  const data = Buffer.alloc(size * size * channels, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = x < size / 2 ? 0 : 255;
      const idx = (y * size + x) * channels;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels } }).png().toBuffer();
}

describe('hammingDistance', () => {
  it('cuenta los bits que difieren', () => {
    expect(hammingDistance([true, false, true], [true, false, true])).toBe(0);
    expect(hammingDistance([true, false, true], [false, false, true])).toBe(1);
    expect(hammingDistance([true, true], [false, false])).toBe(2);
  });

  it('penaliza largos distintos', () => {
    expect(hammingDistance([true], [true, false, true])).toBe(2);
  });
});

describe('isNearlyIdentical', () => {
  it('true cuando la distancia esta dentro del umbral', () => {
    const a = Array(64).fill(true);
    const b = [...a];
    for (let i = 0; i < NEARLY_IDENTICAL_MAX_DISTANCE; i++) b[i] = false;
    expect(isNearlyIdentical(a, b)).toBe(true);
  });

  it('false cuando supera el umbral', () => {
    const a = Array(64).fill(true);
    const b = [...a];
    for (let i = 0; i < NEARLY_IDENTICAL_MAX_DISTANCE + 1; i++) b[i] = false;
    expect(isNearlyIdentical(a, b)).toBe(false);
  });
});

describe('averageHash (sharp, local)', () => {
  it('una imagen identica a si misma da distancia 0', async () => {
    const img = await halfSplitPng();
    const h1 = await averageHash(img);
    const h2 = await averageHash(img);
    expect(h1).toHaveLength(64);
    expect(hammingDistance(h1, h2)).toBe(0);
  });

  it('re-encodear la misma imagen (echo) la deja casi identica', async () => {
    const img = await halfSplitPng();
    const reencoded = await sharp(img).jpeg({ quality: 85 }).toBuffer();
    const h1 = await averageHash(img);
    const h2 = await averageHash(reencoded);
    expect(isNearlyIdentical(h1, h2)).toBe(true);
  });

  it('dos patrones distintos superan el umbral', async () => {
    const black = await solidPng(0, 0, 0);
    const split = await halfSplitPng();
    const hBlack = await averageHash(black);
    const hSplit = await averageHash(split);
    expect(isNearlyIdentical(hBlack, hSplit)).toBe(false);
  });
});
