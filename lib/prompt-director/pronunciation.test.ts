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

  it('el mapa arranca con las dos confirmadas', () => {
    expect(PRONUNCIATION_RESPELLINGS.imprimiste).toBe('imprimíste');
    expect(PRONUNCIATION_RESPELLINGS.regalado).toBe('regaládo');
  });
});
