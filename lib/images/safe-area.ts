import 'server-only';
import sharp from 'sharp';

// Geometria pura de la zona segura 4:5 dentro de un frame 9:16 (sharp local, sin
// red, determinista). El producto/caras se generan en una base 4:5 (no caben fuera)
// y se extiende a 9:16 rellenando solo las bandas, con el centro fijado a la base.
const RATIO_4x5 = 5 / 4; // alto/ancho de un 4:5
const RATIO_9x16 = 16 / 9; // alto/ancho de un 9:16

// Banda (arriba/abajo) y alto del lienzo 9:16 para una base 4:5 de ancho `width`.
export function safeAreaBands(width: number): { bandPx: number; canvasHeight: number } {
  const canvasHeight = Math.round(width * RATIO_9x16);
  const baseHeight = Math.round(width * RATIO_4x5);
  const bandPx = Math.round((canvasHeight - baseHeight) / 2);
  return { bandPx, canvasHeight };
}

// Compone la base 4:5 centrada en un lienzo 9:16 con bandas negras (relleno temporal
// para el paso de extension).
export async function composeOnto916(base4x5: Buffer): Promise<Buffer> {
  const meta = await sharp(base4x5).metadata();
  const width = meta.width;
  if (!width) throw new Error('safe-area: base sin ancho');
  const { bandPx, canvasHeight } = safeAreaBands(width);
  return sharp({
    create: { width, height: canvasHeight, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: base4x5, left: 0, top: bandPx }])
    .png()
    .toBuffer();
}

// Recorta el 4:5 central de un 9:16 guardado (recupera la base; determinista). Lo usa
// la cadena/refino para mantener el turno conversacional en 4:5.
export async function centralSafeCrop(panel916: Buffer): Promise<Buffer> {
  const meta = await sharp(panel916).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error('safe-area: panel sin dimensiones');
  const cropH = Math.round(width * RATIO_4x5);
  const top = Math.max(0, Math.round((height - cropH) / 2));
  const h = Math.min(cropH, height - top);
  return sharp(panel916).extract({ left: 0, top, width, height: h }).png().toBuffer();
}
