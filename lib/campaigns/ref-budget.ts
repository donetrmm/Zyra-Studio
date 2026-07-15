// Presupuesto de imágenes de referencia por clip (spec multi-producto
// 2026-07-15). PURO y sin server-only: lo comparten buildReferences (el
// recorte real del compiler Seedance) y el badge del tablero (estimación
// client-side). ESTIMACIÓN: no cuenta cuerpo-completo/estados del cast (la UI
// no los conoce por clip); el recorte real y su warning viven en el compiler.

// Imágenes por producto según cuántos van en el clip: 1 → 3 (comportamiento
// single actual), 2 → 2, 3+ → 1 (la principal). Menos vistas por producto =
// menos confusión de conteo en Seedance (mitigación central del spec).
export function perProductImageCap(productCount: number): number {
  if (productCount <= 1) return 3;
  if (productCount === 2) return 2;
  return 1;
}

export type RefBudgetInput = {
  productImageCounts: number[];
  packagingImageCount: number;
  castCount: number;
  locationImageCount: number;
  hasScaleMap: boolean;
  extraCount: number;
};

export function estimateItemImageRefs(input: RefBudgetInput): number {
  const cap = perProductImageCap(input.productImageCounts.length);
  const products = input.productImageCounts.reduce((sum, n) => sum + Math.min(n, cap), 0);
  // Empaque solo en clips de un producto (en multi el recorte auto lo omite).
  const packaging = input.productImageCounts.length === 1 ? Math.min(input.packagingImageCount, 2) : 0;
  const castCount = Math.min(input.castCount, 3);
  const anglesPer = castCount >= 3 ? 0 : castCount === 2 ? 1 : 2;
  const cast = castCount + (castCount > 0 ? castCount * anglesPer : 0);
  return products + packaging + cast + input.locationImageCount + (input.hasScaleMap ? 1 : 0) + input.extraCount;
}
