import { describe, it, expect } from 'vitest';
import { describeProductScale, ADULT_REF_CM } from './inventory';

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
