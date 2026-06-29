import { describe, it, expect } from 'vitest';
import {
  beatNamesCast,
  buildCastR2VRefs,
  STORYBOARD_EDIT_HANDLES,
  STORYBOARD_SCENE_CONTINUITY,
} from './storyboard-video';

describe('buildCastR2VRefs', () => {
  it('orden cast → producto → panel, con citas de producto y panel', () => {
    const { referenceImagePaths, extraCitation } = buildCastR2VRefs(
      ['cast-a.png', 'cast-b.png'],
      ['prod.png'],
      'panel.png',
    );
    expect(referenceImagePaths).toEqual(['cast-a.png', 'cast-b.png', 'prod.png', 'panel.png']);
    // cast = @image1..2 (los cita el compiler); producto = @image3; panel = @image4.
    expect(extraCitation).toContain('@image3');
    expect(extraCitation).toContain('the product');
    expect(extraCitation).toContain('@image4');
    expect(extraCitation).toContain('exact opening frame');
    // Condicional a visibilidad: no fuerza el impreso a cámara (tomas de reacción).
    expect(extraCitation).toContain('whenever the product is visible');
    expect(extraCitation).toContain('turned away');
    expect(extraCitation).not.toContain('throughout the shot');
    // Continuidad de escena: el cross-cut se queda en la misma locación, nunca al
    // fondo de la hoja maestra del personaje.
    expect(extraCitation).toContain('for the entire clip');
    expect(extraCitation).toContain('every cut stays inside this scene');
    expect(extraCitation).toContain('never place the people on the background of their character reference');
  });

  it('sin producto, el panel queda justo después del cast', () => {
    const { referenceImagePaths, extraCitation } = buildCastR2VRefs(['cast-a.png'], [], 'panel.png');
    expect(referenceImagePaths).toEqual(['cast-a.png', 'panel.png']);
    expect(extraCitation).toContain('@image2');
    expect(extraCitation).not.toContain('the product');
  });

  it('varias imágenes de producto numeran correctamente', () => {
    const { referenceImagePaths, extraCitation } = buildCastR2VRefs(
      ['cast-a.png'],
      ['p1.png', 'p2.png'],
      'panel.png',
    );
    expect(referenceImagePaths).toEqual(['cast-a.png', 'p1.png', 'p2.png', 'panel.png']);
    expect(extraCitation).toContain('@image2 and @image3');
    expect(extraCitation).toContain('@image4'); // panel
  });

  it('con audioRef: referenceAudioPaths = [audioRef] y cita @audio1', () => {
    const { referenceAudioPaths, extraCitation } = buildCastR2VRefs(
      ['cast-a.png'],
      ['prod.png'],
      'panel.png',
      'music.mp3',
    );
    expect(referenceAudioPaths).toEqual(['music.mp3']);
    expect(extraCitation).toContain('@audio1');
    expect(extraCitation).toContain('sync scene energy to its beats');
  });

  it('sin audioRef: referenceAudioPaths vacío y sin cita @audio1', () => {
    const { referenceAudioPaths, extraCitation } = buildCastR2VRefs(['cast-a.png'], [], 'panel.png');
    expect(referenceAudioPaths).toEqual([]);
    expect(extraCitation).not.toContain('@audio1');
  });
});

describe('beatNamesCast', () => {
  it('detecta el nombre del personaje en la toma (actúa)', () => {
    expect(beatNamesCast('Medium close-up — Marcela lifts the canvas', ['Marcela', 'Juanita'])).toBe(true);
  });

  it('un close-up de producto que no nombra al cast → false', () => {
    expect(
      beatNamesCast('Tight product close-up — the canvas featuring a family portrait', ['Marcela', 'Juanita']),
    ).toBe(false);
  });

  it('matchea cualquier token significativo de un nombre compuesto', () => {
    expect(beatNamesCast('Ana García waves to camera', ['Ana García'])).toBe(true);
    expect(beatNamesCast('she waves to camera', ['Ana García'])).toBe(false);
  });

  it('no hace falso positivo con substrings (word boundary)', () => {
    expect(beatNamesCast('a banana on the table', ['Ana'])).toBe(false);
  });
});

describe('STORYBOARD_EDIT_HANDLES', () => {
  it('pide puntos de corte limpios de entrada y salida', () => {
    expect(STORYBOARD_EDIT_HANDLES).toContain('in and out points');
    expect(STORYBOARD_EDIT_HANDLES.startsWith(' ')).toBe(true);
  });
});

describe('STORYBOARD_SCENE_CONTINUITY', () => {
  it('fija la locación en todo el clip y prohíbe el fondo de la hoja maestra en los cross-cuts', () => {
    expect(STORYBOARD_SCENE_CONTINUITY).toContain('for the entire clip');
    expect(STORYBOARD_SCENE_CONTINUITY).toContain('cross-cuts');
    expect(STORYBOARD_SCENE_CONTINUITY).toContain('every cut stays inside this scene');
    expect(STORYBOARD_SCENE_CONTINUITY).toContain(
      'never place the people on the background of their character reference',
    );
    expect(STORYBOARD_SCENE_CONTINUITY).toContain('identity only');
    // No prohíbe el cross-cutting en sí (el usuario lo quiere); solo lo confina a la escena.
    expect(STORYBOARD_SCENE_CONTINUITY).not.toMatch(/no cross-cut|single continuous shot|one uninterrupted/i);
    expect(STORYBOARD_SCENE_CONTINUITY.startsWith(' ')).toBe(true);
  });
});
