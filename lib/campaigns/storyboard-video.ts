// Helpers puros del video desde storyboard (modo B). El orquestador hace el IO.

import { AUDIO_BEAT_SYNC_CITATION, VOICE_TIMBRE_CITATION } from '../prompt-director/compilers/seedance';

// Manijas de edición: clips independientes (sin encadenar) necesitan puntos de
// corte limpios para montarse en post. Se pide abrir en el fotograma inicial
// sostenido un instante y cerrar en un fotograma estable y casi quieto → entradas
// y salidas montables sin saltos. Empieza con espacio (lista para concatenar).
export const STORYBOARD_EDIT_HANDLES =
  ' Editing handles: open exactly on the still opening frame held for a brief beat, then ease into the motion; end by settling onto a steady, clean, almost-still frame. Keep clean in and out points so the clip cuts cleanly against others, with no abrupt jump at the very first or very last frame.';

// Continuidad de escena en el cross-cut. El formato puede pedir "cross-cutting"
// (cortar entre ángulos DENTRO del clip), y eso está bien — pero cada generación es
// UN clip continuo. Sin esta directiva, al cortar a una toma nueva el modelo arma una
// composición nueva y se trae el FONDO de la hoja maestra del personaje (su fondo de
// estudio/ficha), saliéndose de la escena. Esto fija la locación del fotograma inicial
// para TODO el clip y prohíbe el fondo de la ficha, SIN prohibir el cross-cutting:
// solo lo confina a la misma escena. Empieza con espacio (lista para concatenar).
export const STORYBOARD_SCENE_CONTINUITY =
  ' Keep this same location, set and lighting for the entire clip: if the pacing cross-cuts to another angle or a tighter shot, every cut stays inside this scene — never cut to a plain, studio or neutral backdrop, and never place the people on the background of their character reference. The character references supply identity only (face, hair and build), never their reference-sheet background or studio framing.';

// Escapa metacaracteres de regex para construir un \b<token>\b seguro.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ¿El beat NOMBRA al cast (los personajes actúan EN la toma)? Heurística para no
// mandar el cast como referencia viva en tomas donde la gente no actúa (p.ej. un
// close-up del producto donde los personajes están impresos en el cuadro, no
// presentes). Matchea cualquier token significativo (≥3) de los nombres del cast.
export function beatNamesCast(scenePrompt: string, names: string[]): boolean {
  const text = scenePrompt ?? '';
  const tokens = names
    .flatMap((n) => (n ?? '').split(/\s+/))
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  return tokens.some((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(text));
}

// Caso storyboard CON cast: Atlas no deja mezclar first_frame + referencias, así que
// el clip va por reference2video. Orden de referencias: cast (citado @image1..N por el
// compiler), luego el PRODUCTO (re-anclado como ref dedicada — antes solo viajaba dentro
// del panel, referencia blanda, y derivaba), y el panel al FINAL. El producto y el panel
// se citan aquí (el compiler no los cita: onlyCharacterRefs los quitó del contexto). El
// número es interno; el orden no implica prioridad (doc Seedance). Helper puro.
export function buildCastR2VRefs(
  castRefs: string[],
  productRefs: string[],
  panelPath: string,
  audioRef?: string,
  voiceRef?: string,
): {
  referenceImagePaths: string[];
  referenceAudioPaths: string[];
  // Bucket del slot @audio1: la música es un media_reference (references) pero la
  // VOZ del personaje vive en voice-samples — el worker firma contra este bucket.
  referenceAudioBucket: 'references' | 'voice-samples';
  extraCitation: string;
} {
  const referenceImagePaths = [...castRefs, ...productRefs, panelPath];
  let n = castRefs.length;
  let extraCitation = '';
  if (productRefs.length > 0) {
    const nums = productRefs.map((_, i) => `@image${n + 1 + i}`);
    const verb = productRefs.length > 1 ? 'are' : 'is';
    // Condicional a visibilidad y SUBORDINADO al encuadre: la cita anterior decía
    // "reproduce... throughout the shot" y forzaba el impreso a cámara, anulando tomas
    // de reacción donde el cuadro está volteado (POV only). Ahora solo fija la apariencia
    // cuando el producto se ve; sigue el encuadre para si mira a cámara o está de espaldas.
    extraCitation += ` ${nums.join(' and ')} ${verb} the product reference — whenever the product is visible, reproduce its printed image, design and colors exactly; do not restyle or change what is printed on it. Follow the shot's framing for whether the product faces the camera or is turned away, and do not reveal the print to camera unless the shot itself shows it.`;
    n += productRefs.length;
  }
  const panelNum = n + 1;
  extraCitation += ` @image${panelNum} is the exact opening frame and overall composition of this shot — reproduce it as the starting look (same framing, colors and layout).`;
  // Confina el cross-cut a la misma escena (ver STORYBOARD_SCENE_CONTINUITY): evita que
  // una toma secundaria saque al personaje al fondo de su hoja maestra.
  extraCitation += STORYBOARD_SCENE_CONTINUITY;
  // Audio de referencia (solo R2V): un único slot @audio1, contador propio separado
  // de @image1..N. La VOZ del hablante gana sobre la música (el usuario la asignó al
  // personaje); sin voz, va la música (beat-sync P16).
  const audioSlot = voiceRef ?? audioRef;
  const referenceAudioPaths = audioSlot ? [audioSlot] : [];
  if (voiceRef) {
    extraCitation += ` ${VOICE_TIMBRE_CITATION}`;
  } else if (audioRef) {
    extraCitation += ` ${AUDIO_BEAT_SYNC_CITATION}`;
  }
  // La voz gana el slot y arrastra su bucket (voice_clones.sample_storage_url
  // vive en voice-samples). Firmarla contra references falla con Object not found.
  const referenceAudioBucket = voiceRef ? ('voice-samples' as const) : ('references' as const);
  return { referenceImagePaths, referenceAudioPaths, referenceAudioBucket, extraCitation };
}
