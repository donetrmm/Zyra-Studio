import 'server-only';
import sharp from 'sharp';

// Hash perceptual "average hash" (aHash): reduce la imagen a 8x8 en escala de
// grises y marca cada pixel segun supere o no la media. Sirve para detectar que
// el proveedor devolvio una imagen casi intacta (echo) en vez de una vista nueva.
// Todo local (sharp), sin red — determinista para test.

const HASH_SIZE = 8; // 8x8 = 64 bits

export async function averageHash(buffer: Buffer): Promise<boolean[]> {
  const { data, info } = await sharp(buffer)
    .grayscale()
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 1;
  const lum: number[] = [];
  for (let i = 0; i < HASH_SIZE * HASH_SIZE; i++) lum.push(data[i * channels]);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  return lum.map((p) => p >= mean);
}

// Distancia de Hamming: cuantos bits difieren. Largos distintos cuentan como
// diferencia (no deberia pasar con hashes del mismo tamano).
export function hammingDistance(a: boolean[], b: boolean[]): number {
  const n = Math.min(a.length, b.length);
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

// Umbral conservador: una imagen devuelta intacta (echo) da distancia ~0-4 aun
// con recompresion; una rotacion real de 45 grados altera muchos buckets de
// baja resolucion y supera el umbral. Preferimos no gritar "echo" de mas.
export const NEARLY_IDENTICAL_MAX_DISTANCE = 6;

export function isNearlyIdentical(a: boolean[], b: boolean[]): boolean {
  return hammingDistance(a, b) <= NEARLY_IDENTICAL_MAX_DISTANCE;
}
