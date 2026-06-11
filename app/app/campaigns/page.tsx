import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { fetchCampaignSummaries } from '@/lib/campaigns/summary';
import { CampaignsPage } from '@/components/campaigns/CampaignsPage';

export const dynamic = 'force-dynamic';

// Lista solo campañas studio (con brief de producto). Las carpetas V1 son
// "Colecciones" y viven en la Biblioteca (specs/v2/06 §4.3).
export default async function CampaignsRoute() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const campaigns = await fetchCampaignSummaries(supabase, workspace.id);
  return <CampaignsPage campaigns={campaigns} />;
}
