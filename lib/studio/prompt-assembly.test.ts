import { describe, it, expect } from 'vitest';
import { assembleStudioPrompt, PRODUCT_IDENTITY_CLAUSE } from './prompt-assembly';

describe('assembleStudioPrompt', () => {
  it('sin guard devuelve el prompt crudo', () => {
    expect(assembleStudioPrompt('haz la caja azul', { keepIdentical: false, assetType: 'product' })).toBe(
      'haz la caja azul',
    );
  });
  it('guard off por ausencia de flag = prompt crudo', () => {
    expect(assembleStudioPrompt('haz la caja azul', { assetType: 'product' })).toBe('haz la caja azul');
  });
  it('guard on en producto anexa la cláusula de identidad de producto', () => {
    const out = assembleStudioPrompt('cámbiale el fondo', { keepIdentical: true, assetType: 'product' });
    expect(out.startsWith('cámbiale el fondo')).toBe(true);
    expect(out).toContain(PRODUCT_IDENTITY_CLAUSE);
  });
  it('guard on sin assetType conocido (location/character en Fase 2) = prompt crudo', () => {
    // Fase 2 solo tiene cláusula de producto; otros tipos se generalizan en Fase 4.
    expect(assembleStudioPrompt('de noche', { keepIdentical: true, assetType: 'location' })).toBe('de noche');
    expect(assembleStudioPrompt('de noche', { keepIdentical: true, assetType: null })).toBe('de noche');
  });
  it('recorta espacios del prompt crudo antes de anexar', () => {
    const out = assembleStudioPrompt('  cambia el fondo  ', { keepIdentical: true, assetType: 'product' });
    // El brief original comparaba out.startsWith('cambia el fondo ' + CLAUSE.slice(0,4))
    // contra `false`, pero esa concatenación es EXACTAMENTE el prefijo que produce
    // una implementación correcta y recortada (raw + ' ' + clause) — la aserción
    // era una tautología invertida (ver task-1-report.md). Se reemplaza por una
    // que sí verifica el recorte: sin espacios sobrantes al inicio ni antes de la
    // cláusula (un solo espacio de separador).
    expect(out.startsWith('  cambia')).toBe(false); // sin espacios sobrantes al inicio
    expect(out).not.toContain('fondo  Keep'); // sin doble espacio antes de la cláusula
    expect(out).toBe('cambia el fondo ' + PRODUCT_IDENTITY_CLAUSE);
    expect(out).toContain('cambia el fondo');
    expect(out).toContain(PRODUCT_IDENTITY_CLAUSE);
  });
});
