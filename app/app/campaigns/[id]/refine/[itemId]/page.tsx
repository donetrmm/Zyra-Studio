import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { signedReferenceUrl } from '@/lib/supabase/storage';
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
    .select('id, name, product_brief, brand_kit_id, include_packaging')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) redirect('/app/campaigns');

  const { data: formats } = await supabase
    .from('formats')
    .select('id, name')
    .or(`is_system.eq.true,workspace_id.eq.${workspace.id}`);

  let draft: RefineDraft = emptyDraft(null);
  let itemCharacterIdsFromRow: string[] = [];
  if (itemId !== 'new') {
    const { data: item } = await supabase
      .from('campaign_items')
      .select('id, status, format_id, scene, scene_prompt, shot, character_id, character_ids, reference_ids, duration_s, aspect_ratio, caption')
      .eq('id', itemId)
      .eq('campaign_id', id)
      .single();
    if (!item || !['planned', 'skipped', 'failed'].includes(item.status as string)) {
      redirect(`/app/campaigns/${id}`);
    }
    // item is non-null here: redirect() returns never, so TS knows we continue only when item exists
    itemCharacterIdsFromRow = ((item.character_ids as string[] | null) ?? []).length
      ? (item.character_ids as string[])
      : item.character_id ? [item.character_id as string] : [];
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

  // Referencias heredadas (spec 2026-06-12 §7): lo que el video YA llevará
  // al generar — producto del Brand Kit, empaque y personajes del item.
  let productPreviews: Array<string | null> = [];
  let productCount = 0;
  let packagingCount = 0;
  if (campaign.brand_kit_id) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('id', campaign.brand_kit_id as string)
      .single();
    const productIds = ((kit?.product_image_ids as string[]) ?? []).length
      ? ((kit?.product_image_ids as string[]) ?? [])
      : ((kit?.reference_image_ids as string[]) ?? []);
    productCount = productIds.length;
    // El empaque solo cuenta si la campaña decidió incluirlo (032).
    packagingCount =
      campaign.include_packaging === false
        ? 0
        : ((kit?.packaging_image_ids as string[]) ?? []).length;
    const top = productIds.slice(0, 3);
    if (top.length) {
      const { data: refs } = await supabase
        .from('media_references')
        .select('id, storage_url')
        .in('id', top);
      const byId = new Map((refs ?? []).map((r) => [r.id as string, r.storage_url as string | null]));
      productPreviews = await Promise.all(
        top.map(async (refId) => {
          const url = byId.get(refId);
          if (!url) return null;
          try { return await signedReferenceUrl(url); } catch { return null; }
        }),
      );
    }
  }

  let inheritedCharacters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }> = [];
  if (itemCharacterIdsFromRow.length) {
    const { data: chars } = await supabase
      .from('characters')
      .select('id, name, master_image_id, angle_image_ids, reference_image_ids')
      .in('id', itemCharacterIdsFromRow)
      .eq('workspace_id', workspace.id);
    const ordered = itemCharacterIdsFromRow
      .map((cid) => (chars ?? []).find((c) => c.id === cid))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const masterIds = ordered
      .map((c) => (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null)
      .filter((m): m is string => !!m);
    const { data: masterRefs } = masterIds.length
      ? await supabase.from('media_references').select('id, storage_url').in('id', masterIds)
      : { data: [] as Array<{ id: string; storage_url: string | null }> };
    const masterById = new Map((masterRefs ?? []).map((r) => [r.id as string, r.storage_url as string | null]));
    inheritedCharacters = await Promise.all(
      ordered.map(async (c) => {
        const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null;
        let previewUrl: string | null = null;
        const url = masterId ? masterById.get(masterId) : null;
        if (url) {
          try { previewUrl = await signedReferenceUrl(url); } catch { /* sin preview */ }
        }
        return {
          id: c.id as string,
          name: c.name as string,
          previewUrl,
          angleCount: ((c.angle_image_ids as string[]) ?? []).length,
        };
      }),
    );
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
      inherited={{ productPreviews, productCount, packagingCount, characters: inheritedCharacters }}
    />
  );
}
