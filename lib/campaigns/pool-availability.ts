// Disponibilidad de referencias desde el pool de productos de la campaña
// (V3). En kits nuevos las imágenes de producto/empaque viven en la entidad
// `products`, no en el kit: sin este fallback, generatePlanAction dejaba
// available.product=false y el plan dirigido bloqueaba TODOS los formatos con
// producto aunque la campaña tuviera productos reales (bug 2026-07-14, mismo
// patrón de migración parcial que el contador del wizard).

export type PoolProductImages = {
  product_image_ids: string[] | null;
  packaging_image_ids: string[] | null;
};

export type RefAvailability = { product: boolean; packaging: boolean };

export function applyPoolAvailability(params: {
  pool: PoolProductImages[];
  includePackaging: boolean;
  available: RefAvailability;
  matcherProductImageId: string | null;
}): { available: RefAvailability; matcherProductImageId: string | null } {
  const available = { ...params.available };
  let matcherProductImageId = params.matcherProductImageId;
  for (const p of params.pool) {
    const productImgs = p.product_image_ids ?? [];
    if (productImgs.length > 0) {
      if (!available.product) available.product = true;
      // El matcher necesita VER el producto: primera imagen del primer
      // producto del pool (orden de enlace en la campaña).
      if (!matcherProductImageId) matcherProductImageId = productImgs[0];
    }
    if (
      params.includePackaging &&
      !available.packaging &&
      (p.packaging_image_ids ?? []).length > 0
    ) {
      available.packaging = true;
    }
  }
  return { available, matcherProductImageId };
}
