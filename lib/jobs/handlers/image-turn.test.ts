import { describe, it, expect } from 'vitest';
import { gptImageSize } from './image-turn';
import { assembleStudioPrompt, PRODUCT_IDENTITY_CLAUSE } from '@/lib/studio/prompt-assembly';

// El mapeo de código ProviderError->fail vive ahora en ./fail (mapProviderCode)
// y se testea en fail.test.ts — antes estaba duplicado como mapCode aquí.
describe('gptImageSize', () => {
  it('cuadrado -> 1024x1024', () => {
    expect(gptImageSize('1:1')).toBe('1024x1024');
  });
  it('apaisado (w>h) -> 1536x1024', () => {
    expect(gptImageSize('16:9')).toBe('1536x1024');
  });
  it('vertical (h>w) -> 1024x1536', () => {
    expect(gptImageSize('9:16')).toBe('1024x1536');
  });
  it('aspectRatio ausente o no parseable -> default 1024x1024', () => {
    expect(gptImageSize(undefined)).toBe('1024x1024');
    expect(gptImageSize('raro')).toBe('1024x1024');
  });
});

describe('runImageTurn: ensamblado de prompt del turno', () => {
  it('guard on producto = prompt + cláusula (lo que el worker manda al proveedor)', () => {
    const finalPrompt = assembleStudioPrompt('quita el fondo', { keepIdentical: true, assetType: 'product' });
    expect(finalPrompt).toContain('quita el fondo');
    expect(finalPrompt.endsWith(PRODUCT_IDENTITY_CLAUSE)).toBe(true);
  });
  it('cap gpt-image: base + 4 refs se recorta a 4', () => {
    const refs = [{ b: 'base' }, { b: 'r1' }, { b: 'r2' }, { b: 'r3' }, { b: 'r4' }];
    expect(refs.slice(0, 4)).toHaveLength(4);
    expect(refs.slice(0, 4)[0].b).toBe('base'); // la base sobrevive el recorte (va primera)
  });
});
