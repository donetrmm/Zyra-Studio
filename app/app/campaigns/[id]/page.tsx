import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
import { CampaignDetailPage } from '@/components/campaigns/CampaignDetailPage';
import { CampaignStudioView, type StudioItem } from '@/components/campaigns/CampaignStudioView';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CampaignDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, description, color, created_at, status, goal, product_brief, credits_estimated, total_items')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();

  if (!campaign) redirect('/app/campaigns');

  const brief = (campaign.product_brief ?? null) as { productName?: string; category?: string } | null;

  // Campaña Studio (V2): tiene brief de producto → vista de plan/producción.
  if (brief?.productName) {
    const [{ data: itemRows }, { data: formatRows }, { data: characterRows }] = await Promise.all([
      supabase
        .from('campaign_items')
        .select('id, format_id, duration_s, aspect_ratio, scene, scene_prompt, character_id, scheduled_date, status, warnings')
        .eq('campaign_id', id)
        .order('scheduled_date'),
      supabase.from('formats').select('id, name'),
      supabase.from('characters').select('id, name').eq('workspace_id', workspace.id),
    ]);

    const formatNames = new Map((formatRows ?? []).map((f) => [f.id as string, f.name as string]));
    const characterNames = new Map((characterRows ?? []).map((c) => [c.id as string, c.name as string]));

    const items: StudioItem[] = (itemRows ?? []).map((r) => ({
      id: r.id as string,
      formatId: (r.format_id as string | null) ?? null,
      formatName: r.format_id ? (formatNames.get(r.format_id as string) ?? 'Formato') : 'Formato',
      durationS: (r.duration_s as number | null) ?? null,
      aspectRatio: (r.aspect_ratio as string | null) ?? null,
      scene: (r.scene as string | null) ?? null,
      scenePrompt: r.scene_prompt as string,
      characterName: r.character_id ? (characterNames.get(r.character_id as string) ?? null) : null,
      scheduledDate: (r.scheduled_date as string | null) ?? null,
      status: r.status as string,
      warnings: (r.warnings as string[]) ?? [],
    }));

    return (
      <CampaignStudioView
        campaign={{
          id: campaign.id as string,
          name: campaign.name as string,
          status: campaign.status as string,
          goal: (campaign.goal as string | null) ?? null,
          productName: brief.productName,
          category: brief.category ?? 'other',
          creditsEstimated: (campaign.credits_estimated as number | null) ?? null,
        }}
        initialItems={items}
      />
    );
  }

  // Campaña V1 (carpeta): grid de generaciones asignadas.
  const { data: generations } = await supabase
    .from('generations')
    .select('id, type, provider, model_id, prompt, status, thumbnail_url, credits_charged, created_at')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false });

  const gens = (generations ?? []).map((g) => ({
    id: g.id as string,
    type: g.type as string,
    prompt: (g.prompt as string) ?? '',
    status: g.status as string,
    thumbnailUrl: g.thumbnail_url ? publicThumbnailUrl(g.thumbnail_url as string) : null,
    credits: (g.credits_charged as number) ?? 0,
    createdAt: g.created_at as string,
  }));

  return (
    <CampaignDetailPage
      campaign={campaign as { id: string; name: string; description: string | null; color: string; created_at: string }}
      generations={gens}
    />
  );
}
