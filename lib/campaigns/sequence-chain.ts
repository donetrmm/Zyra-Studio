// Lógica pura del encadenado de secuencias (specs/v2/09). Sin DB ni 'server-only':
// decide el orden y el siguiente clip de una cadena para que el worker y el
// orquestador no dupliquen la regla. El estado (generaciones, fotogramas) lo
// maneja quien la consume.

export type ChainItem = { id: string; sceneIndex: number };

// Orden narrativo de las escenas de una secuencia.
export function orderedSceneItems<T extends ChainItem>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sceneIndex - b.sceneIndex);
}

// El primer clip: el único que se encola al inicio (R2V con el producto +
// return_last_frame). null si la secuencia está vacía.
export function firstSceneItem<T extends ChainItem>(items: T[]): T | null {
  return orderedSceneItems(items)[0] ?? null;
}

// El siguiente clip tras `sceneIndex` (image-to-video desde el fotograma
// heredado), o null si ese era el último de la secuencia.
export function nextSceneItem<T extends ChainItem>(items: T[], sceneIndex: number): T | null {
  return orderedSceneItems(items).find((i) => i.sceneIndex > sceneIndex) ?? null;
}

// ¿Este clip debe pedir su último fotograma? Sí salvo que sea el último de la
// cadena (no hay clip que lo herede).
export function shouldReturnLastFrame<T extends ChainItem>(
  items: T[],
  sceneIndex: number,
): boolean {
  return nextSceneItem(items, sceneIndex) !== null;
}

// Modos de regeneración disponibles para un clip según su posición en la cadena.
// Solo aplican a clips con clip PREVIO (no el primero): su generación de
// continuación tiene la estructura [producto, fotograma previo] que estos modos
// reutilizan. El primer clip (estructura de referencias distinta) y el último
// (sin siguiente) se regeneran de forma normal.
export function regenModesFor<T extends ChainItem>(
  items: T[],
  sceneIndex: number,
): { onlyThis: boolean; thisAndForward: boolean } {
  const ordered = orderedSceneItems(items);
  const isFirst = ordered[0]?.sceneIndex === sceneIndex;
  const hasNext = nextSceneItem(items, sceneIndex) !== null;
  const available = hasNext && !isFirst;
  return { onlyThis: available, thisAndForward: available };
}

// ¿La secuencia de este item va en modo-locación? Sí cuando tiene location_id:
// se genera SIN encadenar (cada escena independiente, re-anclando la locación).
// Todas las escenas de una secuencia comparten el mismo location_id.
export function isLocationMode(item: { location_id: string | null }): boolean {
  return item.location_id != null;
}

// ¿Este item va en modo storyboard-video? Sí cuando tiene un panel de storyboard:
// su clip se genera image2video desde el panel (fotograma inicial), SIN encadenar.
// Gana sobre el encadenado y el modo-locación.
export function isStoryboardVideoMode(item: { storyboard_image_id: string | null }): boolean {
  return item.storyboard_image_id != null;
}

// El modo storyboard-video genera image2video, así que el slug debe ser un endpoint
// image-to-video (NO reference-to-video): el slug DEBE coincidir con la operación, o
// Atlas rutea mal y el panel se ignora como first_frame. Reescribe conservando el tier.
export function toImage2VideoSlug(slug: string): string {
  return slug.replace('reference-to-video', 'image-to-video');
}

// Fuente del audio de referencia de un clip ENCADENADO (spike 2026-07-04). Son
// excluyentes porque Seedance limita las refs de audio a 15s combinados:
// 'music' = la pista P16 de la campaña (comportamiento previo, y el default);
// 'prev_clip' = el audio extraído del clip anterior (consistencia de voz).
// Si el usuario eligió prev_clip pero la extracción falló (clip mudo, ffmpeg),
// NO se cae a la música: mezclar fuentes entre clips de una misma secuencia
// suena más inconsistente que un clip sin referencia.
// Con generateAudio=false el clip es MUDO: ninguna referencia viaja (una ref
// de voz junto a generate_audio=false es un payload contradictorio).
export type ChainAudioSource = 'music' | 'prev_clip';

export function chainAudioPaths(
  source: ChainAudioSource | undefined,
  musicPath: string | undefined,
  prevAudioPath: string | null | undefined,
  generateAudio = true,
): { paths: string[]; kind: ChainAudioSource | null } {
  if (!generateAudio) return { paths: [], kind: null };
  if (source === 'prev_clip') {
    return prevAudioPath ? { paths: [prevAudioPath], kind: 'prev_clip' } : { paths: [], kind: null };
  }
  return musicPath ? { paths: [musicPath], kind: 'music' } : { paths: [], kind: null };
}
