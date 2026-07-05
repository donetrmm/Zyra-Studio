import { describe, it, expect } from 'vitest';
import {
  getStyleProfile,
  plannerStyleBlocks,
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
    // Look de video: base ultra realista + balance neutro (feedback 2026-07-04:
    // controlar la dominante amarilla).
    expect(p.video).toMatch(/^ultra realistic, filmic color grading/);
    expect(p.video).toMatch(/neutral white balance/);
  });

  // Feedback 2026-07-04: "controlar tonos amarillos, poner colores naturales".
  // Los generadores tienen warm-bias; el balance neutro se pide explícito.
  it('ultra_realista pide balance de blancos neutro en todas las etapas', () => {
    const p = getStyleProfile('ultra_realista');
    expect(p.assetLocation).toMatch(/neutral white balance/);
    expect(p.assetCharacter).toMatch(/neutral white balance/);
    expect(p.panel).toMatch(/neutral white balance/);
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
    for (const slug of ['fantasia', 'animado', 'casero'] as const) {
      const p = getStyleProfile(slug);
      for (const block of [p.assetLocation, p.assetCharacter, p.panel, p.video]) {
        expect(stripSlop(block).removed).toEqual([]);
      }
    }
  });

  // Feedback 2026-07-04: "poder escoger tipo de cámara (profesional, iPhone)".
  // Casero = captura de smartphone/UGC; la cámara profesional sigue siendo el
  // default de ultra_realista.
  it('casero: captura de smartphone, foto-real, balance neutro y física anclada', () => {
    const p = getStyleProfile('casero');
    expect(p.slug).toBe('casero');
    expect(p.photoreal).toBe(true);
    expect(p.groundedPhysics).toBe(true);
    expect(p.assetLocation).toMatch(/smartphone/);
    expect(p.assetCharacter).toMatch(/smartphone/);
    expect(p.panel).toMatch(/neutral white balance/);
    expect(p.video).toMatch(/smartphone/);
    expect(p.planner).toContain('CASERO');
    // Sin vocabulario de producción profesional: ese es justo el look contrario.
    expect(p.assetLocation).not.toMatch(/full-frame|cinematic/i);
  });

  it('photoreal solo en los perfiles de foto real (ultra_realista y casero)', () => {
    expect(getStyleProfile('ultra_realista').photoreal).toBe(true);
    expect(getStyleProfile('casero').photoreal).toBe(true);
    expect(getStyleProfile('fantasia').photoreal).toBe(false);
    expect(getStyleProfile('animado').photoreal).toBe(false);
    expect(getStyleProfile('custom', 'acuarela suave').photoreal).toBe(false);
  });

  // Bug 2026-07-04: el wrapper de la hoja maestra horneaba luz de ESTUDIO
  // (studio lighting/seamless/sharp focus) para todos los perfiles y peleaba
  // con el bloque smartphone de casero — salía el look pulido de IA. El
  // setting del retrato (luz, fondo, nitidez) ahora viene del perfil.
  it('portraitSetting: casero pide luz natural de ventana, sin estudio ni seamless', () => {
    const s = getStyleProfile('casero').portraitSetting;
    expect(s).toMatch(/natural window light/);
    expect(s).toMatch(/smartphone/);
    expect(s).not.toMatch(/studio lighting|seamless/i);
  });

  it('portraitSetting: ultra_realista conserva el retrato de estudio', () => {
    const s = getStyleProfile('ultra_realista').portraitSetting;
    expect(s).toMatch(/studio lighting/);
    expect(s).toMatch(/seamless background/);
  });

  it('portraitSetting: todos los perfiles lo definen y pasa antislop', () => {
    for (const slug of ['ultra_realista', 'casero', 'fantasia', 'animado'] as const) {
      const s = getStyleProfile(slug).portraitSetting;
      expect(s.length).toBeGreaterThan(10);
      expect(stripSlop(s).removed).toEqual([]);
    }
    expect(getStyleProfile('custom', 'acuarela').portraitSetting.length).toBeGreaterThan(10);
  });

  it('casero.assetCharacter refuerza imperfecciones humanas (anti look-de-IA)', () => {
    const p = getStyleProfile('casero');
    expect(p.assetCharacter).toMatch(/facial asymmetry/);
    expect(p.assetCharacter).toMatch(/no beauty retouching/);
  });
});

describe('plannerStyleBlocks', () => {
  it('sin estilo: solo la física (comportamiento default)', () => {
    expect(plannerStyleBlocks()).toBe(PLANNER_PHYSICS_BLOCK);
    expect(plannerStyleBlocks(null, null)).toBe(PLANNER_PHYSICS_BLOCK);
  });

  it('fantasía: bloque de estilo sin física', () => {
    const s = plannerStyleBlocks('fantasia');
    expect(s).toContain('FANTASÍA');
    expect(s).not.toContain('FÍSICA Y COHERENCIA DEL MUNDO');
  });

  it('custom con texto: estilo del usuario + física', () => {
    const s = plannerStyleBlocks('custom', 'acuarela suave, colores pastel');
    expect(s).toContain('acuarela suave');
    expect(s).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
  });
});
