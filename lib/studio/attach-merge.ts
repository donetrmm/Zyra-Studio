import type { StudioAssetImages, StudioAssetType } from '@/components/studio/types';

// Roles válidos por tipo de activo — fuente única de verdad de las keys.
// attachStudioImageAction la usa para rechazar un rol desconocido antes de
// tocar la BD; los botones de AttachDialog (ROLES_BY_TYPE, con iconos) usan
// las mismas keys.
export const ATTACH_ROLES: Record<StudioAssetType, readonly string[]> = {
  product: ['product', 'packaging'],
  location: ['master', 'reference', 'scale_map'],
  character: ['master', 'angle', 'full_body'],
};

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
