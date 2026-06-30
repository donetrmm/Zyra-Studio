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
  it('150 cm de alto → proporción shoulder-to-head de un adulto', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150 });
    expect(d).toContain('150 cm tall');
    expect(d).toContain('nearly shoulder-to-head height of a standing adult');
    expect(d).toContain('keep that size constant in every shot');
    expect(d.startsWith(' ')).toBe(true);
  });

  it('objeto chico (10 cm) → cabe en una mano', () => {
    const d = describeProductScale({ name: 'Bottle', imagePaths: [], heightCm: 10 });
    expect(d).toContain('small enough to hold in one hand');
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
