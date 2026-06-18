import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from './orchestrator';

describe('buildContinuationPrompt', () => {
  it('sin personajes ni cierre: producto(s) + fotograma previo', () => {
    const out = buildContinuationPrompt('A dog runs.', 1, 0);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).not.toContain('@image3');
    expect(out.endsWith('A dog runs.')).toBe(true);
  });

  it('con personaje: lo cita entre el producto y el fotograma previo', () => {
    const out = buildContinuationPrompt('Scene.', 1, 1);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is a main character');
    expect(out).toContain('@image3 is the final frame of the previous shot');
    expect(out).not.toContain('@image4');
  });

  it('1 producto + 2 personajes + cierre: índices correctos', () => {
    const out = buildContinuationPrompt('Scene.', 1, 2, { withClosingFrame: true });
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is a main character');
    expect(out).toContain('@image3 is a main character');
    expect(out).toContain('@image4 is the final frame of the previous shot');
    expect(out).toContain('@image5 is the target final frame');
  });

  it('sin producto, 1 personaje: el personaje es @image1', () => {
    const out = buildContinuationPrompt('Scene.', 0, 1);
    expect(out).toContain('@image1 is a main character');
    expect(out).toContain('@image2 is the final frame of the previous shot');
  });

  it('re-ancla idioma es-MX y lip-sync con diálogo + audio (#3)', () => {
    const out = buildContinuationPrompt('She looks to camera. Dialogue: "Pruébalo."', 1, 1, {
      language: 'es',
      generateAudio: true,
    });
    expect(out).toContain('Synchronized on-camera speech');
    expect(out).toContain('natural Mexican accent');
  });

  it('re-ancla el idioma inglés cuando la campaña es en inglés (#3)', () => {
    const out = buildContinuationPrompt('A presenter says one line to camera', 1, 0, {
      language: 'en',
      generateAudio: true,
    });
    expect(out).toContain('must be in English');
  });

  it('sin audio no añade dirección de voz (#3)', () => {
    const out = buildContinuationPrompt('Dialogue: "Hola"', 1, 0, { generateAudio: false });
    expect(out).not.toContain('Synchronized on-camera speech');
    expect(out).not.toContain('must be in');
  });

  it('clip de puro producto (sin voz) no añade idioma (#3)', () => {
    const out = buildContinuationPrompt('The can rotates on marble', 1, 0, { generateAudio: true });
    expect(out).not.toContain('must be in');
  });

  it('ancla el producto contra animación de la foto impresa, conciso (#B)', () => {
    const out = buildContinuationPrompt('Scene.', 1, 0);
    expect(out).toMatch(/design, colors and proportions consistent/);
    expect(out).toMatch(/still print, not animated/);
  });
});
