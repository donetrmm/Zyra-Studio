import { describe, it, expect } from 'vitest';
import { describeProduct, describeProductScale, ADULT_REF_CM } from './inventory';

describe('describeProduct — objeto vs impreso', () => {
  const base = { name: 'X', palette: ['red'], imagePaths: [] as string[], visualDetails: 'a family party photo' };
  it('con medium describe el OBJETO y separa el impreso', () => {
    const out = describeProduct({ ...base, medium: 'canvas print' });
    expect(out).toContain('Product: a canvas print');
    expect(out).toContain('displays this printed image: a family party photo');
    expect(out).toContain('The product itself is the physical canvas print');
    expect(out).not.toContain('Product: X');
  });
  it('con medium exige el arte impreso sin distorsión', () => {
    const out = describeProduct({ ...base, medium: 'canvas print' });
    expect(out).toContain('undistorted and unstretched');
    expect(out).toContain("preserving the artwork's own proportions");
  });
  it('con imágenes de referencia, el arbitraje declara que la referencia gana a la toma', () => {
    const out = describeProduct({ ...base, medium: 'canvas print', imagePaths: ['ws/p.png'] });
    expect(out).toContain('If the shot description contradicts');
    expect(out).toContain('always win');
  });
  it('con thicknessMm añade la cláusula de grosor', () => {
    const out = describeProduct({ ...base, medium: 'canvas print', thicknessMm: 10 });
    expect(out).toContain('about 10 mm thin at the edge');
    expect(out).toContain('do not render a thick block frame');
  });
  it('SIN medium queda idéntico al comportamiento actual', () => {
    const out = describeProduct({ ...base });
    expect(out).toContain('Product: X');
    expect(out).toContain('brand colors red');
    expect(out).not.toContain('printed image');
  });
});

describe('describeProductScale', () => {
  it('150 cm de alto → llega a los hombros, claramente más bajo que la persona', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150 });
    expect(d).toContain('150 cm tall');
    expect(d).toContain("its top edge reaching an adult's shoulders, clearly shorter than the person");
    expect(d).toContain('keep that size constant in every shot');
    expect(d).toContain('do not exaggerate it into an oversized floor-to-ceiling piece');
    expect(d.startsWith(' ')).toBe(true);
  });

  it('alto y ancho → declara el aspect ratio explícito (150x100 = 1.5x vertical)', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150, widthCm: 100 });
    expect(d).toContain('a vertical rectangle 1.5 times taller than it is wide');
    expect(d).toContain('keep this exact aspect ratio');
  });

  it('más ancho que alto → rectángulo horizontal', () => {
    const d = describeProductScale({ name: 'Banner', imagePaths: [], heightCm: 50, widthCm: 150 });
    expect(d).toContain('a horizontal rectangle 3 times wider than it is tall');
  });

  it('dimensiones casi iguales → cuadrado, sin ratio numérico', () => {
    const d = describeProductScale({ name: 'Cuadro', imagePaths: [], heightCm: 100, widthCm: 98 });
    expect(d).toContain(', a square');
    expect(d).not.toContain('rectangle');
  });

  it('una sola dimensión → sin cláusula de aspect ratio', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150 });
    expect(d).not.toContain('aspect ratio');
  });

  it('objeto chico (10 cm) → cabe en una mano, sin cláusula de carga', () => {
    const d = describeProductScale({ name: 'Bottle', imagePaths: [], heightCm: 10 });
    expect(d).toContain('small enough to hold in one hand');
    expect(d).not.toContain('carries it');
  });

  it('pieza grande (150 cm) → ancla de carga: ambos brazos, de rodillas a hombros', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150 });
    expect(d).toContain('it takes both arms and covers them from knees to shoulders');
    expect(d).toContain('never render it as a small hand-held board');
  });

  it('más alto que una persona (200 cm) → taller than a standing adult', () => {
    const d = describeProductScale({ name: 'Sculpture', imagePaths: [], heightCm: 200 });
    expect(d).toContain('taller than a standing adult');
  });

  it('alto + ancho → cita ambas dimensiones', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150, widthCm: 100 });
    expect(d).toContain('150 cm tall');
    expect(d).toContain('100 cm wide');
  });

  it('sin dimensiones → cadena vacía', () => {
    expect(describeProductScale({ name: 'Service', imagePaths: [] })).toBe('');
  });

  it('producto undefined → cadena vacía', () => {
    expect(describeProductScale(undefined)).toBe('');
  });

  it('ADULT_REF_CM es 170', () => {
    expect(ADULT_REF_CM).toBe(170);
  });
});
