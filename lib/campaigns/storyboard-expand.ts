import sharp from 'sharp';
import { ProviderError } from '@/lib/providers/types';
import { expand } from '@/lib/providers/flux-expand';
import { safeAreaBands } from '@/lib/images/safe-area';

// Expande una base 4:5 a 9:16 con FLUX.1 Expand (outpaint con mascara). Agrega
// bandas reales arriba y abajo preservando el centro 4:5. NO hace fallback: si el
// expand cae (endpoint no disponible, 402, timeout, moderado) deja propagar el
// ProviderError para que el worker falle limpio (fail + refund). El prompt es NEUTRO
// a proposito: el expand continua el fondo que ya ve, no necesita la escena, y asi se
// reduce la superficie de moderacion de BFL y se evita inventar un sujeto en las bandas.
export async function extendPanelTo916(
  base: { buffer: Buffer; mimeType: string },
): Promise<{ buffer: Buffer; mimeType: string }> {
  const meta = await sharp(base.buffer).metadata();
  const width = meta.width ?? 0;
  if (!width) {
    throw new ProviderError('zona segura: no se pudo leer el ancho de la base', 'invalid_input', false);
  }
  const { bandPx } = safeAreaBands(width);
  const prompt =
    'Extend the existing image naturally above and below into a taller vertical frame: continue the same background, walls, floor, sky, lighting and colors already present in the image. Do not add, remove, or change any people, products, text or objects; only extend the empty surroundings.';
  const result = await expand({ image: base.buffer, top: bandPx, bottom: bandPx, prompt });
  return { buffer: result.buffer, mimeType: result.mimeType };
}
