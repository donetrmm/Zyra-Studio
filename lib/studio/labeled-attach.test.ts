// lib/studio/labeled-attach.test.ts
//
// planLabeledAttach decide, a partir de la selección del diálogo (elegir un
// outfit/estado existente vs. teclear una etiqueta nueva), si el adjuntar es un
// "crear" (etiqueta nueva) o un "reemplazar" (id existente), y valida la
// etiqueta antes de tocar la BD. Un bug acá = crear una fila sin etiqueta o
// reemplazar la imagen equivocada. Se cubre cada rama.
import { describe, it, expect } from 'vitest';
import { planLabeledAttach } from '@/lib/studio/labeled-attach';

describe('planLabeledAttach — existente (reemplazar)', () => {
  it('con id → update', () => {
    const plan = planLabeledAttach({ type: 'existing', id: 'outfit-1' });
    expect(plan).toEqual({ kind: 'update', id: 'outfit-1' });
  });

  it('sin id (cadena vacía) → error, no update', () => {
    const plan = planLabeledAttach({ type: 'existing', id: '' });
    expect('error' in plan).toBe(true);
    if (!('error' in plan)) throw new Error('esperaba error');
    expect(plan.error.length).toBeGreaterThan(0);
  });
});

describe('planLabeledAttach — nueva (crear)', () => {
  it('etiqueta válida → create con la etiqueta trimmeada', () => {
    const plan = planLabeledAttach({ type: 'new', label: '  Look casual  ' });
    expect(plan).toEqual({ kind: 'create', label: 'Look casual' });
  });

  it('etiqueta vacía o solo espacios → error, no create', () => {
    const plan = planLabeledAttach({ type: 'new', label: '   ' });
    expect('error' in plan).toBe(true);
    if (!('error' in plan)) throw new Error('esperaba error');
    expect(plan.error.length).toBeGreaterThan(0);
  });

  it('etiqueta de más de 40 caracteres → error (espeja el cap del schema)', () => {
    const plan = planLabeledAttach({ type: 'new', label: 'x'.repeat(41) });
    expect('error' in plan).toBe(true);
    if (!('error' in plan)) throw new Error('esperaba error');
    expect(plan.error.length).toBeGreaterThan(0);
  });

  it('etiqueta de exactamente 40 caracteres → create (límite inclusivo)', () => {
    const label = 'x'.repeat(40);
    const plan = planLabeledAttach({ type: 'new', label });
    expect(plan).toEqual({ kind: 'create', label });
  });
});
