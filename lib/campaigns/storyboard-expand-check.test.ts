import { describe, it, expect } from 'vitest';
import { parseTextCheck } from './storyboard-expand-check';

describe('parseTextCheck', () => {
  it('veredicto true', () => {
    expect(parseTextCheck(JSON.stringify({ hasText: true }))).toBe(true);
  });
  it('veredicto false', () => {
    expect(parseTextCheck(JSON.stringify({ hasText: false }))).toBe(false);
  });
  it('JSON invalido -> null (fail-open del caller)', () => {
    expect(parseTextCheck('no es json')).toBeNull();
  });
  it('shape inesperado -> null', () => {
    expect(parseTextCheck(JSON.stringify({ otra: 1 }))).toBeNull();
  });
  it('texto vacío -> null', () => {
    expect(parseTextCheck('')).toBeNull();
    expect(parseTextCheck(undefined)).toBeNull();
  });
});
