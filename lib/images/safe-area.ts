// Geometria de la zona segura 4:5 dentro de un 9:16. Un 4:5 (mas cuadrado) dentro
// de un 9:16 (mas alto) solo recorta ALTURA: se conserva el ancho completo y se
// quitan bandas iguales arriba y abajo. safeAreaBands da cuanta banda agregar (para
// el expand) y centralSafeCrop recorta el 4:5 central de un 9:16 (para encadenar la
// base del siguiente beat). Sin red.
import sharp from 'sharp';

export function safeAreaBands(width: number): { bandPx: number; canvasHeight: number } {
  const canvasHeight = Math.round((width * 16) / 9);
  const baseHeight = Math.round((width * 5) / 4);
  const bandPx = Math.round((canvasHeight - baseHeight) / 2);
  return { bandPx, canvasHeight };
}

export async function centralSafeCrop(panel916: Buffer): Promise<Buffer> {
  const meta = await sharp(panel916).metadata();
  const width = meta.width ?? 0;
  if (!width) throw new Error('centralSafeCrop: ancho desconocido');
  const baseHeight = Math.round((width * 5) / 4);
  const { bandPx } = safeAreaBands(width);
  return sharp(panel916)
    .extract({ left: 0, top: bandPx, width, height: baseHeight })
    .jpeg()
    .toBuffer();
}
