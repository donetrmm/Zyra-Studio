import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import { BrandKitsPage } from '@/components/brand-kits/BrandKitsPage';
import type { ProductView } from '@/components/products/ProductEditor';

export const dynamic = 'force-dynamic';

export default async function BrandKitsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const [{ data: kits }, { data: products }] = await Promise.all([
    supabase
      .from('brand_kits')
      .select('id, name, colors, fonts, logo_url, tone_description, style_guidelines, created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('products')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
  ]);

  // Normaliza null -> [] en los arrays de imágenes (la fila cruda de products
  // puede traerlos null) para que el consumo en UI no tenga que narrowear.
  const productViews: ProductView[] = (products ?? []).map((p) => ({
    id: p.id as string,
    brand_id: (p.brand_id as string | null) ?? null,
    name: p.name as string,
    slug: (p.slug as string | null) ?? null,
    medium: (p.medium as string | null) ?? null,
    height_cm: (p.height_cm as number | null) ?? null,
    width_cm: (p.width_cm as number | null) ?? null,
    thickness_mm: (p.thickness_mm as number | null) ?? null,
    weight_kg: (p.weight_kg as number | null) ?? null,
    visual_details: (p.visual_details as string | null) ?? null,
    palette: (p.palette as string[] | null) ?? null,
    product_image_ids: (p.product_image_ids as string[] | null) ?? [],
    packaging_image_ids: (p.packaging_image_ids as string[] | null) ?? [],
  }));

  // Previews + usage_description de las imágenes de producto/empaque de TODOS
  // los productos del workspace (el kit, desde V3 Fase 2, ya no guarda
  // imágenes propias — solo identidad de marca — así que el único set de
  // previews que resta resolver es el de los productos anidados).
  const productImageIds = [
    ...new Set(
      productViews.flatMap((p) => [...p.product_image_ids, ...p.packaging_image_ids]),
    ),
  ];
  const productPreviews: Record<string, string> = {};
  const productUsages: Record<string, string> = {};
  if (productImageIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, usage_description')
      .in('id', productImageIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (r.usage_description) productUsages[r.id as string] = r.usage_description as string;
        if (!r.storage_url) return;
        try {
          productPreviews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
        } catch {
          // sin preview: el uploader muestra placeholder
        }
      }),
    );
  }

  // R12: costo de "Generar vista 3/4 del producto" (va por editUploaded -> Nano Banana
  // 2k; mirror de components/creation/generate.ts). null si falla el pricing.
  let angleCost: number | null = null;
  try {
    const pricing = await loadPricing();
    angleCost = estimateCredits(pricing, {
      provider: 'nano-banana',
      model: 'gemini-3-pro-image-preview',
      variant: '2k',
      params: { conversational: false },
    }).total;
  } catch {
    angleCost = null;
  }

  return (
    <BrandKitsPage
      kits={(kits ?? []) as never}
      angleCost={angleCost}
      products={productViews}
      productPreviews={productPreviews}
      productUsages={productUsages}
    />
  );
}
