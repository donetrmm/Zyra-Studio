import { describe, it, expect } from 'vitest';
import { beatNamesCast, buildCastR2VRefs, STORYBOARD_EDIT_HANDLES } from './storyboard-video';

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
