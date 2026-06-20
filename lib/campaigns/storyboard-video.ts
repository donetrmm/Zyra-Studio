// Caso storyboard CON cast: Atlas no deja mezclar first_frame + referencias, así que
// el clip va por reference2video. El cast va primero (citado @image1..N por el compiler)
// y el panel al FINAL (@image{N+1}) — para no romper la numeración del cast. El número
// es interno; el orden no implica prioridad (doc Seedance). Helper puro.
export function buildCastR2VRefs(
  castRefs: string[],
  panelPath: string,
): { referenceImagePaths: string[]; panelCitation: string } {
  const referenceImagePaths = [...castRefs, panelPath];
  const n = castRefs.length + 1;
  const panelCitation = ` @image${n} is the exact opening frame and overall composition of this shot — reproduce it as the starting look (same framing, colors and layout).`;
  return { referenceImagePaths, panelCitation };
}
