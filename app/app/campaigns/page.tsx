import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { CampaignsPage } from '@/components/campaigns/CampaignsPage';

export const dynamic = 'force-dynamic';

export default async function CampaignsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, description, color, created_at')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });

  return <CampaignsPage campaigns={campaigns ?? []} />;
}
