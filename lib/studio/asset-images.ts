import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { StudioAssetImages, StudioAssetType } from '@/components/studio/types';

type StudioSupabase = Awaited<ReturnType<typeof createClient>>;

// Carga el activo (product/location/character) y arma el StudioAssetImages con
// el MISMO shape que persiste su update action (loc/char = entidad completa,
// porque updateLocationAction/updateCharacterAction hacen upsert de todo el
// registro). Loader compartido por la page (snapshot inicial) y por
// attachStudioImageAction (re-lectura fresca justo antes de fusionar, para no
// revertir un cambio externo hecho mientras el estudio estaba abierto).
export async function loadStudioAsset(
  supabase: StudioSupabase,
  workspaceId: string,
  assetType: StudioAssetType,
  assetId: string,
): Promise<{ assetImages: StudioAssetImages; name: string } | null> {
  if (assetType === 'product') {
    const { data: product } = await supabase
      .from('products')
      .select('id, name, product_image_ids, packaging_image_ids')
      .eq('id', assetId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!product) return null;
    const name = (product.name as string | null) ?? 'Producto';
    const productImageIds = (product.product_image_ids as string[] | null) ?? [];
    const packagingImageIds = (product.packaging_image_ids as string[] | null) ?? [];
    return {
      name,
      assetImages: { assetType: 'product', productImageIds, packagingImageIds },
    };
  }

  if (assetType === 'location') {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, name, description, master_image_id, reference_image_ids, scale_map_image_id, scale_map_notes')
      .eq('id', assetId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!loc) return null;
    const name = (loc.name as string | null) ?? 'Locación';
    return {
      name,
      assetImages: {
        assetType: 'location',
        name,
        description: (loc.description as string | null) ?? null,
        masterImageId: (loc.master_image_id as string | null) ?? null,
        referenceImageIds: (loc.reference_image_ids as string[] | null) ?? [],
        scaleMapImageId: (loc.scale_map_image_id as string | null) ?? null,
        scaleMapNotes: (loc.scale_map_notes as string | null) ?? null,
      },
    };
  }

  // character
  const { data: ch } = await supabase
    .from('characters')
    .select('id, name, description, master_image_id, angle_image_ids, full_body_image_id, voice_clone_id')
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!ch) return null;
  const name = (ch.name as string | null) ?? 'Personaje';
  return {
    name,
    assetImages: {
      assetType: 'character',
      name,
      description: (ch.description as string | null) ?? null,
      masterImageId: (ch.master_image_id as string | null) ?? null,
      angleImageIds: (ch.angle_image_ids as string[] | null) ?? [],
      fullBodyImageId: (ch.full_body_image_id as string | null) ?? null,
      voiceCloneId: (ch.voice_clone_id as string | null) ?? null,
    },
  };
}

// ids de imágenes ya asociadas al activo, para ofrecerlas como referencia en
// el compositor del estudio (page.tsx arma availableReferences a partir de esto).
export function imageIdsFromAssetImages(a: StudioAssetImages): string[] {
  if (a.assetType === 'product') return [...a.productImageIds, ...a.packagingImageIds];
  if (a.assetType === 'location') {
    return [a.masterImageId, ...a.referenceImageIds, a.scaleMapImageId].filter((x): x is string => !!x);
  }
  if (a.assetType === 'panel') return a.cleanReferenceIds;
  return [a.masterImageId, ...a.angleImageIds, a.fullBodyImageId].filter((x): x is string => !!x);
}
