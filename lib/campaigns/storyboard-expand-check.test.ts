import { describe, it, expect } from 'vitest';
import { parseTextCheck } from './storyboard-expand-check';

const geminiJson = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe('parseTextCheck', () => {
  it('veredicto true', () => {
    expect(parseTextCheck(geminiJson('{"hasText": true}'))).toBe(true);
  });
  it('veredicto false', () => {
    expect(parseTextCheck(geminiJson('{"hasText": false}'))).toBe(false);
  });
  it('JSON invalido -> null (fail-open del caller)', () => {
    expect(parseTextCheck(geminiJson('no es json'))).toBeNull();
  });
  it('shape inesperado -> null', () => {
    expect(parseTextCheck(geminiJson('{"otra": 1}'))).toBeNull();
  });
  it('respuesta sin candidates -> null', () => {
    expect(parseTextCheck({})).toBeNull();
  });
});
