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
