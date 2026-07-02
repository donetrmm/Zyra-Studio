import { describe, it, expect } from 'vitest';
import { buildLocationPrompt, buildCharacterMasterPrompt } from './asset-prompts';

describe('buildLocationPrompt', () => {
  it('describe una fotografía real, sin vocabulario de render', () => {
    const p = buildLocationPrompt('cuarto low key con lámpara cálida');
    expect(p).toContain('cuarto low key con lámpara cálida');
    expect(p).toMatch(/real photograph/);
    // "photorealistic", "cinematic" y "set" eran el vocabulario que producía
    // el look de IA (plató limpio + color grading de película).
    expect(p).not.toMatch(/photorealistic|cinematic/i);
    expect(p).not.toMatch(/\bset\b/);
  });

  it('mantiene el contrato de escenario: primer plano libre, sin personas, sin texto', () => {
    const p = buildLocationPrompt('un jardín trasero');
    expect(p).toMatch(/Establishing shot of a location/);
    expect(p).toMatch(/open foreground space/);
    expect(p).toMatch(/Empty of people/);
    expect(p).toMatch(/no text, no watermark/);
  });
});

describe('buildCharacterMasterPrompt', () => {
  it('retrato frontal neutro con lenguaje de captura fotográfica', () => {
    const p = buildCharacterMasterPrompt('mujer de treintas, cabello rizado oscuro');
    expect(p).toContain('mujer de treintas');
    expect(p).toMatch(/head-and-shoulders portrait/);
    expect(p).toMatch(/unretouched photograph/);
    expect(p).toMatch(/no text, no watermark/i);
    // Los criterios de hoja de referencia se conservan (identidad estable).
    expect(p).toMatch(/Neutral relaxed expression/);
    expect(p).toMatch(/seamless background/);
  });
});

describe('asset prompts con perfil', () => {
  it('animado genera locación con look de animación, sin bloque fotográfico', () => {
    const p = buildLocationPrompt('una cocina soleada', 'animado');
    expect(p).toMatch(/3D animated film/);
    expect(p).not.toMatch(/real photograph/);
  });

  it('custom inyecta el texto del usuario', () => {
    const p = buildCharacterMasterPrompt('un chef', 'custom', 'estilo cómic europeo, línea clara');
    expect(p).toContain('estilo cómic europeo');
  });
});
