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
    expect(extractDialogue('Acción. Dialogue: "Hola"')).toBe('Hola');
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
  it('usa WPS por idioma (10 palabras es = 4s)', () => {
    expect(estimateSpeechSeconds('uno dos tres cuatro cinco seis siete ocho nueve diez', 'es')).toBeCloseTo(10 / WPS.es);
  });
});

describe('fitVerdict', () => {
  it('tight cuando el diálogo no cabe', () => {
    expect(fitVerdict(6, 5).level).toBe('tight');
  });
  it('ok cuando cabe sin holgura', () => {
    expect(fitVerdict(4.5, 5).level).toBe('ok'); // 0.5 < HEADROOM_S(1)
  });
  it('roomy cuando hay >= 1s de margen', () => {
    expect(fitVerdict(3, 5).level).toBe('roomy');
  });
  it('sugiere duración con clamp al rango Seedance', () => {
    expect(fitVerdict(20, 5).suggestedDurationS).toBe(DUR_MAX); // 20+1 clamp 15
    expect(fitVerdict(0.5, 5).suggestedDurationS).toBe(DUR_MIN); // ceil(1.5)=2 clamp 4
  });
});
