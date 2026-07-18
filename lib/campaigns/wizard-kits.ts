// Opciones de Brand Kit para el wizard de campaña nueva.
//
// Bug 2026-07-14: el contador "N img producto" del dropdown solo miraba las
// imágenes legacy del kit (product_image_ids / reference_image_ids). En V3
// las imágenes viven en la entidad `products`, así que un kit nuevo con
// productos reales mostraba "0 img producto" y el aviso ámbar de kit sin
// productos. El filtro de usabilidad sí era V3-aware; el contador no.
//
// El orden del conteo espeja la prioridad del análisis en
// createCampaignStudioAction: legacy product > referencias generales >
// imágenes de los productos V3 del pool.

export type WizardKitRow = {
  id: string;
  name: string;
  product_image_ids: string[] | null;
  packaging_image_ids: string[] | null;
  reference_image_ids: string[] | null;
};

export type WizardProductOption = {
  id: string;
  name: string;
  imageCount: number;
};

export type WizardKitOption = {
  id: string;
  name: string;
  productImages: number;
  packagingImages: number;
};

export function buildWizardKitOptions(
  kits: WizardKitRow[],
  productsByKit: Record<string, WizardProductOption[]>,
): WizardKitOption[] {
  return kits
    .map((k) => {
      const v3ImageSum = (productsByKit[k.id] ?? []).reduce(
        (acc, p) => acc + p.imageCount,
        0,
      );
      const productImages =
        (k.product_image_ids ?? []).length ||
        (k.reference_image_ids ?? []).length ||
        v3ImageSum;
      return {
        id: k.id,
        name: k.name,
        productImages,
        packagingImages: (k.packaging_image_ids ?? []).length,
      };
    })
    // Un kit es usable si la marca tiene >=1 producto (V3) o si conserva
    // imágenes legacy que alimenten el análisis.
    .filter((k) => (productsByKit[k.id]?.length ?? 0) > 0 || k.productImages > 0);
}
