// Ajuste del diálogo a la duración del clip: el habla de Seedance sale robótica
// cuando el diálogo no cabe en los segundos (debe acelerar). Estos helpers (puros,
// compartidos cliente/servidor) leen/reescriben el diálogo dentro de scene_prompt
// y estiman si cabe. NO 'server-only'.

// Ritmo conversacional natural (palabras/segundo) por idioma. Tunable.
export const WPS: Record<'es' | 'en', number> = { es: 2.5, en: 2.8 };
// Margen mínimo (s) para considerar el diálogo "holgado" (pausado/natural).
export const HEADROOM_S = 1.0;
// Rango de duración de un clip Seedance.
export const DUR_MIN = 4;
export const DUR_MAX = 15;

// Lee el diálogo de un scene_prompt: 1) contenido de `Dialogue: "..."`;
// 2) primer entrecomillado; 3) '' si no hay. Soporta comillas rectas y curvas.
export function extractDialogue(scenePrompt: string): string {
  const s = scenePrompt ?? '';
  const marked = s.match(/dialogue\s*:\s*[""]([^""]*)[""]/i);
  if (marked) return marked[1].trim();
  const quoted = s.match(/[""]([^""]{2,})[""]/);
  if (quoted) return quoted[1].trim();
  return '';
}

// Reescribe el segmento de diálogo dejando intacta la acción visual.
// - nuevo vacío  -> quita el segmento `Dialogue: "..."` (o el primer entrecomillado).
// - existe marcador/entrecomillado -> reemplaza solo el contenido entre comillas.
// - no existe ninguno -> agrega ` Dialogue: "<nuevo>"`.
export function replaceDialogue(scenePrompt: string, nuevo: string): string {
  const s = (scenePrompt ?? '').trim();
  const clean = nuevo.trim();
  const markedContentRe = /(dialogue\s*:\s*[""])([^""]*)([""])/i;
  const quotedRe = /([""])([^""]{2,})([""])/;

  if (clean === '') {
    const markedFullRe = /\s*dialogue\s*:\s*[""][^""]*[""]\s*\.?/i;
    if (markedFullRe.test(s)) return s.replace(markedFullRe, ' ').replace(/\s{2,}/g, ' ').trim();
    if (quotedRe.test(s)) return s.replace(quotedRe, '').replace(/\s{2,}/g, ' ').trim();
    return s;
  }
  if (markedContentRe.test(s)) return s.replace(markedContentRe, `$1${clean}$3`);
  if (quotedRe.test(s)) return s.replace(quotedRe, `$1${clean}$3`);
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

// Veredicto de ajuste + duración sugerida (clamp al rango Seedance).
export function fitVerdict(
  neededS: number,
  durationS: number,
): { level: 'tight' | 'ok' | 'roomy'; suggestedDurationS: number } {
  const suggestedDurationS = clamp(Math.ceil(neededS + HEADROOM_S), DUR_MIN, DUR_MAX);
  let level: 'tight' | 'ok' | 'roomy';
  if (neededS > durationS) level = 'tight';
  else if (durationS - neededS < HEADROOM_S) level = 'ok';
  else level = 'roomy';
  return { level, suggestedDurationS };
}
