import { describe, it, expect } from 'vitest';
import { splitLongDialogues, DIALOGUE_PAUSE_BEAT, DIALOGUE_LANGUAGE } from './seedance';

// Fluidez del habla (2026-07-07): las guías de comunidad de Seedance coinciden en
// que las líneas de 5-10 palabras sincronizan bien y las largas salen "masticadas".
// Un diálogo largo multi-frase se parte en segmentos Dialogue: "..." cortos con un
// beat de pausa escrito entre ellos (el modelo los usa como ancla de resincronización).
describe('splitLongDialogues', () => {
  it('parte un diálogo largo de dos frases en dos segmentos con beat de pausa', () => {
    const action =
      'Medium shot — she speaks to camera. Dialogue: "Esto cambió todas mis mañanas desde el primer día. Ahora no puedo empezar sin él."';
    const out = splitLongDialogues(action);
    expect(out.match(/Dialogue:/g)?.length).toBe(2);
    expect(out).toContain(DIALOGUE_PAUSE_BEAT);
    expect(out).toContain('Dialogue: "Esto cambió todas mis mañanas desde el primer día."');
    expect(out).toContain('Dialogue: "Ahora no puedo empezar sin él."');
    // La acción visual fuera del diálogo queda intacta.
    expect(out).toContain('Medium shot — she speaks to camera.');
  });

  it('no toca un diálogo corto aunque tenga dos frases', () => {
    const action = 'She nods. Dialogue: "Hola. Mira esto."';
    expect(splitLongDialogues(action)).toBe(action);
  });

  it('no parte una frase única larga (sin frontera de oración)', () => {
    const action =
      'She speaks. Dialogue: "Esto cambió por completo todas y cada una de mis mañanas desde el primer día"';
    expect(splitLongDialogues(action)).toBe(action);
  });

  it('soporta comillas curvas', () => {
    const action =
      'She speaks. Dialogue: “Esto cambió todas mis mañanas desde el primer día. Ahora no puedo empezar sin él.”';
    const out = splitLongDialogues(action);
    expect(out.match(/Dialogue:/g)?.length).toBe(2);
    expect(out).toContain('“Esto cambió todas mis mañanas desde el primer día.”');
    expect(out).toContain('“Ahora no puedo empezar sin él.”');
  });

  it('parte tres frases en tres segmentos con pausa entre cada uno', () => {
    const action =
      'She speaks. Dialogue: "Mi familia vive en otro estado y casi no los veo. Este cuadro me los trajo de vuelta. No sabes lo que significa."';
    const out = splitLongDialogues(action);
    expect(out.match(/Dialogue:/g)?.length).toBe(3);
    expect(out.split(DIALOGUE_PAUSE_BEAT)).toHaveLength(3);
  });

  it('no toca texto sin diálogo', () => {
    const action = 'Wide shot. The can spins on marble and stops label-forward.';
    expect(splitLongDialogues(action)).toBe(action);
  });

  // Caso real (Anuncio #12 clip 1, 2026-07-07): 17 palabras en UNA sola oración
  // — el modelo la mastica y "se equivoca" al decirla. La coma es una pausa de
  // respiración real: se parte ahí, nunca en frontera arbitraria de palabra.
  it('parte una frase única larga en sus comas (pausas naturales)', () => {
    const action =
      'She speaks. Dialogue: "Uno de mis grandes errores como mamá, es no haber decorado usando las fotos con mi hijo."';
    const out = splitLongDialogues(action);
    expect(out.match(/Dialogue:/g)?.length).toBe(2);
    expect(out).toContain('Dialogue: "Uno de mis grandes errores como mamá"');
    expect(out).toContain('Dialogue: "es no haber decorado usando las fotos con mi hijo."');
    expect(out).toContain(DIALOGUE_PAUSE_BEAT);
  });

  it('fusiona tramos cortos entre comas para no dejar segmentos diminutos', () => {
    const action =
      'She speaks. Dialogue: "Esto cambió mis mañanas, mis tardes, mis noches y mi vida entera desde el primer día"';
    const out = splitLongDialogues(action);
    // 4+2 palabras se fusionan en un tramo; el resto (10) va aparte.
    expect(out.match(/Dialogue:/g)?.length).toBe(2);
    expect(out).toContain('Dialogue: "Esto cambió mis mañanas, mis tardes"');
    expect(out).toContain('Dialogue: "mis noches y mi vida entera desde el primer día"');
  });

  // Fase 2 audio (2026-07-13): umbral subido a 14 palabras. Una línea de 11-13
  // palabras (aunque tenga coma) ya NO se parte — la cláusula de fluidez la
  // sostiene sin trocearla, que es de donde venía el "pausa mucho".
  it('no parte una línea de 11-13 palabras aunque tenga coma (umbral Fase 2)', () => {
    const action =
      'She speaks. Dialogue: "Esto cambió mis mañanas, mis tardes y toda mi vida entera."';
    expect(splitLongDialogues(action)).toBe(action);
  });
});

// Fase 2 audio (2026-07-13): el beat de re-sync ya NO ordena una pausa dramática;
// pide una respiración breve y natural sin corte, para que las líneas largas
// partidas no suenen troceadas.
describe('DIALOGUE_PAUSE_BEAT suavizado (Fase 2 audio)', () => {
  it('no ordena una pausa dramática y pide respiración breve sin corte', () => {
    expect(DIALOGUE_PAUSE_BEAT).not.toMatch(/pauses briefly/i);
    expect(DIALOGUE_PAUSE_BEAT).toMatch(/breath/i);
    expect(DIALOGUE_PAUSE_BEAT).toMatch(/without a long|no long|smoothly/i);
  });
});

describe('DIALOGUE_LANGUAGE rebalanceada (Fase 1 audio)', () => {
  it('lidera con expresividad sin perder los guardrails es-MX ni la articulación', () => {
    const es = DIALOGUE_LANGUAGE.es;
    // Nuevo: prosodia expresiva y contención SOLO visual.
    expect(es).toMatch(/expressive/i);
    expect(es).toMatch(/emphasize/i);
    expect(es).toMatch(/face and gestures/i);
    // Conservado: es-MX / anti-castellano.
    expect(es).toContain('seseo');
    expect(es).toContain('Castilian');
    // Conservado: articulación.
    expect(es).toContain('full value');
    expect(es).toContain('consonant clusters');
    // Ya NO frena la voz como antes ("exaggerated acting" quitado del eje vocal).
    expect(es).not.toMatch(/exaggerated acting/i);
    // Fase 2: fluidez + ritmo — línea continua, sin pausas dramáticas, sin arrastrar.
    expect(es).toMatch(/continuous, connected/i);
    expect(es).toMatch(/dramatic pauses/i);
    expect(es).toMatch(/flowing|continuously/i);
    expect(es).toMatch(/drag/i);
  });
  it('la variante en conserva la articulación y la expresividad + fluidez Fase 2', () => {
    expect(DIALOGUE_LANGUAGE.en).toMatch(/expressive/i);
    expect(DIALOGUE_LANGUAGE.en).toContain('full value');
    expect(DIALOGUE_LANGUAGE.en).toMatch(/continuous, connected/i);
    expect(DIALOGUE_LANGUAGE.en).toMatch(/dramatic pauses/i);
  });
});
