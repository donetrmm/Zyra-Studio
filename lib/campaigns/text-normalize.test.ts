import { describe, it, expect } from 'vitest';
import { normalizeText } from './text-normalize';

describe('normalizeText', () => {
  it('quita diacríticos y baja a minúsculas', () => {
    expect(normalizeText('  Retrato de PAREJA ')).toBe('retrato de pareja');
    expect(normalizeText('Canción')).toBe('cancion');
  });
  it('tolera vacío', () => {
    expect(normalizeText('')).toBe('');
  });
});
