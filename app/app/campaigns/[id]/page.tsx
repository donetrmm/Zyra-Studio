import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { publicThumbnailUrl } from '@/lib/supabase/storage';
import { CampaignDetailPage } from '@/components/campaigns/CampaignDetailPage';
import {
  CampaignStudioView,
  type StudioItem,
  type StudioTemplate,
} from '@/components/campaigns/CampaignStudioView';
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

    const items: StudioItem[] = (itemRows ?? []).map((r) => ({
      id: r.id as string,
      formatId: (r.format_id as string | null) ?? null,
      formatName: r.format_id ? (formatNames.get(r.format_id as string) ?? 'Formato') : 'Formato',
      formatDescription: r.format_id ? (formatDescriptions.get(r.format_id as string) ?? '') : '',
      templateId: (r.template_id as string | null) ?? null,
      durationS: (r.duration_s as number | null) ?? null,
      aspectRatio: (r.aspect_ratio as string | null) ?? null,
      scene: (r.scene as string | null) ?? null,
      scenePrompt: r.scene_prompt as string,
      sceneSummary: (r.scene_summary as string | null) ?? null,
      caption: (r.caption as string | null) ?? null,
      characterNames: ((r.character_ids as string[] | null) ?? (r.character_id ? [r.character_id as string] : []))
        .map((id) => characterNameById.get(id))
        .filter((n): n is string => !!n),
      scheduledDate: (r.scheduled_date as string | null) ?? null,
      status: r.status as string,
      warnings: (r.warnings as string[]) ?? [],
      generationId: (r.generation_id as string | null) ?? null,
      isWinner: (r.is_winner as boolean) ?? false,
      sequenceId: (r.sequence_id as string | null) ?? null,
      sceneIndex: (r.scene_index as number | null) ?? null,
      sequenceLabel: (r.sequence_label as string | null) ?? null,
    }));

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
