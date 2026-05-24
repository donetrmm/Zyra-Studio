import { describe, it, expect } from 'vitest';
import { chunkText } from './elevenlabs';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hola mundo.', 4000, 3000);
    expect(chunks).toEqual(['Hola mundo.']);
  });

  it('returns single chunk when at threshold', () => {
    const text = 'a'.repeat(4000);
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks).toEqual([text]);
  });

  it('splits long text by sentences when over threshold', () => {
    const sentence = 'Una frase de cuarenta caracteres exactos. ';
    const text = sentence.repeat(200); // > 4000 chars
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    // Cada chunk no debe exceder el cap
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3000);
    // Concatenando recuperamos algo equivalente al input (sin trims agresivos)
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      text.replace(/\s+/g, ' ').trim(),
    );
  });

  it('handles text without sentence punctuation by hard-splitting at cap', () => {
    const text = 'palabra '.repeat(1000); // ~8000 chars, sin puntos
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3000);
  });

  it('preserves Spanish characters and emoji', () => {
    const text = '¡Hola! ¿Cómo estás? 🎉 ' + 'a'.repeat(5000);
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks[0]).toContain('¡Hola!');
    expect(chunks[0]).toContain('🎉');
  });
});
