// Ajuste del diálogo a la duración del clip: el habla de Seedance sale robótica
// cuando el diálogo no cabe en los segundos (debe acelerar). Estos helpers (puros,
// compartidos cliente/servidor) leen/reescriben el diálogo dentro de scene_prompt
// y estiman si cabe. NO 'server-only'.

// Ritmo SOSTENIDO de habla (palabras/segundo) por idioma. Calibrado con
// mediciones reales del usuario (2026-07-07, es-MX): 36 palabras = 14s y
// 3 palabras = 2.37s → ~2.8 wps de ritmo marginal + ~1.3s fijos de arranque.
// La tasa se descuenta a entrega ACTUADA (~75%; las guías de Seedance graban la
// referencia al ~80% de velocidad) y el arranque vive en HEADROOM_S, no aquí.
// Historia: 2.5 (conversación humana, quedaba atropellado con el aire en 1.0) →
// 1.4 (tasa única, inflaba líneas largas) → 2.0 + aire fijo 2.0. Tunable.
export const WPS: Record<'es' | 'en', number> = { es: 2.0, en: 2.2 };
// Aire FIJO por clip (s): arranque de la voz + edit handles del storyboard
// (frame quieto al abrir/cerrar). Se suma al habla para sugerir duración.
export const HEADROOM_S = 2.0;
// Aire mínimo real (s): si el habla deja menos margen que esto, el clip está
// apretado y el modelo acelera la entrega. Frontera del veredicto 'tight'.
export const MIN_AIR_S = 1.0;
// Rango de duración de un clip Seedance.
export const DUR_MIN = 4;
export const DUR_MAX = 15;

// Lee el diálogo de un scene_prompt: 1) contenido de `Dialogue: "..."`;
// 2) primer entrecomillado; 3) '' si no hay. Soporta comillas rectas y curvas.
export function extractDialogue(scenePrompt: string): string {
  const s = scenePrompt ?? '';
  const marked = s.match(/dialogue\s*:\s*["“]([^"“”]*)["”]/i);
  if (marked) return marked[1].trim();
  const quoted = s.match(/["“]([^"“”]{2,})["”]/);
  if (quoted) return quoted[1].trim();
  return '';
}

// Reescribe el segmento de diálogo dejando intacta la acción visual.
// - nuevo vacío  -> quita el segmento `Dialogue: "..."` (o el primer entrecomillado).
// - existe marcador/entrecomillado -> reemplaza solo el contenido entre comillas.
// - no existe ninguno -> agrega ` Dialogue: "<nuevo>"`.
// Usa replacer FUNCIÓN (no string) para que `$` del diálogo no se interprete como
// patrón de reemplazo; normaliza comillas dobles internas a simple (romperían el
// formato `Dialogue: "..."`).
export function replaceDialogue(scenePrompt: string, nuevo: string): string {
  const s = (scenePrompt ?? '').trim();
  // Normaliza comillas dobles internas (rectas y curvas) a simple para no romper el formato.
  const clean = nuevo.trim().replace(/["“”]/g, "'");
  const markedContentRe = /(dialogue\s*:\s*["“])([^"“”]*)(["”])/i;
  const quotedRe = /(["“])([^"“”]{2,})(["”])/;

  if (clean === '') {
    const markedFullRe = /\s*dialogue\s*:\s*["“][^"“”]*["”]\s*\.?/i;
    if (markedFullRe.test(s)) return s.replace(markedFullRe, ' ').replace(/\s{2,}/g, ' ').trim();
    if (quotedRe.test(s)) return s.replace(quotedRe, '').replace(/\s{2,}/g, ' ').trim();
    return s;
  }
  if (markedContentRe.test(s)) {
    // Replacer función: evita que `$` en `clean` se interprete como patrón de reemplazo.
    return s.replace(markedContentRe, (_m, p1: string, _c: string, p3: string) => `${p1}${clean}${p3}`);
  }
  if (quotedRe.test(s)) {
    return s.replace(quotedRe, (_m, p1: string, _c: string, p3: string) => `${p1}${clean}${p3}`);
  }
  return `${s} Dialogue: "${clean}"`;
}

export function countWords(text: string): number {
  const t = (text ?? '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

export function estimateSpeechSeconds(dialogo: string, lang: 'es' | 'en'): number {
  return countWords(dialogo) / WPS[lang];
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// Veredicto de ajuste + duración sugerida (clamp al rango Seedance). 'tight' ya
// no es solo "no cabe": habla que llena el clip sin el aire mínimo también es
// apretada (el modelo la acelera igual) — antes ese caso pasaba como 'ok'.
export function fitVerdict(
  neededS: number,
  durationS: number,
): { level: 'tight' | 'ok' | 'roomy'; suggestedDurationS: number } {
  const suggestedDurationS = clamp(Math.ceil(neededS + HEADROOM_S), DUR_MIN, DUR_MAX);
  const margin = durationS - neededS;
  let level: 'tight' | 'ok' | 'roomy';
  if (margin < MIN_AIR_S) level = 'tight';
  else if (margin < HEADROOM_S) level = 'ok';
  else level = 'roomy';
  return { level, suggestedDurationS };
}
