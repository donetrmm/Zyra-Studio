import { describe, it, expect } from 'vitest';
import { deliveryCueFor, injectDeliveryCue, VOICE_TONE_MAP, VOICE_TONE_LABELS } from './voice-tone';

describe('deliveryCueFor', () => {
  it('override con etiqueta conocida usa el mapeo inglés', () => {
    const cue = deliveryCueFor('cálido', 'ugc', 'una escena');
    expect(cue).toContain('warm, personable');
    expect(cue.endsWith('— ')).toBe(true);
  });
  it('override de texto libre pasa el español dentro del envoltorio inglés', () => {
    const cue = deliveryCueFor('misterioso', 'ugc', 'una escena');
    expect(cue).toContain('misterioso');
    expect(cue.startsWith('Deliver the line in a ')).toBe(true);
  });
  it('vacío + registro enérgico → descriptor upbeat', () => {
    expect(deliveryCueFor('', 'bold kinetic', 'una escena')).toContain('upbeat');
  });
  it('vacío + registro default → warm, lively, expressive', () => {
    expect(deliveryCueFor(null, 'ugc casero', 'una escena')).toContain('warm, lively, expressive');
  });
  it('vacío + emoción alta declarada gana sobre el registro', () => {
    expect(deliveryCueFor('', 'ugc casero', 'she sobs and cries')).toContain('emotionally intense');
  });
});

describe('injectDeliveryCue', () => {
  const cue = 'Deliver the line in a warm tone — ';
  it('prefija el cue justo antes del marcador Dialogue:', () => {
    const out = injectDeliveryCue('She looks at camera. Dialogue: "Por fin."', cue);
    expect(out).toBe('She looks at camera. Deliver the line in a warm tone — Dialogue: "Por fin."');
  });
  it('sin marcador, prefija antes del primer entrecomillado', () => {
    const out = injectDeliveryCue('Voice over: "Se ve increíble."', cue);
    expect(out).toContain('warm tone — "Se ve increíble."');
  });
  it('sin cita, agrega el cue al final', () => {
    const out = injectDeliveryCue('Product close-up, no one speaks.', cue);
    expect(out.endsWith('Deliver the line in a warm tone —')).toBe(true);
  });
  it('soporta comillas curvas en el marcador', () => {
    const out = injectDeliveryCue('She speaks. Dialogue: “Hola.”', cue);
    expect(out).toContain('warm tone — Dialogue: “Hola.”');
  });
});

describe('VOICE_TONE_LABELS', () => {
  it('expone las etiquetas de los chips en español', () => {
    expect(VOICE_TONE_LABELS).toContain('cálido');
    expect(VOICE_TONE_LABELS.length).toBe(Object.keys(VOICE_TONE_MAP).length);
  });
});

// Fase 2 audio (2026-07-13): los tonos calmos ('seguro', 'serio') se enriquecen
// para no salir monótonos — conservan su intención pero llevan calidez/vida.
describe('VOICE_TONE_MAP tonos calmos con vida (Fase 2 audio)', () => {
  it("'seguro' conserva confianza pero suma calidez/vida", () => {
    expect(VOICE_TONE_MAP.seguro).toMatch(/confident/i);
    expect(VOICE_TONE_MAP.seguro).toMatch(/warm|lively/i);
  });
  it("'serio' conserva gravedad pero suma expresividad", () => {
    expect(VOICE_TONE_MAP.serio).toMatch(/serious/i);
    expect(VOICE_TONE_MAP.serio).toMatch(/warm|expressive/i);
  });
});
