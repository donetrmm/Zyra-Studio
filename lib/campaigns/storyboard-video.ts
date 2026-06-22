// Helpers puros del video desde storyboard (modo B). El orquestador hace el IO.

// Manijas de edición: clips independientes (sin encadenar) necesitan puntos de
// corte limpios para montarse en post. Se pide abrir en el fotograma inicial
// sostenido un instante y cerrar en un fotograma estable y casi quieto → entradas
// y salidas montables sin saltos. Empieza con espacio (lista para concatenar).
export const STORYBOARD_EDIT_HANDLES =
  ' Editing handles: open exactly on the still opening frame held for a brief beat, then ease into the motion; end by settling onto a steady, clean, almost-still frame. Keep clean in and out points so the clip cuts cleanly against others, with no abrupt jump at the very first or very last frame.';

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
): { referenceImagePaths: string[]; extraCitation: string } {
  const referenceImagePaths = [...castRefs, ...productRefs, panelPath];
  let n = castRefs.length;
  let extraCitation = '';
  if (productRefs.length > 0) {
    const nums = productRefs.map((_, i) => `@image${n + 1 + i}`);
    const verb = productRefs.length > 1 ? 'are' : 'is';
    extraCitation += ` ${nums.join(' and ')} ${verb} the product — reproduce its printed image, design and colors exactly and keep it identical throughout the shot; do not restyle or change what is printed on it.`;
    n += productRefs.length;
  }
  const panelNum = n + 1;
  extraCitation += ` @image${panelNum} is the exact opening frame and overall composition of this shot — reproduce it as the starting look (same framing, colors and layout).`;
  return { referenceImagePaths, extraCitation };
}
