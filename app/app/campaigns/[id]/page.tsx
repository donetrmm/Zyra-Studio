import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
import { CampaignDetailPage } from '@/components/campaigns/CampaignDetailPage';
import {
  CampaignStudioView,
  type StudioItem,
  type StudioTemplate,
} from '@/components/campaigns/CampaignStudioView';
import { toStudioItem } from '@/lib/campaigns/studio-item';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CampaignDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
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
  // Excepción: `?view=assets` (entrada desde Biblioteca › Colecciones) muestra
  // las generaciones de la campaña, no el pipeline.
  if (brief?.productName && view !== 'assets') {
    const [{ data: itemRows }, { data: formatRows }, { data: characterRows }, { data: templateRows }] =
      await Promise.all([
        supabase
          .from('campaign_items')
          .select('id, format_id, template_id, duration_s, aspect_ratio, scene, scene_prompt, scene_summary, caption, character_id, character_ids, scheduled_date, status, warnings, generation_id, is_winner, sequence_id, scene_index, sequence_label')
          .eq('campaign_id', id)
          .order('scheduled_date'),
        supabase.from('formats').select('id, name, description'),
        supabase.from('characters').select('id, name').eq('workspace_id', workspace.id),
        supabase
          .from('creative_templates')
          .select('id, name, format_id, uses_count')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false }),
      ]);

    const formatNames = new Map((formatRows ?? []).map((f) => [f.id as string, f.name as string]));
    const formatDescriptions = new Map(
      (formatRows ?? []).map((f) => [f.id as string, (f.description as string | null) ?? '']),
    );
    const characterNameById = new Map((characterRows ?? []).map((c) => [c.id as string, c.name as string]));

    const items: StudioItem[] = (itemRows ?? []).map((r) =>
      toStudioItem(r, formatNames, formatDescriptions, characterNameById),
    );

    const templates: StudioTemplate[] = (templateRows ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      formatName: t.format_id ? (formatNames.get(t.format_id as string) ?? 'Formato') : 'Formato',
      usesCount: (t.uses_count as number) ?? 0,
    }));

    const characterOptions = (characterRows ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
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
        templates={templates}
        characterOptions={characterOptions}
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
