import { describe, it, expect } from 'vitest';
import { mapCode, gptImageSize } from './image-turn';
import { ProviderError } from '@/lib/providers/types';

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
