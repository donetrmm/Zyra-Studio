import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { CampaignStudioWizard } from '@/components/campaigns/CampaignStudioWizard';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [{ data: kits }, { data: characterRows }] = await Promise.all([
    supabase
      .from('brand_kits')
      .select('id, name, product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('characters')
      .select('id, name, master_image_id, angle_image_ids, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
  ]);

  const brandKits = (kits ?? [])
    .map((k) => {
      const productImages = ((k.product_image_ids as string[]) ?? []).length
        || ((k.reference_image_ids as string[]) ?? []).length;
      return {
        id: k.id as string,
        name: k.name as string,
        productImages,
        packagingImages: ((k.packaging_image_ids as string[]) ?? []).length,
      };
    })
    .filter((k) => k.productImages > 0);

  // Personajes utilizables: con hoja maestra (o primera referencia, compat V1).
  const usable = (characterRows ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      masterId: (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null,
      angleCount: ((c.angle_image_ids as string[]) ?? []).length,
    }))
    .filter((c) => c.masterId);

  const previews: Record<string, string> = {};
  const masterIds = usable.map((c) => c.masterId as string);
  if (masterIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url')
      .in('id', masterIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (!r.storage_url) return;
        try {
          previews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
        } catch {
          // sin preview
        }
      }),
    );
  }

  const characters = usable.map((c) => ({
    id: c.id,
    name: c.name,
    previewUrl: c.masterId ? (previews[c.masterId] ?? null) : null,
    angleCount: c.angleCount,
  }));

  return <CampaignStudioWizard brandKits={brandKits} characters={characters} />;
}
