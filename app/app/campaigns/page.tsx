import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { CampaignsPage } from '@/components/campaigns/CampaignsPage';

export const dynamic = 'force-dynamic';

export default async function CampaignsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const [campaignsRes, countsRes] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, name, description, color, created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('generations')
      .select('campaign_id')
      .eq('workspace_id', workspace.id)
      .not('campaign_id', 'is', null),
  ]);

  const countMap = new Map<string, number>();
  for (const g of countsRes.data ?? []) {
    const cid = g.campaign_id as string;
    countMap.set(cid, (countMap.get(cid) ?? 0) + 1);
  }

  const campaigns = (campaignsRes.data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    description: (c.description as string | null) ?? null,
    color: c.color as string,
    created_at: c.created_at as string,
    generationCount: countMap.get(c.id as string) ?? 0,
  }));

  return <CampaignsPage campaigns={campaigns} />;
}
