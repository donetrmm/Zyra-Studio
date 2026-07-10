import { describe, it, expect } from 'vitest';
import { mapProviderCode } from './fail';
import { ProviderError } from '@/lib/providers/types';

// mapProviderCode traduce el código de un ProviderError al enum de fail del
// worker. safety/rate_limit/timeout pasan directo; cualquier otro código del
// provider (server, auth, invalid_input, unknown…) colapsa a 'unknown'.
describe('mapProviderCode', () => {
  it('safety pasa directo', () => {
    expect(mapProviderCode(new ProviderError('x', 'safety', false))).toBe('safety');
  });
  it('rate_limit pasa directo', () => {
    expect(mapProviderCode(new ProviderError('x', 'rate_limit', true))).toBe('rate_limit');
  });
  it('timeout pasa directo', () => {
    expect(mapProviderCode(new ProviderError('x', 'timeout', false))).toBe('timeout');
  });
  it('server colapsa a unknown (no es una variante de fail del worker)', () => {
    expect(mapProviderCode(new ProviderError('x', 'server', true))).toBe('unknown');
  });
  it('auth colapsa a unknown', () => {
    expect(mapProviderCode(new ProviderError('x', 'auth', false))).toBe('unknown');
  });
});
