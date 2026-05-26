import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { BrandKitsPage } from '@/components/brand-kits/BrandKitsPage';

export const dynamic = 'force-dynamic';

export default async function BrandKitsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: kits } = await supabase
    .from('brand_kits')
    .select('id, name, colors, fonts, logo_url, tone_description, style_guidelines, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  return <BrandKitsPage kits={kits ?? []} />;
}
