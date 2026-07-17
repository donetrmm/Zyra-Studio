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
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('centralSafeCrop: dimensiones desconocidas');
  const baseHeight = Math.round((width * 5) / 4);
  if (height <= baseHeight) return panel916;
  // Recorta la franja central de 4:5 (mismo ancho) centrada en la altura REAL. NO
  // se asume 9:16: los paneles del estudio (GPT Image 2:3, Gemini, subidas) son
  // mas altos que 4:5 pero no 9:16, y calcular la banda desde el 9:16 ideal
  // (safeAreaBands) se pasaba de la altura real -> sharp 'bad extract area'. Con la
  // altura real, top+baseHeight <= height siempre; para un 9:16 exacto el top
  // coincide con bandPx (sin cambio de comportamiento).
  const top = Math.round((height - baseHeight) / 2);
  return sharp(panel916)
    .extract({ left: 0, top, width, height: baseHeight })
    .jpeg()
    .toBuffer();
}
