import { describe, it, expect } from 'vitest';
import {
  getStyleProfile,
  WORLD_COHERENCE_CLAUSE,
  PLANNER_PHYSICS_BLOCK,
} from './style-profiles';
import { stripSlop } from './antislop';

describe('getStyleProfile', () => {
  it('null, undefined o valor desconocido caen a ultra_realista', () => {
    expect(getStyleProfile().slug).toBe('ultra_realista');
    expect(getStyleProfile(null).slug).toBe('ultra_realista');
    expect(getStyleProfile('lo-que-sea').slug).toBe('ultra_realista');
  });

  it('ultra_realista habla de fotografía real, no de render', () => {
    const p = getStyleProfile('ultra_realista');
    expect(p.assetLocation).toMatch(/real photograph/);
    expect(p.assetCharacter).toMatch(/photograph/);
    // El vocabulario viejo que producía look de IA queda vetado en los bloques de activos.
    expect(p.assetLocation).not.toMatch(/photorealistic|cinematic/i);
    expect(p.assetCharacter).not.toMatch(/photorealistic|cinematic/i);
    expect(p.groundedPhysics).toBe(true);
    // El look de video conserva el contrato actual del compiler de Seedance.
    expect(p.video).toBe('ultra realistic, filmic color grading');
  });

  it('ningún bloque usa términos de la lista antislop', () => {
    const p = getStyleProfile('ultra_realista');
    for (const block of [p.assetLocation, p.assetCharacter, p.panel, p.video, WORLD_COHERENCE_CLAUSE]) {
      expect(stripSlop(block).removed).toEqual([]);
    }
  });

  it('las cláusulas de física anclan objetos: colgar/apoyar, nunca flotar', () => {
    expect(WORLD_COHERENCE_CLAUSE).toMatch(/hangs from|rests on/);
    expect(WORLD_COHERENCE_CLAUSE).toMatch(/never floats/);
    expect(WORLD_COHERENCE_CLAUSE.startsWith(' ')).toBe(true);
    expect(PLANNER_PHYSICS_BLOCK).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
    expect(PLANNER_PHYSICS_BLOCK).toContain('nunca flota');
  });
});

describe('presets Fase 1', () => {
  it('fantasia: física libre y look de fantasía', () => {
    const p = getStyleProfile('fantasia');
    expect(p.slug).toBe('fantasia');
    expect(p.groundedPhysics).toBe(false);
    expect(p.panel).toMatch(/fantasy/);
    expect(p.planner).toContain('FANTASÍA');
  });

  it('animado: look de animación 3D con física creíble', () => {
    const p = getStyleProfile('animado');
    expect(p.slug).toBe('animado');
    expect(p.groundedPhysics).toBe(true);
    expect(p.panel).toMatch(/3D animated film/);
    expect(p.video).toMatch(/3D animation/);
  });

  it('custom: los bloques nacen del texto del usuario; sin texto cae a realista', () => {
    const p = getStyleProfile('custom', 'acuarela suave, colores pastel');
    expect(p.slug).toBe('custom');
    expect(p.panel).toContain('acuarela suave, colores pastel');
    expect(p.planner).toContain('acuarela suave');
    expect(p.groundedPhysics).toBe(true);
    expect(getStyleProfile('custom').slug).toBe('ultra_realista');
    expect(getStyleProfile('custom', '   ').slug).toBe('ultra_realista');
  });

  it('ningún preset nuevo usa términos antislop', () => {
    for (const slug of ['fantasia', 'animado'] as const) {
      const p = getStyleProfile(slug);
      for (const block of [p.assetLocation, p.assetCharacter, p.panel, p.video]) {
        expect(stripSlop(block).removed).toEqual([]);
      }
    }
  });
});
