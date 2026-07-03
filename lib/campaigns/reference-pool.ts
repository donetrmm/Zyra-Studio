import 'server-only';
// IO del pool del selector de referencias de video: junta los candidatos reales
// de la campaña (brand kit, cast, locaciones, extras) reusando los loaders del
// orquestador, y los aplana con buildReferencePool (puro). Lo consumen las
// server actions del selector (get/set).
import { createClient } from '@/lib/supabase/server';
import {
  loadCampaignContext,
  resolveLocations,
  resolvePaths,
  itemCharacterIds,
} from './orchestrator';
import { buildReferencePool, type ReferencePoolEntry } from './reference-selection';

export type ReferencePoolCampaignRow = {
  id: string;
  brand_kit_id: string | null;
  product_brief: Record<string, unknown> | null;
  language?: string | null;
  include_packaging?: boolean | null;
  music_ref_id?: string | null;
};

// Carga el pool de candidatos de la campaña. El caller ya validó ownership
// (workspace) de la campaña; aquí los loaders re-validan workspace por fila.
export async function loadReferencePool(
  workspaceId: string,
  campaign: ReferencePoolCampaignRow,
): Promise<ReferencePoolEntry[]> {
  const supabase = await createClient();
  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('character_id, character_ids, location_id, reference_ids')
    .eq('campaign_id', campaign.id);
  const items = itemRows ?? [];

  const characterIds = [
    ...new Set(
      items.flatMap((i) =>
        itemCharacterIds({
          character_id: (i.character_id as string | null) ?? null,
          character_ids: (i.character_ids as string[] | null) ?? null,
        }),
      ),
    ),
  ];
  const ctx = await loadCampaignContext(workspaceId, campaign, characterIds);

  const locationIds = [
    ...new Set(items.map((i) => i.location_id as string | null).filter((l): l is string => !!l)),
  ];
  const locations = await resolveLocations(supabase, workspaceId, locationIds);

  const extraRefIds = [...new Set(items.flatMap((i) => (i.reference_ids as string[] | null) ?? []))];
  const extraPaths = await resolvePaths(supabase, workspaceId, extraRefIds);

  return buildReferencePool({
    product: {
      name: ctx.productName,
      imagePaths: ctx.productImagePaths,
      imageUsages: ctx.productImageUsages,
    },
    packagingImagePaths: ctx.packagingImagePaths,
    characters: characterIds
      .map((id) => ctx.characters.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({
        name: c.name,
        masterImagePath: c.masterImagePath,
        angleImagePaths: c.angleImagePaths,
      })),
    locations: [...locations.values()].map((l) => ({
      name: l.name,
      imagePaths: l.imagePaths,
      scaleMap: l.scaleMap,
    })),
    extraImagePaths: [...extraPaths.values()],
  });
}
