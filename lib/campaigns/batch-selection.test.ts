import { describe, it, expect } from 'vitest';
import { selectBatchItems, SAMPLE_SIZE } from './batch-selection';

// Fila mínima que la selección observa. Helpers para legibilidad.
type Row = { id: string; scene: string | null; sequence_id: string | null; scene_index: number | null };
const loose = (id: string, scene: string | null = id): Row => ({ id, scene, sequence_id: null, scene_index: null });
const seq = (id: string, sequence_id: string, scene_index: number): Row => ({
  id,
  scene: 'misma-escena', // las escenas de una secuencia comparten fragmento
  sequence_id,
  scene_index,
});

describe('selectBatchItems', () => {
  it("'full' devuelve todos, ordenados por scene_index (orden narrativo)", () => {
    const pending = [seq('c', 's1', 2), seq('a', 's1', 0), seq('b', 's1', 1)];
    const out = selectBatchItems(pending, 'full');
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it("'sample' sobre sueltos: 2 con escenas distintas", () => {
    const pending = [loose('a', 'cocina'), loose('b', 'calle'), loose('c', 'estudio')];
    const out = selectBatchItems(pending, 'sample');
    expect(out).toHaveLength(SAMPLE_SIZE);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it("'sample' con escenas repetidas: completa hasta SAMPLE_SIZE con los primeros", () => {
    const pending = [loose('a', 'misma'), loose('b', 'misma'), loose('c', 'misma')];
    const out = selectBatchItems(pending, 'sample');
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it("grupo SOLO-secuencia: 'sample' cae a la secuencia COMPLETA y en orden, no un subconjunto", () => {
    const pending = [seq('s2', 'seq', 1), seq('s1', 'seq', 0), seq('s3', 'seq', 2), seq('s4', 'seq', 3)];
    const out = selectBatchItems(pending, 'sample');
    // nunca recorta a 2: la historia no se parte
    expect(out).toHaveLength(4);
    expect(out.map((i) => i.id)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('grupo mixto: la muestra toca SOLO los sueltos, la secuencia queda intacta', () => {
    const pending = [
      seq('s1', 'seq', 0),
      seq('s2', 'seq', 1),
      loose('x', 'cocina'),
      loose('y', 'calle'),
      loose('z', 'estudio'),
    ];
    const out = selectBatchItems(pending, 'sample');
    expect(out).toHaveLength(SAMPLE_SIZE);
    expect(out.every((i) => i.sequence_id == null)).toBe(true);
    expect(out.map((i) => i.id)).toEqual(['x', 'y']);
  });

  it("'sample' sin pendientes devuelve vacío", () => {
    expect(selectBatchItems([], 'sample')).toEqual([]);
  });
});
