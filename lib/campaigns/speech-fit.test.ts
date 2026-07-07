import { describe, it, expect } from 'vitest';
import {
  extractDialogue,
  replaceDialogue,
  countWords,
  estimateSpeechSeconds,
  fitVerdict,
  WPS,
  DUR_MIN,
  DUR_MAX,
} from './speech-fit';

describe('extractDialogue', () => {
  it('lee el contenido de Dialogue: "..."', () => {
    expect(extractDialogue('Medium shot — ella sonríe. Dialogue: "Hola a todos"')).toBe('Hola a todos');
  });
  it('soporta comillas curvas', () => {
    expect(extractDialogue('Acción. Dialogue: “Hola”')).toBe('Hola');
  });
  it('cae al primer entrecomillado si no hay marcador', () => {
    expect(extractDialogue('Ella dice "buenos días" a cámara')).toBe('buenos días');
  });
  it('devuelve vacío si no hay diálogo', () => {
    expect(extractDialogue('Medium shot, producto sobre la mesa')).toBe('');
  });
});

describe('replaceDialogue', () => {
  const base = 'Medium shot — ella gesticula hacia el cuadro. Dialogue: "Texto viejo"';
  it('reemplaza el diálogo conservando la acción (round-trip)', () => {
    const out = replaceDialogue(base, 'Texto nuevo');
    expect(extractDialogue(out)).toBe('Texto nuevo');
    expect(out).toContain('ella gesticula hacia el cuadro');
  });
  it('no duplica el marcador Dialogue:', () => {
    const out = replaceDialogue(base, 'Otro');
    expect(out.match(/dialogue\s*:/gi)?.length ?? 0).toBe(1);
  });
  it('quita el diálogo cuando el nuevo es vacío, dejando la acción', () => {
    const out = replaceDialogue(base, '   ');
    expect(extractDialogue(out)).toBe('');
    expect(out).toContain('ella gesticula hacia el cuadro');
  });
  it('agrega Dialogue: cuando no existía', () => {
    const out = replaceDialogue('Medium shot, producto sobre la mesa', 'Nuevo');
    expect(extractDialogue(out)).toBe('Nuevo');
  });
});

describe('countWords', () => {
  it('cuenta palabras separadas por espacios', () => {
    expect(countWords('Mi familia vive en otro estado y casi no los veo')).toBe(11);
  });
  it('cero en vacío', () => {
    expect(countWords('   ')).toBe(0);
  });
});

describe('estimateSpeechSeconds', () => {
  it('usa WPS por idioma', () => {
    expect(estimateSpeechSeconds('uno dos tres cuatro cinco seis siete ocho nueve diez', 'es')).toBeCloseTo(10 / WPS.es);
  });
});

// Calibración al ritmo REAL de entrega de Seedance (guías de comunidad 2026:
// ~12 palabras caben en 10s y ~20 en 15s — mucho más lento que la conversación
// humana). Con el WPS viejo (2.5 es) el planner dejaba pasar el doble de
// palabras y el habla salía atropellada.
describe('calibración Seedance del ritmo de habla', () => {
  it('12 palabras en inglés piden ~10s de clip (comunidad: 12 palabras/10s)', () => {
    const needed = estimateSpeechSeconds(
      'one two three four five six seven eight nine ten eleven twelve',
      'en',
    );
    expect(fitVerdict(needed, 10).level).not.toBe('tight');
    expect(fitVerdict(needed, 4).suggestedDurationS).toBeGreaterThanOrEqual(9);
    expect(fitVerdict(needed, 4).suggestedDurationS).toBeLessThanOrEqual(11);
  });
  it('20 palabras en inglés llenan el clip máximo (comunidad: 20 palabras/15s)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    const needed = estimateSpeechSeconds(twenty, 'en');
    expect(fitVerdict(needed, 15).level).not.toBe('tight');
    expect(fitVerdict(needed, 8).suggestedDurationS).toBeGreaterThanOrEqual(13);
  });
  it('8 palabras es-MX ya NO caben en un clip de 4s', () => {
    const needed = estimateSpeechSeconds('Esto cambió por completo todas mis mañanas hoy', 'es');
    expect(fitVerdict(needed, 4).level).toBe('tight');
  });
});

describe('fitVerdict', () => {
  it('tight cuando el diálogo no cabe', () => {
    expect(fitVerdict(6, 5).level).toBe('tight');
  });
  it('ok cuando cabe sin holgura', () => {
    expect(fitVerdict(4.5, 5).level).toBe('ok'); // 0.5 < HEADROOM_S(1.5)
  });
  it('roomy cuando el margen alcanza el headroom', () => {
    expect(fitVerdict(3, 5).level).toBe('roomy'); // 2 >= HEADROOM_S(1.5)
  });
  it('sugiere duración con clamp al rango Seedance', () => {
    expect(fitVerdict(20, 5).suggestedDurationS).toBe(DUR_MAX); // ceil(21.5) clamp 15
    expect(fitVerdict(0.5, 5).suggestedDurationS).toBe(DUR_MIN); // ceil(2)=2 clamp 4
  });
});

describe('replaceDialogue — casos del review final', () => {
  it('no expande $ del diálogo (replacement patterns)', () => {
    const out = replaceDialogue('Medium shot — ella habla. Dialogue: "viejo"', 'Cuesta $1 cada uno');
    expect(extractDialogue(out)).toBe('Cuesta $1 cada uno');
    expect(out.match(/dialogue\s*:/gi)?.length ?? 0).toBe(1);
  });
  it('reemplaza un Dialogue con comillas curvas sin duplicar', () => {
    const out = replaceDialogue('Medium shot — ella habla. Dialogue: “viejo”', 'nuevo');
    expect(extractDialogue(out)).toBe('nuevo');
    expect(out.match(/dialogue\s*:/gi)?.length ?? 0).toBe(1);
  });
  it('normaliza comillas dobles internas a simples', () => {
    const out = replaceDialogue('Medium shot — ella habla. Dialogue: "x"', 'dice "alto"');
    expect(extractDialogue(out)).toBe("dice 'alto'");
    expect(out.match(/dialogue\s*:/gi)?.length ?? 0).toBe(1);
  });
});
