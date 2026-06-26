import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import { BrandKitsPage } from '@/components/brand-kits/BrandKitsPage';

export const dynamic = 'force-dynamic';

export default async function BrandKitsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: kits } = await supabase
    .from('brand_kits')
    .select('id, name, colors, fonts, logo_url, tone_description, style_guidelines, product_image_ids, packaging_image_ids, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  // Previews firmados de las imágenes ya guardadas (producto + empaque).
  const allImageIds = [
    ...new Set(
      (kits ?? []).flatMap((k) => [
        ...((k.product_image_ids as string[]) ?? []),
        ...((k.packaging_image_ids as string[]) ?? []),
      ]),
    ),
  ];
  const previews: Record<string, string> = {};
  const usages: Record<string, string> = {};
  if (allImageIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, usage_description')
      .in('id', allImageIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (r.usage_description) usages[r.id as string] = r.usage_description as string;
        if (!r.storage_url) return;
        try {
          previews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
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

  return <BrandKitsPage kits={(kits ?? []) as never} previews={previews} usages={usages} angleCost={angleCost} />;
}
