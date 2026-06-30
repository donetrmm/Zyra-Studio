// lib/campaigns/guidelines.ts
// Guias creativas estructuradas por campana (spec 2026-06-29). Opt-in: ausente o
// apagado = comportamiento actual. NO depende de product_brief (vive en su propia
// columna creative_guidelines).
import { z } from 'zod';

export const CreativeGuidelinesSchema = z.object({
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
  safeAreaExtend: z.boolean().optional(),
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
  const wantsFullProduct = Boolean(guidelines.showFullProduct);
  const wantsHook = Boolean(guidelines.hookProductHero && opts.isOpeningBeat);
  const wantsSafe = guidelines.safeCrop === '4:5';

  let out = '';

  // Reconciliacion: safeCrop y "completar el producto" se PELEAN si se emiten por
  // separado. "shown large and complete" empuja a llenar el 9:16, mientras "central
  // 4:5" lo encoge; el modelo resuelve haciendo el producto grande y recortandolo
  // fuera del safe area (justo el hook, donde se quiere completo). Cuando ambos estan
  // activos se emite UNA clausula que ata "completo" al safe area y acota "grande" a
  // ese area, en vez de dos instrucciones que compiten. Cubre tambien las caras, asi
  // que sustituye a la clausula generica de safe-crop.
  if (wantsSafe && (wantsFullProduct || wantsHook)) {
    if (wantsHook) {
      out += ' This is the opening hook: the product is the clear hero of the frame from the first beat.';
    }
    out +=
      ' When the product is in the shot, frame its entire shape inside the central 4:5 area of the vertical frame with clear margin on every side; make it as large as it can be while keeping all four of its edges inside that 4:5 area, and leave the extreme top and bottom of the frame as empty headroom and footroom. Do not let the product extend past the 4:5 area or be cropped by the frame edge, unless the beat is a deliberate detail shot. Keep any faces within the same central 4:5 area too, so the shot can be cropped to 4:5 without losing key content.';
    return out;
  }

  // Rutas no reconciliadas: comportamiento original sin cambios.
  if (wantsFullProduct) {
    out +=
      ' When the product is on screen, frame it complete and unobstructed; avoid crops that cut off the product, unless the beat is a deliberate detail shot.';
  }
  if (wantsHook) {
    out +=
      ' This is the opening hook: present the full product as the clear hero of the frame, shown large and complete from the first beat.';
  }
  if (wantsSafe) {
    out +=
      ' Crop-safe framing: keep all key elements (the product and any faces) within the central 4:5 area of the vertical frame; place nothing essential in the extreme top or bottom, so the shot can be cropped to 4:5 without losing key content.';
  }
  return out;
}

// Para la BASE 4:5 del modo estricto: el frame 4:5 YA es la zona segura, asi que
// emitir la clausula de safeCrop ahi seria redundante (encogeria el producto dentro
// de un 4:5 que de por si es el area segura). Anula safeCrop conservando el resto de
// las guias (showFullProduct/hookProductHero siguen vigentes).
export function guidelinesForSafeBase(
  guidelines: CreativeGuidelines | undefined,
): CreativeGuidelines | undefined {
  if (!guidelines) return undefined;
  return { ...guidelines, safeCrop: null };
}
