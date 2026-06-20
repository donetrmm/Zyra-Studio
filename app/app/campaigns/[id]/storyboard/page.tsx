import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { StoryboardView } from '@/components/campaigns/StoryboardView';
import type { StoryboardBeat } from '@/lib/campaigns/storyboard-types';

export const dynamic = 'force-dynamic';

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
    .select('id, name, language')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();

  if (!campaign) redirect('/app/campaigns');

  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('id, scene_index, scene_prompt, storyboard_image_id, location_id, duration_s')
    .eq('campaign_id', id)
    .order('scene_index');

  const rows = itemRows ?? [];

  // Locación actual del storyboard (compartida por los beats) + catálogo del workspace.
  const currentLocationId =
    (rows.find((r) => r.location_id)?.location_id as string | null | undefined) ?? null;
  const { data: locationRows } = await supabase
    .from('locations')
    .select('id, name')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false });
  const locations = (locationRows ?? []).map((l) => ({ id: l.id as string, name: l.name as string }));

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
    durationS: (r.duration_s as number | null) ?? 8,
  }));

  const language = (campaign.language === 'en' ? 'en' : 'es') as 'es' | 'en';

  return (
    <StoryboardView
      campaignId={id}
      campaignName={campaign.name as string}
      beats={beats}
      locations={locations}
      currentLocationId={currentLocationId}
      language={language}
    />
  );
}
