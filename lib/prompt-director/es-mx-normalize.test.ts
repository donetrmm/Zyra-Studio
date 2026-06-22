import { describe, it, expect } from 'vitest';
import {
  numberToWordsEsMx,
  normalizeSpokenEsMx,
  normalizeSpokenInDialogue,
} from './es-mx-normalize';

describe('numberToWordsEsMx', () => {
  it.each([
    { n: 0, expected: 'cero' },
    { n: 1, expected: 'uno' },
    { n: 2, expected: 'dos' },
    { n: 6, expected: 'seis' },
    { n: 15, expected: 'quince' },
    { n: 16, expected: 'dieciséis' },
    { n: 20, expected: 'veinte' },
    { n: 21, expected: 'veintiuno' },
    { n: 22, expected: 'veintidós' },
    { n: 30, expected: 'treinta' },
    { n: 31, expected: 'treinta y uno' },
    { n: 45, expected: 'cuarenta y cinco' },
    { n: 99, expected: 'noventa y nueve' },
    { n: 100, expected: 'cien' },
    { n: 101, expected: 'ciento uno' },
    { n: 199, expected: 'ciento noventa y nueve' },
    { n: 200, expected: 'doscientos' },
    { n: 499, expected: 'cuatrocientos noventa y nueve' },
    { n: 500, expected: 'quinientos' },
    { n: 999, expected: 'novecientos noventa y nueve' },
    { n: 1000, expected: 'mil' },
    { n: 1299, expected: 'mil doscientos noventa y nueve' },
    { n: 2000, expected: 'dos mil' },
    { n: 21000, expected: 'veintiún mil' },
    { n: 100000, expected: 'cien mil' },
    { n: 1000000, expected: 'un millón' },
    { n: 2000000, expected: 'dos millones' },
  ])('convierte $n -> $expected', ({ n, expected }) => {
    expect(numberToWordsEsMx(n)).toBe(expected);
  });

  it.each([
    { n: 1, expected: 'un' },
    { n: 21, expected: 'veintiún' },
    { n: 31, expected: 'treinta y un' },
    { n: 100, expected: 'cien' },
    { n: 401, expected: 'cuatrocientos un' },
    { n: 499, expected: 'cuatrocientos noventa y nueve' },
  ])('apocopa el uno final cuando apocope=true ($n -> $expected)', ({ n, expected }) => {
    expect(numberToWordsEsMx(n, { apocope: true })).toBe(expected);
  });
});

describe('normalizeSpokenEsMx', () => {
  describe('moneda', () => {
    it.each([
      { input: '$499', expected: 'cuatrocientos noventa y nueve pesos' },
      { input: '$1,299', expected: 'mil doscientos noventa y nueve pesos' },
      { input: '$1', expected: 'un peso' },
      { input: '$21', expected: 'veintiún pesos' },
      { input: '$100', expected: 'cien pesos' },
      { input: '$9.99', expected: 'nueve pesos con noventa y nueve centavos' },
      { input: '$1.50', expected: 'un peso con cincuenta centavos' },
      { input: '$5.00', expected: 'cinco pesos' },
      { input: '$5.01', expected: 'cinco pesos con un centavo' },
      { input: '$0.99', expected: 'noventa y nueve centavos' },
    ])('expande $input', ({ input, expected }) => {
      expect(normalizeSpokenEsMx(input)).toBe(expected);
    });
  });

  describe('porcentaje, ratio y 24/7', () => {
    it.each([
      { input: '50%', expected: 'cincuenta por ciento' },
      { input: '100%', expected: 'cien por ciento' },
      { input: '2x1', expected: 'dos por uno' },
      { input: '3x2', expected: 'tres por dos' },
      { input: '24/7', expected: 'veinticuatro siete' },
    ])('expande $input', ({ input, expected }) => {
      expect(normalizeSpokenEsMx(input)).toBe(expected);
    });
  });

  describe('unidades', () => {
    it.each([
      { input: '3km', expected: 'tres kilómetros' },
      { input: '1km', expected: 'un kilómetro' },
      { input: '5kg', expected: 'cinco kilos' },
      { input: '500g', expected: 'quinientos gramos' },
      { input: '2L', expected: 'dos litros' },
      { input: '30cm', expected: 'treinta centímetros' },
      { input: '100ml', expected: 'cien mililitros' },
    ])('expande $input', ({ input, expected }) => {
      expect(normalizeSpokenEsMx(input)).toBe(expected);
    });
  });

  describe('abreviaturas', () => {
    it.each([
      { input: 'Dr. López', expected: 'doctor López' },
      { input: 'Dra. Ruiz', expected: 'doctora Ruiz' },
      { input: 'Sr. Pérez', expected: 'señor Pérez' },
      { input: 'Sra. Díaz', expected: 'señora Díaz' },
      { input: 'Srta. Mora', expected: 'señorita Mora' },
    ])('expande $input', ({ input, expected }) => {
      expect(normalizeSpokenEsMx(input)).toBe(expected);
    });
  });

  it('expande varios tokens en una misma frase', () => {
    expect(normalizeSpokenEsMx('Aprovecha el 2x1 por solo $499.')).toBe(
      'Aprovecha el dos por uno por solo cuatrocientos noventa y nueve pesos.',
    );
  });

  describe('no toca tokens que no son habla (andamiaje del prompt)', () => {
    it.each([
      { input: '9:16' },
      { input: '3:4' },
      { input: '480p' },
      { input: '720p' },
      { input: '@image1' },
      { input: '@video2' },
      { input: '0-3s: she walks toward the sofa' },
      { input: 'tengo 5 ideas' },
    ])('deja $input intacto', ({ input }) => {
      expect(normalizeSpokenEsMx(input)).toBe(input);
    });
  });
});

describe('normalizeSpokenInDialogue', () => {
  it('normaliza solo dentro de las comillas, no la acción visual', () => {
    const input = 'A sign with $499 on it. Dialogue: "Cuesta $499 hoy."';
    expect(normalizeSpokenInDialogue(input)).toBe(
      'A sign with $499 on it. Dialogue: "Cuesta cuatrocientos noventa y nueve pesos hoy."',
    );
  });

  it('normaliza todos los segmentos entrecomillados de un timeline multi-beat', () => {
    const input = '0-3s: she enters. "Solo por hoy, 2x1." 3-6s: she smiles. "Ahorra 50%."';
    expect(normalizeSpokenInDialogue(input)).toBe(
      '0-3s: she enters. "Solo por hoy, dos por uno." 3-6s: she smiles. "Ahorra cincuenta por ciento."',
    );
  });

  it('soporta comillas curvas', () => {
    expect(normalizeSpokenInDialogue('Dialogue: “Llévate 3km de cobertura.”')).toBe(
      'Dialogue: “Llévate tres kilómetros de cobertura.”',
    );
  });

  it('no cambia un prompt sin diálogo entrecomillado', () => {
    const input = 'medium shot, dolly in to close-up, 9:16, 480p, @image1 is the product.';
    expect(normalizeSpokenInDialogue(input)).toBe(input);
  });
});
