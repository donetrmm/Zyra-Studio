import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { CampaignStudioWizard } from '@/components/campaigns/CampaignStudioWizard';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const [{ data: kits }, { count: characterCount }] = await Promise.all([
    supabase
      .from('brand_kits')
      .select('id, name, product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('characters')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id),
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

  return <CampaignStudioWizard brandKits={brandKits} hasCharacters={(characterCount ?? 0) > 0} />;
}
