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

// Calibración con mediciones REALES del usuario (2026-07-07, es-MX natural):
// "Hola, cómo estás" (3 palabras) = 2.37s; una frase de 36 palabras = 14s.
// La regresión da ~2.8 palabras/seg de ritmo MARGINAL + ~1.3s fijos de arranque.
// El modelo separa ambos: tasa sostenida (WPS, con descuento a entrega actuada)
// + aire fijo por clip (HEADROOM_S). Una tasa única (el 1.4 anterior) metía el
// arranque dentro de la tasa e inflaba las líneas largas.
describe('calibración del ritmo de habla (mediciones del usuario)', () => {
  it('3 palabras (2.37s reales) caben holgadas en el clip mínimo de 4s', () => {
    const needed = estimateSpeechSeconds('Hola cómo estás', 'es');
    expect(fitVerdict(needed, 4).level).toBe('roomy');
    expect(fitVerdict(needed, 4).suggestedDurationS).toBe(DUR_MIN);
  });
  it('36 palabras (14s reales de habla) no caben ni en el clip máximo', () => {
    const treintaYSeis = Array.from({ length: 36 }, (_, i) => `palabra${i}`).join(' ');
    const needed = estimateSpeechSeconds(treintaYSeis, 'es');
    expect(fitVerdict(needed, 15).level).toBe('tight');
    expect(fitVerdict(needed, 8).suggestedDurationS).toBe(DUR_MAX);
  });
  it('12 palabras es-MX piden ~8s de clip (6s de habla + aire fijo)', () => {
    const doce = Array.from({ length: 12 }, (_, i) => `palabra${i}`).join(' ');
    const needed = estimateSpeechSeconds(doce, 'es');
    expect(fitVerdict(needed, 4).suggestedDurationS).toBe(8);
    expect(fitVerdict(needed, 8).level).not.toBe('tight');
  });
  it('8 palabras es-MX quedan apretadas en un clip de 4s', () => {
    const needed = estimateSpeechSeconds('Esto cambió por completo todas mis mañanas hoy', 'es');
    expect(fitVerdict(needed, 4).level).toBe('tight');
  });
});

describe('fitVerdict', () => {
  it('tight cuando el diálogo no cabe', () => {
    expect(fitVerdict(6, 5).level).toBe('tight');
  });
  it('tight cuando cabe pero sin el aire mínimo (habla pegada al borde)', () => {
    expect(fitVerdict(4.5, 5).level).toBe('tight'); // 0.5 < MIN_AIR_S(1)
  });
  it('ok cuando hay aire mínimo pero no la holgura completa', () => {
    expect(fitVerdict(3.5, 5).level).toBe('ok'); // 1 <= 1.5 < HEADROOM_S(2)
  });
  it('roomy cuando el margen alcanza el headroom', () => {
    expect(fitVerdict(3, 5).level).toBe('roomy'); // 2 >= HEADROOM_S(2)
  });
  it('sugiere duración con clamp al rango Seedance', () => {
    expect(fitVerdict(20, 5).suggestedDurationS).toBe(DUR_MAX); // ceil(22) clamp 15
    expect(fitVerdict(0.5, 5).suggestedDurationS).toBe(DUR_MIN); // ceil(2.5)=3 clamp 4
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
