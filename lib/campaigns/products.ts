// Lógica PURA de products (sin IO; el IO vive en orchestrator.ts). Espeja el par
// reference-selection.ts (puro) / reference-pool.ts (IO). NO importar 'server-only'.
import type { ProductInventory } from '@/lib/prompt-director/types';

export type ProductRow = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  name: string;
  slug: string | null;
  medium: string | null;
  height_cm: number | null;
  width_cm: number | null;
  thickness_mm: number | null;
  weight_kg: number | null;
  visual_details: string | null;
  palette: string[] | null;
  product_image_ids: string[] | null;
  packaging_image_ids: string[] | null;
};

// Mapea una fila `products` + paths ya resueltos → ProductInventory, idéntico al
// mapeo product.* de directorContextFor, para que la resolución por-clip sea
// indistinguible de la de campaña.
export function productInventoryFromRow(
  row: ProductRow,
  resolved: { imagePaths: string[]; packagingImagePaths?: string[]; imageUsages?: Record<string, string> },
): ProductInventory {
  return {
    name: row.name || 'the product',
    ...(row.visual_details ? { visualDetails: row.visual_details } : {}),
    ...(row.palette && row.palette.length ? { palette: row.palette } : {}),
    imagePaths: resolved.imagePaths,
    ...(resolved.imageUsages && Object.keys(resolved.imageUsages).length ? { imageUsages: resolved.imageUsages } : {}),
    ...(row.height_cm != null ? { heightCm: row.height_cm } : {}),
    ...(row.width_cm != null ? { widthCm: row.width_cm } : {}),
    ...(row.medium ? { medium: row.medium } : {}),
    ...(row.thickness_mm != null ? { thicknessMm: row.thickness_mm } : {}),
    ...(row.weight_kg != null ? { weightKg: row.weight_kg } : {}),
    ...(resolved.packagingImagePaths && resolved.packagingImagePaths.length
      ? { packagingImagePaths: resolved.packagingImagePaths }
      : {}),
  };
}
