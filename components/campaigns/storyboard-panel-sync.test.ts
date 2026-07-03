import { describe, it, expect } from 'vitest';
import {
  samePanelAsset,
  stabilizePanelUrls,
  reconcilePanelStates,
  clearLinkedOverlays,
  type PanelState,
} from './storyboard-panel-sync';

const SIGNED_A_T1 = 'https://x.supabase.co/storage/v1/object/sign/references/ws/img-a.jpg?token=aaa';
const SIGNED_A_T2 = 'https://x.supabase.co/storage/v1/object/sign/references/ws/img-a.jpg?token=bbb';
const SIGNED_B = 'https://x.supabase.co/storage/v1/object/sign/references/ws/img-b.jpg?token=ccc';

describe('samePanelAsset', () => {
  it.each([
    { a: null, b: null, expected: true },
    { a: SIGNED_A_T1, b: null, expected: false },
    { a: null, b: SIGNED_A_T1, expected: false },
    { a: SIGNED_A_T1, b: SIGNED_A_T2, expected: true },
    { a: SIGNED_A_T1, b: SIGNED_B, expected: false },
    { a: 'no-es-url', b: 'no-es-url', expected: true },
    { a: 'no-es-url', b: 'otra-cosa', expected: false },
  ])('compara $a vs $b -> $expected', ({ a, b, expected }) => {
    expect(samePanelAsset(a, b)).toBe(expected);
  });
});

describe('stabilizePanelUrls', () => {
  it('re-firma del mismo asset conserva la URL previa (src estable, sin re-fetch)', () => {
    const prev = [{ id: 'b1', panelUrl: SIGNED_A_T1 }];
    const next = [{ id: 'b1', panelUrl: SIGNED_A_T2 }];
    const out = stabilizePanelUrls(prev, next);
    expect(out[0].panelUrl).toBe(SIGNED_A_T1);
  });

  it('asset distinto adopta la URL nueva', () => {
    const prev = [{ id: 'b1', panelUrl: SIGNED_A_T1 }];
    const next = [{ id: 'b1', panelUrl: SIGNED_B }];
    const out = stabilizePanelUrls(prev, next);
    expect(out[0].panelUrl).toBe(SIGNED_B);
  });

  it('beat nuevo (sin previo) pasa tal cual', () => {
    const next = [{ id: 'b2', panelUrl: SIGNED_B }];
    const out = stabilizePanelUrls([], next);
    expect(out[0].panelUrl).toBe(SIGNED_B);
  });

  it('conserva el resto de los campos del beat nuevo', () => {
    const prev = [{ id: 'b1', panelUrl: SIGNED_A_T1, extra: 'viejo' }];
    const next = [{ id: 'b1', panelUrl: SIGNED_A_T2, extra: 'nuevo' }];
    const out = stabilizePanelUrls(prev, next);
    expect(out[0].extra).toBe('nuevo');
    expect(out[0].panelUrl).toBe(SIGNED_A_T1);
  });
});

describe('reconcilePanelStates', () => {
  const beat = (id: string, panelUrl: string | null, genId: string | null = null) => ({
    id,
    panelUrl,
    storyboardGenerationId: genId,
  });

  it('crea la entrada faltante como idle', () => {
    const out = reconcilePanelStates({}, [beat('b1', SIGNED_A_T1)], {});
    expect(out).toEqual({ b1: { status: 'idle', panelUrl: SIGNED_A_T1 } });
  });

  it('idle con la misma URL -> sin cambios (null)', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'idle', panelUrl: SIGNED_A_T1 } };
    expect(reconcilePanelStates(prev, [beat('b1', SIGNED_A_T1)], {})).toBeNull();
  });

  it('idle con asset nuevo -> actualiza la URL', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'idle', panelUrl: SIGNED_A_T1 } };
    const out = reconcilePanelStates(prev, [beat('b1', SIGNED_B)], {});
    expect(out).toEqual({ b1: { status: 'idle', panelUrl: SIGNED_B } });
  });

  it('generating + beat enlazado a una gen completada -> flip a idle con la URL nueva', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'generating' } };
    const out = reconcilePanelStates(prev, [beat('b1', SIGNED_B, 'gen-9')], { b1: ['gen-9'] });
    expect(out).toEqual({ b1: { status: 'idle', panelUrl: SIGNED_B } });
  });

  it('generating + beat aun enlazado a la gen VIEJA -> sigue generando (sin cambios)', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'generating' } };
    expect(reconcilePanelStates(prev, [beat('b1', SIGNED_A_T1, 'gen-vieja')], { b1: ['gen-9'] })).toBeNull();
  });

  it('generating sin gens completadas registradas -> sin cambios', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'generating' } };
    expect(reconcilePanelStates(prev, [beat('b1', SIGNED_A_T1, 'gen-1')], {})).toBeNull();
  });

  it('error no se pisa aunque la URL cambie', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'error', message: 'fallo' } };
    expect(reconcilePanelStates(prev, [beat('b1', SIGNED_B)], {})).toBeNull();
  });

  it('lote de variantes: el flip acepta CUALQUIER id completado del intento', () => {
    const prev: Record<string, PanelState> = { b1: { status: 'generating' } };
    const out = reconcilePanelStates(prev, [beat('b1', SIGNED_B, 'gen-2')], { b1: ['gen-1', 'gen-2', 'gen-3'] });
    expect(out).toEqual({ b1: { status: 'idle', panelUrl: SIGNED_B } });
  });
});

describe('clearLinkedOverlays', () => {
  const beat = (id: string, genId: string | null) => ({
    id,
    panelUrl: SIGNED_B,
    storyboardGenerationId: genId,
  });

  it('overlay de refinado se limpia cuando el beat quedo enlazado a la gen completada', () => {
    const out = clearLinkedOverlays({ b1: true }, [beat('b1', 'gen-9')], { b1: ['gen-9'] });
    expect(out).toEqual({});
  });

  it('overlay queda si el beat sigue enlazado a la gen vieja', () => {
    expect(clearLinkedOverlays({ b1: true }, [beat('b1', 'gen-vieja')], { b1: ['gen-9'] })).toBeNull();
  });

  it('sin overlays activos -> sin cambios (null)', () => {
    expect(clearLinkedOverlays({}, [beat('b1', 'gen-9')], { b1: ['gen-9'] })).toBeNull();
  });
});
