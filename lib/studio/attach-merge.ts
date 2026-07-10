import type { StudioAssetImages, StudioAssetType } from '@/components/studio/types';

// Roles válidos por tipo de activo — fuente única de verdad de las keys.
// attachStudioImageAction la usa para rechazar un rol desconocido antes de
// tocar la BD; los botones de AttachDialog (ROLES_BY_TYPE, con iconos) usan
// las mismas keys. `as const` para que StudioRole se derive de aquí (una sola
// fuente): un typo en la tabla de botones es error de compilación, no un rol
// que cae en silencio en la rama default de mergeRole.
export const ATTACH_ROLES = {
  product: ['product', 'packaging'],
  location: ['master', 'reference', 'scale_map'],
  character: ['master', 'angle', 'full_body'],
} as const satisfies Record<StudioAssetType, readonly string[]>;

// Unión de todas las keys de rol válidas (para tipar la tabla de botones y el
// handler del AttachDialog). mergeRole y la action siguen aceptando `string`:
// es el valor validado en runtime que cruza la frontera cliente→server.
export type StudioRole = (typeof ATTACH_ROLES)[StudioAssetType][number];

// Tope de imágenes de referencia adicionales de una locación (igual que el
// schema UpsertLocationSchema y el uploader del editor).
const LOCATION_REFERENCE_CAP = 4;

// Fusiona el nuevo ref en el rol y devuelve el siguiente StudioAssetImages, o un
// error legible (p. ej. tope de ángulos). Pura sobre el StudioAssetImages que
// recibe — no lee ni escribe nada: attachStudioImageAction la llama sobre el
// registro fresco leído de la BD (read-modify-write) para no revertir cambios
// externos hechos mientras el estudio estaba abierto.
export function mergeRole(
  images: StudioAssetImages,
  roleKey: string,
  refId: string,
): { next: StudioAssetImages } | { error: string } {
  if (images.assetType === 'product') {
    if (roleKey === 'product') {
      return { next: { ...images, productImageIds: [...new Set([...images.productImageIds, refId])] } };
    }
    return { next: { ...images, packagingImageIds: [...new Set([...images.packagingImageIds, refId])] } };
  }
  if (images.assetType === 'location') {
    if (roleKey === 'master') return { next: { ...images, masterImageId: refId } };
    if (roleKey === 'scale_map') return { next: { ...images, scaleMapImageId: refId } };
    // reference: el schema de locación limita a 4 referencias adicionales. Sin
    // este tope, la 5ª caería en updateLocationAction y saldría un mensaje crudo
    // de Zod ("Array must contain at most 4 element(s)") en el toast.
    if (images.referenceImageIds.length >= LOCATION_REFERENCE_CAP && !images.referenceImageIds.includes(refId)) {
      return { error: 'La locación ya tiene 4 imágenes de referencia (máximo). Quita una desde el editor.' };
    }
    return { next: { ...images, referenceImageIds: [...new Set([...images.referenceImageIds, refId])] } };
  }
  // character
  if (roleKey === 'master') return { next: { ...images, masterImageId: refId } };
  if (roleKey === 'full_body') return { next: { ...images, fullBodyImageId: refId } };
  // angle: el schema del personaje limita a 2 ángulos.
  if (images.angleImageIds.length >= 2 && !images.angleImageIds.includes(refId)) {
    return { error: 'El personaje ya tiene 2 ángulos (máximo). Quita uno desde el editor.' };
  }
  return { next: { ...images, angleImageIds: [...new Set([...images.angleImageIds, refId])] } };
}
