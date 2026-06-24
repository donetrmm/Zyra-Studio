import { describe, it, expect } from 'vitest';
import { validate } from './validators';
import type { CompileRequest, DirectorContext } from './types';

const ctx: DirectorContext = {};
function warnings(scenePrompt: string, durationS?: number): string[] {
  return validate({ modelSlug: 'seedance-2', scenePrompt, durationS } as CompileRequest, ctx).warnings;
}

describe('validators P14 — actuación sin desglosar', () => {
  it('avisa cuando hay un verbo abstracto sin micro-acciones', () => {
    expect(warnings('a person dances in the street').some((w) => w.startsWith('actuación:'))).toBe(true);
  });
  it('no avisa cuando la acción ya está desglosada', () => {
    const w = warnings('a person dances: two head nods, a shoulder roll, a knee bend');
    expect(w.some((x) => x.startsWith('actuación:'))).toBe(false);
  });
});

describe('validators P21 — cámara por tramo', () => {
  it('avisa con 2 movimientos en el mismo tramo', () => {
    const w = warnings('0-3s: dolly in and pan left as she enters. 3-6s: static close-up of the can.', 6);
    expect(w.some((x) => x.startsWith('cámara: el tramo'))).toBe(true);
  });
  it('no avisa con un movimiento por tramo aunque haya varios en total', () => {
    const w = warnings('0-3s: dolly in on her face. 3-6s: pan to the can. 6-9s: tilt up to the sign.', 9);
    expect(w.some((x) => x.startsWith('cámara: el tramo'))).toBe(false);
  });
});

describe('validators P14b — sobre-mecánica', () => {
  it('avisa cuando la acción se describe por mecánica articular', () => {
    const w = warnings('she twists the cap counterclockwise while the left hand stabilizes the bottle');
    expect(w.some((x) => x.startsWith('actuación: sobre-mecánica'))).toBe(true);
  });
  it('no avisa cuando la acción va por intención y resultado', () => {
    const w = warnings('she uncaps the bottle and sets it on the table, then nods');
    expect(w.some((x) => x.startsWith('actuación: sobre-mecánica'))).toBe(false);
  });
});

describe('validators P12 — estructura por tramo', () => {
  it('avisa cuando un tramo multi-beat no nombra plano ni movimiento', () => {
    const w = warnings('0-3s: wide shot, she enters. 3-6s: she takes a sip and nods.', 6);
    expect(w.some((x) => x.startsWith('cámara: tramo'))).toBe(true);
  });
  it('no avisa cuando cada tramo nombra plano o movimiento', () => {
    const w = warnings('0-3s: wide shot, she enters. 3-6s: close-up as she sips.', 6);
    expect(w.some((x) => x.startsWith('cámara: tramo'))).toBe(false);
  });
});
