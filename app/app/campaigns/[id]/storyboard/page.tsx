import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { StoryboardView } from '@/components/campaigns/StoryboardView';

export const dynamic = 'force-dynamic';

export type StoryboardBeat = {
  id: string;
  sceneIndex: number;
  scenePrompt: string;
  storyboardImageId: string | null;
  panelUrl: string | null;
};

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();

  if (!campaign) redirect('/app/campaigns');

  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('id, scene_index, scene_prompt, storyboard_image_id')
    .eq('campaign_id', id)
    .order('scene_index');

  const rows = itemRows ?? [];

  // Resolver URLs de paneles: storyboard_image_id -> media_references.storage_url -> signed URL
  const imageIds = rows
    .map((r) => r.storyboard_image_id as string | null)
    .filter((v): v is string => v !== null);

  const refMap = new Map<string, string>();
  if (imageIds.length > 0) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url')
      .in('id', imageIds);
    for (const ref of refs ?? []) {
      if (ref.storage_url) {
        try {
          const url = await signedReferenceUrl(ref.storage_url as string);
          refMap.set(ref.id as string, url);
        } catch {
          // silent — panel mostrará placeholder
        }
      }
    }
  }

  const beats: StoryboardBeat[] = rows.map((r) => ({
    id: r.id as string,
    sceneIndex: (r.scene_index as number) ?? 0,
    scenePrompt: (r.scene_prompt as string) ?? '',
    storyboardImageId: (r.storyboard_image_id as string | null) ?? null,
    panelUrl: r.storyboard_image_id ? (refMap.get(r.storyboard_image_id as string) ?? null) : null,
  }));

  return (
    <StoryboardView
      campaignId={id}
      campaignName={campaign.name as string}
      beats={beats}
    />
  );
}
