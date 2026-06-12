import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { RefineView } from '@/components/refine/RefineView';
import { emptyDraft, type RefineDraft } from '@/lib/refine/types';

export const dynamic = 'force-dynamic';

export default async function RefineRoute({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, product_brief')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) redirect('/app/campaigns');

  const { data: formats } = await supabase
    .from('formats')
    .select('id, name')
    .or(`is_system.eq.true,workspace_id.eq.${workspace.id}`);

  let draft: RefineDraft = emptyDraft(null);
  if (itemId !== 'new') {
    const { data: item } = await supabase
      .from('campaign_items')
      .select('id, status, format_id, scene, scene_prompt, shot, character_id, reference_ids, duration_s, aspect_ratio, caption')
      .eq('id', itemId)
      .eq('campaign_id', id)
      .single();
    if (!item || !['planned', 'skipped', 'failed'].includes(item.status as string)) {
      redirect(`/app/campaigns/${id}`);
    }
    // item is non-null here: redirect() returns never, so TS knows we continue only when item exists
    draft = {
      formatId: (item.format_id as string | null) ?? null,
      customFormat: null,
      scene: (item.scene as string | null) ?? null,
      scenePrompt: (item.scene_prompt as string) ?? '',
      shot: (item.shot as string | null) ?? null,
      characterId: (item.character_id as string | null) ?? null,
      referenceIds: ((item.reference_ids as string[]) ?? []),
      durationS: (item.duration_s as number | null) ?? null,
      aspectRatio: (item.aspect_ratio as string | null) ?? null,
      caption: (item.caption as string | null) ?? null,
    };
  }

  const brief = (campaign.product_brief ?? {}) as { productName?: string };
  return (
    <RefineView
      campaignId={id}
      campaignName={campaign.name as string}
      productName={brief.productName ?? 'tu producto'}
      itemId={itemId === 'new' ? null : itemId}
      initialDraft={draft}
      formatNames={Object.fromEntries((formats ?? []).map((f) => [f.id as string, f.name as string]))}
    />
  );
}
