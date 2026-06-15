import { describe, it, expect } from 'vitest';
import { genErrorFromResult, isRetryable, type GenFailure } from './generation-error';

// Representa la respuesta `ok:false` de submitGenerationAction.
const fail = (error: string, message?: string): GenFailure => ({ ok: false, error, message });

describe('genErrorFromResult (submitGenerationAction → ok:false)', () => {
  it('safety: kind safety, créditos devueltos = costo', () => {
    const e = genErrorFromResult(fail('safety', 'rechazado'), 90);
    expect(e.kind).toBe('safety');
    expect(e.refunded).toBe(90);
    expect(isRetryable(e)).toBe(false); // reformular, no reintentar igual
  });

  it('insufficient_credits: kind credits, refunded 0 (no se cobró), no reintenta', () => {
    const e = genErrorFromResult(fail('insufficient_credits'), 90);
    expect(e.kind).toBe('credits');
    expect(e.refunded).toBe(0);
    expect(e.message).toMatch(/saldo|créditos/i);
    expect(isRetryable(e)).toBe(false);
  });

  it('validation_error: genérico, reintentable, refund = costo', () => {
    const e = genErrorFromResult(fail('validation_error'), 40);
    expect(e.kind).toBe('generic');
    expect(e.refunded).toBe(40);
    expect(e.message).toMatch(/inválid/i);
    expect(isRetryable(e)).toBe(true);
  });

  it('error de servidor/red: genérico, usa el message del servidor si viene', () => {
    const e = genErrorFromResult(fail('server', 'ModelArk 503'), 100);
    expect(e.kind).toBe('generic');
    expect(e.message).toBe('ModelArk 503');
    expect(e.refunded).toBe(100);
    expect(isRetryable(e)).toBe(true);
  });

  it('error genérico sin message: cae al texto por defecto reintentable', () => {
    const e = genErrorFromResult(fail('unknown'), 100);
    expect(e.kind).toBe('generic');
    expect(e.message).toMatch(/Reintenta/i);
  });

  it('isRetryable solo es true para genéricos', () => {
    expect(isRetryable({ kind: 'generic', message: 'x', refunded: 0 })).toBe(true);
    expect(isRetryable({ kind: 'safety', message: 'x', refunded: 0 })).toBe(false);
    expect(isRetryable({ kind: 'credits', message: 'x', refunded: 0 })).toBe(false);
  });
});
