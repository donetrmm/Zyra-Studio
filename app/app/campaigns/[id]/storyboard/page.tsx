import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import { StoryboardView } from '@/components/campaigns/StoryboardView';
import type { StoryboardBeat } from '@/lib/campaigns/storyboard-types';
import { buildCreatives, type CreativeRow } from '@/lib/campaigns/storyboard-creatives';

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
    .select('id, scene_index, scene_prompt, storyboard_image_id, location_id, duration_s, sequence_id, sequence_label, format_id, created_at, warnings')
    .eq('campaign_id', id)
    .order('scene_index');

  const rows = itemRows ?? [];

  // Nombres de formato para etiquetar los creativos sueltos (sin secuencia).
  const formatIds = [
    ...new Set(rows.map((r) => r.format_id as string | null).filter((v): v is string => v !== null)),
  ];
  const formatNames = new Map<string, string>();
  if (formatIds.length > 0) {
    const { data: formats } = await supabase.from('formats').select('id, name').in('id', formatIds);
    for (const f of formats ?? []) formatNames.set(f.id as string, f.name as string);
  }

  // Catálogo de locaciones del workspace (la locación actual se deriva por creativo en el view).
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
    locationId: (r.location_id as string | null) ?? null,
    warnings: (r.warnings as string[] | null) ?? [],
  }));

  // Agrupar los beats en creativos (secuencia o item suelto) para el selector.
  const creativeRows: CreativeRow[] = rows.map((r) => ({
    id: r.id as string,
    sequenceId: (r.sequence_id as string | null) ?? null,
    sequenceLabel: (r.sequence_label as string | null) ?? null,
    formatName: r.format_id ? (formatNames.get(r.format_id as string) ?? null) : null,
    scenePrompt: (r.scene_prompt as string) ?? '',
    sceneIndex: (r.scene_index as number) ?? 0,
    createdAt: (r.created_at as string | null) ?? '',
  }));
  const creatives = buildCreatives(creativeRows);

  const language = (campaign.language === 'en' ? 'en' : 'es') as 'es' | 'en';

  // Costo en creditos por panel para mostrarlo en los botones ANTES de generar.
  // Slugs/variant = mirror de server-actions/storyboard.ts (genera con Nano Banana Pro
  // a 2k). fresh = panel nuevo (conversational:false); chained = regenerar/refinar un
  // panel existente, que pasa por el turno previo (conversational:true, 1.5x).
  let panelCostFresh: number | null = null;
  let panelCostChained: number | null = null;
  try {
    const pricing = await loadPricing();
    const nano = (conversational: boolean) =>
      estimateCredits(pricing, {
        provider: 'nano-banana',
        model: 'gemini-3-pro-image-preview',
        variant: '2k',
        params: { conversational },
      }).total;
    panelCostFresh = nano(false);
    panelCostChained = nano(true);
  } catch {
    // Sin pricing no mostramos costo (los botones siguen funcionando).
  }

  return (
    <StoryboardView
      campaignId={id}
      campaignName={campaign.name as string}
      beats={beats}
      creatives={creatives}
      locations={locations}
      language={language}
      panelCostFresh={panelCostFresh}
      panelCostChained={panelCostChained}
    />
  );
}
