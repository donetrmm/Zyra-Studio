// Cue de entrega de voz para Seedance (Fase 1 audio, 2026-07-11): reduce la
// planitud inyectando un descriptor de tono EN INGLÉS pegado a la cita del
// diálogo. Puro y client-safe (la UI importa las etiquetas). El diálogo sigue en
// es-MX; esta directiva describe CÓMO se entrega, nunca la VELOCIDAD (el ritmo es
// Fase 2 — los descriptores no dicen "rápido/lento").
import { declaresHighEmotion, ENERGETIC_REGISTER_RE } from '@/lib/prompt-director/acting';

// Etiqueta española (chip / valor guardado) → descriptor de entrega en inglés.
// Fase 2 audio (2026-07-13): los tonos calmos ('serio', 'seguro') se enriquecen con
// calidez/vida para que, aun eligiéndolos, la voz no salga monótona (la planitud que
// reportó el usuario venía de que 'seguro' → 'confident, self-assured' se entregaba
// medido). Conservan su intención (confianza/gravedad), solo dejan de ser planos.
export const VOICE_TONE_MAP: Record<string, string> = {
  cálido: 'warm, personable',
  entusiasta: 'upbeat, enthusiastic',
  serio: 'serious and grounded, still warm and expressive',
  juguetón: 'playful, light',
  íntimo: 'intimate, soft, close to the mic',
  seguro: 'confident and self-assured, still warm and lively',
};

// Chips que ofrece la UI (labels en español = claves del mapa).
export const VOICE_TONE_LABELS: string[] = Object.keys(VOICE_TONE_MAP);

// Default expresivo según registro + emoción declarada (inglés, corto). Reemplaza
// el null del viejo voiceToneForRegister: TODO clip con voz recibe algo expresivo.
function defaultDescriptor(register: string, scenePrompt: string): string {
  if (declaresHighEmotion(scenePrompt)) {
    return 'expressive and emotionally intense, letting the strong feeling come through fully';
  }
  const r = register.toLowerCase();
  if (/asmr|susurro|whisper|macro/.test(r)) return 'intimate, soft, close to the mic';
  if (/calle|street|vox|interview|entrevista|espont/.test(r)) return 'spontaneous, candid, lightly energetic';
  if (ENERGETIC_REGISTER_RE.test(r)) return 'confident, upbeat, punchy';
  if (/cinemat|[eé]pic|gran ?pantalla|brand ?film|emotiv/.test(r)) return 'sincere, warm, emotionally grounded';
  return 'warm, lively, expressive';
}

// Frase de entrega EN INGLÉS lista para prefijar a la cita. voiceTone (override del
// usuario, en español): etiqueta conocida → su mapeo inglés; texto libre → pasa tal
// cual dentro del envoltorio inglés. Vacío/null → default por registro/emoción.
export function deliveryCueFor(
  voiceTone: string | null | undefined,
  register: string,
  scenePrompt: string,
): string {
  const raw = (voiceTone ?? '').trim();
  const descriptor = raw
    ? (VOICE_TONE_MAP[raw.toLowerCase()] ?? raw)
    : defaultDescriptor(register, scenePrompt);
  return `Deliver the line in a ${descriptor} tone — `;
}

// Prefija el cue a la cita dentro de la acción. Preferencia: 1) marcador
// Dialogue:/Diálogo:; 2) primer entrecomillado; 3) sin cita → cue al final. Solo
// toca la acción, nunca el andamiaje (@imageN, 9:16, marcadores de segundos).
const DIALOGUE_MARKER_RE = /(?:dialogue|di[aá]logo)\s*:\s*["“]/i;
const FIRST_QUOTE_RE = /["“][^"“”]{2,}["”]/;

export function injectDeliveryCue(action: string, cue: string): string {
  if (DIALOGUE_MARKER_RE.test(action)) {
    return action.replace(DIALOGUE_MARKER_RE, (m) => `${cue}${m}`);
  }
  if (FIRST_QUOTE_RE.test(action)) {
    return action.replace(FIRST_QUOTE_RE, (m) => `${cue}${m}`);
  }
  return `${action} ${cue}`.trimEnd();
}
