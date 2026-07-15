import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { StudioAssetImages } from '@/components/studio/types';

type StudioSupabase = Awaited<ReturnType<typeof createClient>>;

export type PanelAssetInput = {
  name: string;
  panelImageId: string | null;
  beatReferenceIds: string[];
  scenePrompt: string;
  aspectRatio: string | null;
};

export type PanelAssetLoad = {
  assetImages: Extract<StudioAssetImages, { assetType: 'panel' }>;
  name: string;
  campaignId: string;
  // Base de edición del primer turno (gen del panel vigente); null si el panel
  // se subió a mano (sin generación) o no hay panel.
  workingGenerationId: string | null;
  scenePrompt: string;
  aspectRatio: string | null;
};

// Arma la variante 'panel' de StudioAssetImages. cleanReferenceIds = el panel
// actual (si existe) primero, luego las refs limpias del beat, dedup y sin null,
// preservando el orden. El panel va primero para que, en un panel subido a mano
// (sin generación base), siga a mano en el selector de referencias.
export function buildPanelAssetImages(
  input: PanelAssetInput,
): Extract<StudioAssetImages, { assetType: 'panel' }> {
  const ordered = [
    ...(input.panelImageId ? [input.panelImageId] : []),
    ...input.beatReferenceIds,
  ];
  const cleanReferenceIds = [...new Set(ordered)];
  return {
    assetType: 'panel',
    name: input.name,
    panelImageId: input.panelImageId,
    cleanReferenceIds,
    scenePrompt: input.scenePrompt,
    aspectRatio: input.aspectRatio,
  };
}

// Carga un beat (campaign_item) como "activo panel" del estudio, validando que la
// campaña sea del workspace. Reúne las refs LIMPIAS del beat como media_reference
// ids directamente de las entidades (producto/personaje/locación): no re-corre la
// resolución completa del generador de panel — es seeding de conveniencia, no la
// compilación. El panel vigente sale de storyboard_image_id.
export async function loadPanelAsset(
  supabase: StudioSupabase,
  workspaceId: string,
  itemId: string,
): Promise<PanelAssetLoad | null> {
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, scene_index, scene_prompt, aspect_ratio, character_id, character_ids, location_id, product_ids, storyboard_image_id, storyboard_generation_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return null;

  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, workspace_id')
    .eq('id', item.campaign_id as string)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!camp) return null;

  const beatReferenceIds: string[] = [];

  // Productos de ESTE clip (multi-producto 2026-07-15): imágenes + empaque de
  // cada uno; los caps de refs los aplican los compilers de imagen aguas abajo.
  const productIds = ((item.product_ids as string[] | null) ?? []).filter(Boolean);
  if (productIds.length > 0) {
    const { data: productRows } = await supabase
      .from('products')
      .select('id, product_image_ids, packaging_image_ids')
      .in('id', productIds);
    for (const pid of productIds) {
      const product = (productRows ?? []).find((r) => r.id === pid);
      if (!product) continue;
      beatReferenceIds.push(...((product.product_image_ids as string[] | null) ?? []));
      beatReferenceIds.push(...((product.packaging_image_ids as string[] | null) ?? []));
    }
  }

  // Personajes: maestra + ángulos + cuerpo completo (masters limpios para re-anclar).
  const characterIds: string[] = (item.character_ids as string[] | null)?.length
    ? (item.character_ids as string[]).slice(0, 3)
    : item.character_id
      ? [item.character_id as string]
      : [];
  if (characterIds.length > 0) {
    const { data: chars } = await supabase
      .from('characters')
      .select('master_image_id, angle_image_ids, full_body_image_id')
      .in('id', characterIds)
      .eq('workspace_id', workspaceId);
    for (const ch of chars ?? []) {
      if (ch.master_image_id) beatReferenceIds.push(ch.master_image_id as string);
      beatReferenceIds.push(...((ch.angle_image_ids as string[] | null) ?? []));
      if (ch.full_body_image_id) beatReferenceIds.push(ch.full_body_image_id as string);
    }
  }

  // Locación: maestra + referencias.
  if (item.location_id) {
    const { data: loc } = await supabase
      .from('locations')
      .select('master_image_id, reference_image_ids')
      .eq('id', item.location_id as string)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (loc) {
      if (loc.master_image_id) beatReferenceIds.push(loc.master_image_id as string);
      beatReferenceIds.push(...((loc.reference_image_ids as string[] | null) ?? []));
    }
  }

  const name = `Panel ${((item.scene_index as number | null) ?? 0) + 1}`;
  const assetImages = buildPanelAssetImages({
    name,
    panelImageId: (item.storyboard_image_id as string | null) ?? null,
    beatReferenceIds,
    scenePrompt: (item.scene_prompt as string | null) ?? '',
    aspectRatio: (item.aspect_ratio as string | null) ?? null,
  });

  return {
    assetImages,
    name,
    campaignId: item.campaign_id as string,
    workingGenerationId: (item.storyboard_generation_id as string | null) ?? null,
    scenePrompt: (item.scene_prompt as string | null) ?? '',
    aspectRatio: (item.aspect_ratio as string | null) ?? null,
  };
}
