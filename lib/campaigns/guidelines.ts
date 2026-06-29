// lib/campaigns/guidelines.ts
// Guias creativas estructuradas por campana (spec 2026-06-29). Opt-in: ausente o
// apagado = comportamiento actual. NO depende de product_brief (vive en su propia
// columna creative_guidelines).
import { z } from 'zod';

export const CreativeGuidelinesSchema = z.object({
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
});
export type CreativeGuidelines = z.infer<typeof CreativeGuidelinesSchema>;

// Clausulas deterministas para el prompt (video y panel). ASCII, cada una empieza
// con espacio (concatenable). Gateadas por flag: una guia apagada no emite nada.
// `isOpeningBeat` habilita el hook-hero SOLO en el beat de apertura del creativo.
export function creativeGuidelineClauses(
  guidelines: CreativeGuidelines | undefined,
  opts: { isOpeningBeat?: boolean } = {},
): string {
  if (!guidelines) return '';
  let out = '';
  if (guidelines.showFullProduct) {
    out +=
      ' When the product is on screen, frame it complete and unobstructed; avoid crops that cut off the product, unless the beat is a deliberate detail shot.';
  }
  if (guidelines.hookProductHero && opts.isOpeningBeat) {
    out +=
      ' This is the opening hook: present the full product as the clear hero of the frame, shown large and complete from the first beat.';
  }
  if (guidelines.safeCrop === '4:5') {
    out +=
      ' Crop-safe framing: keep all key elements (the product and any faces) within the central 4:5 area of the vertical frame; place nothing essential in the extreme top or bottom, so the shot can be cropped to 4:5 without losing key content.';
  }
  return out;
}
