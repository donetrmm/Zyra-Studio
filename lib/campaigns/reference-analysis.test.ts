import { describe, it, expect } from 'vitest';
import { parseAnalysisReply } from './reference-analysis';

const paths = ['p/1.jpg', 'p/2.jpg'];

describe('parseAnalysisReply — respuesta de visión a propuesta validada', () => {
  it('mapea usos por índice 1-based a paths y filtra el brief a campos presentes', () => {
    const out = parseAnalysisReply(
      {
        images: [
          { index: 1, usage: 'frontal view of the printed artwork' },
          { index: 2, usage: 'edge profile, ~18mm thin' },
        ],
        medium: 'canvas print',
        thicknessMm: 18,
        visualDetails: 'sunset artwork with warm palette',
      },
      paths,
    );
    expect(out.usages).toEqual([
      { path: 'p/1.jpg', usage: 'frontal view of the printed artwork' },
      { path: 'p/2.jpg', usage: 'edge profile, ~18mm thin' },
    ]);
    expect(out.brief).toEqual({
      medium: 'canvas print',
      thicknessMm: 18,
      visualDetails: 'sunset artwork with warm palette',
    });
  });

  it('índices fuera de rango o usos vacíos se descartan; brief nulo queda vacío', () => {
    const out = parseAnalysisReply(
      {
        images: [
          { index: 0, usage: 'inválido' },
          { index: 3, usage: 'fuera de rango' },
          { index: 1, usage: '   ' },
        ],
        medium: null,
        thicknessMm: null,
        visualDetails: null,
      },
      paths,
    );
    expect(out.usages).toEqual([]);
    expect(out.brief).toEqual({});
  });

  it('respuesta malformada lanza (el caller lo convierte en error de acción)', () => {
    expect(() => parseAnalysisReply('basura', paths)).toThrow();
    expect(() => parseAnalysisReply({ images: 'no-array' }, paths)).toThrow();
  });

  it('thicknessMm no numérico o absurdo se descarta sin tirar el resto', () => {
    const out = parseAnalysisReply(
      { images: [{ index: 1, usage: 'frontal' }], thicknessMm: 9999, medium: 'canvas print' },
      paths,
    );
    expect(out.brief.thicknessMm).toBeUndefined();
    expect(out.brief.medium).toBe('canvas print');
    expect(out.usages).toHaveLength(1);
  });
});
