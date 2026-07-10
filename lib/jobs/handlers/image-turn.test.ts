import { describe, it, expect } from 'vitest';
import { mapCode, gptImageSize } from './image-turn';
import { ProviderError } from '@/lib/providers/types';
import { assembleStudioPrompt, PRODUCT_IDENTITY_CLAUSE } from '@/lib/studio/prompt-assembly';

// mapCode traduce el código de un ProviderError al enum de fail del worker.
// Las variantes safety/rate_limit/timeout pasan directo; cualquier otro código
// del provider (server, auth, invalid_input, unknown...) colapsa a 'unknown'.
describe('mapCode', () => {
  it('safety pasa directo', () => {
    expect(mapCode(new ProviderError('x', 'safety', false))).toBe('safety');
  });
  it('rate_limit pasa directo', () => {
    expect(mapCode(new ProviderError('x', 'rate_limit', true))).toBe('rate_limit');
  });
  it('timeout pasa directo', () => {
    expect(mapCode(new ProviderError('x', 'timeout', false))).toBe('timeout');
  });
  it('server colapsa a unknown (no es una variante de fail del worker)', () => {
    expect(mapCode(new ProviderError('x', 'server', true))).toBe('unknown');
  });
  it('auth colapsa a unknown', () => {
    expect(mapCode(new ProviderError('x', 'auth', false))).toBe('unknown');
  });
});

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
