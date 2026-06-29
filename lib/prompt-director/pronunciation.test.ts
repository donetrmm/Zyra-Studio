import { describe, it, expect } from 'vitest';
import { applyRespellings, PRONUNCIATION_RESPELLINGS } from './pronunciation';

describe('applyRespellings', () => {
  it('respela las palabras confirmadas con la tónica marcada', () => {
    expect(applyRespellings('nunca le había regalado una')).toContain('regaládo');
    expect(applyRespellings('una foto que nunca imprimiste')).toContain('imprimíste');
  });

  it('preserva la mayúscula inicial', () => {
    expect(applyRespellings('Regalado algo nuevo')).toContain('Regaládo');
  });

  it('solo toca palabras completas (word boundary)', () => {
    // No debe respelar dentro de otra palabra.
    expect(applyRespellings('reregaladoxx')).toBe('reregaladoxx');
  });

  it('es idempotente: la forma ya respelada no se vuelve a tocar', () => {
    const once = applyRespellings('regalado');
    expect(applyRespellings(once)).toBe(once);
  });

  it('no cambia texto sin palabras del mapa', () => {
    expect(applyRespellings('she walks toward the sofa')).toBe('she walks toward the sofa');
  });

  it('respela la marca Prolienzo a la tónica correcta (pro-LIEN-zo), preservando la mayúscula', () => {
    const out = applyRespellings('Te traje un Prolienzo nuevo');
    expect(out).toContain('Proliénzo');
    expect(out).not.toContain('Prólienzo');
  });

  it('corrige también la forma ya mal acentuada que emite el planner ("Prólienzo")', () => {
    const out = applyRespellings('Un cuadro de Prólienzo. Sus mejores momentos.');
    expect(out).toContain('Proliénzo');
    expect(out).not.toContain('Prólienzo');
  });

  it('respela Contactanos con la tónica esdrújula, preservando la mayúscula', () => {
    expect(applyRespellings('Contactanos hoy mismo')).toContain('Contáctanos');
    expect(applyRespellings('ya contactanos')).toContain('contáctanos');
  });

  it('incluye las palabras confirmadas y la marca', () => {
    expect(PRONUNCIATION_RESPELLINGS.imprimiste).toBe('imprimíste');
    expect(PRONUNCIATION_RESPELLINGS.regalado).toBe('regaládo');
    expect(PRONUNCIATION_RESPELLINGS.prolienzo).toBe('proliénzo');
    expect(PRONUNCIATION_RESPELLINGS['prólienzo']).toBe('proliénzo');
    expect(PRONUNCIATION_RESPELLINGS.contactanos).toBe('contáctanos');
  });
});
