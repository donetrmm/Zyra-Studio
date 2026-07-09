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
  resolveItemProduct,
  itemCharacterIds,
} from './orchestrator';
import {
  buildReferencePool,
  buildReferencePoolTexts,
  type ReferencePoolEntry,
  type ReferencePoolTexts,
} from './reference-selection';

export type ReferencePoolCampaignRow = {
  id: string;
  brand_kit_id: string | null;
  product_brief: Record<string, unknown> | null;
  language?: string | null;
  include_packaging?: boolean | null;
  music_ref_id?: string | null;
  // Vestuario (specs/v2/16): la fila viaja tal cual a loadCampaignContext, así
  // que el ctx del pool queda completo (el pool hoy no consume el map, pero un
  // ctx parcial aquí sería una fuente silenciosa de drift si empieza a hacerlo).
  character_outfit_map?: Record<string, unknown> | null;
};

// Carga el pool de candidatos de la campaña + las cláusulas de texto que anclan
// identidad (para el dialog del storyboard). El caller ya validó ownership
// (workspace) de la campaña; aquí los loaders re-validan workspace por fila.
export async function loadReferencePool(
  workspaceId: string,
  campaign: ReferencePoolCampaignRow,
): Promise<{ entries: ReferencePoolEntry[]; texts: ReferencePoolTexts }> {
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

  const usedCharacters = characterIds
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  return assemblePool({
    productName: ctx.productName,
    visualDetails: ctx.visualDetails,
    palette: ctx.palette,
    productImagePaths: ctx.productImagePaths,
    productImageUsages: ctx.productImageUsages,
    packagingImagePaths: ctx.packagingImagePaths,
    productMedium: ctx.productMedium,
    productThicknessMm: ctx.productThicknessMm,
    productHeightCm: ctx.productHeightCm,
    productWidthCm: ctx.productWidthCm,
    productWeightKg: ctx.productWeightKg,
    characters: usedCharacters.map((c) => ({
      name: c.name,
      description: c.description,
      masterImagePath: c.masterImagePath,
      angleImagePaths: c.angleImagePaths,
    })),
    locations,
    extraImagePaths: [...extraPaths.values()],
  });
}

// Arma { entries, texts } a partir de los activos YA RESUELTOS (producto, cast,
// locaciones, extras) — el único punto que llama a buildReferencePool /
// buildReferencePoolTexts, para que loadReferencePool (campaña) y
// loadItemReferencePool (clip) no diverjan en cómo aplanan el pool. Los
// resolvers (resolvePaths/resolveLocations/resolveItemProduct) siguen viviendo
// en orchestrator.ts; esto solo evita duplicar el ensamblaje final.
function assemblePool(input: {
  productName: string;
  visualDetails?: string;
  palette?: string[];
  productImagePaths: string[];
  productImageUsages?: Record<string, string>;
  packagingImagePaths: string[];
  productMedium?: string;
  productThicknessMm?: number;
  productHeightCm?: number;
  productWidthCm?: number;
  productWeightKg?: number;
  characters: { name: string; description: string; masterImagePath: string; angleImagePaths: string[] }[];
  locations: Awaited<ReturnType<typeof resolveLocations>>;
  extraImagePaths: string[];
}): { entries: ReferencePoolEntry[]; texts: ReferencePoolTexts } {
  const entries = buildReferencePool({
    product: {
      name: input.productName,
      imagePaths: input.productImagePaths,
      imageUsages: input.productImageUsages,
    },
    packagingImagePaths: input.packagingImagePaths,
    characters: input.characters.map((c) => ({
      name: c.name,
      masterImagePath: c.masterImagePath,
      angleImagePaths: c.angleImagePaths,
    })),
    locations: [...input.locations.values()].map((l) => ({
      name: l.name,
      imagePaths: l.imagePaths,
      scaleMap: l.scaleMap,
    })),
    extraImagePaths: input.extraImagePaths,
  });

  const texts = buildReferencePoolTexts({
    product: input.productName
      ? {
          name: input.productName,
          visualDetails: input.visualDetails,
          palette: input.palette,
          imagePaths: input.productImagePaths,
          medium: input.productMedium,
          thicknessMm: input.productThicknessMm,
          heightCm: input.productHeightCm,
          widthCm: input.productWidthCm,
          weightKg: input.productWeightKg,
        }
      : null,
    characters: input.characters.map((c) => ({
      name: c.name,
      description: c.description,
      masterImagePath: c.masterImagePath,
    })),
    locations: [...input.locations.values()].map((l) => ({ name: l.name, description: l.description })),
  });

  return { entries, texts };
}

// Carga el pool de candidatos SCOPEADO AL ÍTEM (V3 fase 4): producto/cast/
// locación/extras de ESTE clip, no un agregado de toda la campaña. Espeja
// loadReferencePool pero cada categoría lee solo lo que trae el ítem:
// - Producto: item.product_id vía resolveItemProduct; si no hay asignación (o
//   el id ya no resuelve — producto borrado/de otro workspace) cae al producto
//   de campaña (mismo fallback que directorContextFor en la generación real).
// - Cast: solo el cast del ítem (item.character_ids + el character_id legacy que
//   itemCharacterIds honra, igual que loadReferencePool; máx 3, cap compartido).
// - Locación: solo item.location_id (una, no todas las de la campaña).
// - Extras: solo item.reference_ids.
// El caller ya validó ownership (workspace) del ítem/campaña.
export async function loadItemReferencePool(
  workspaceId: string,
  campaign: ReferencePoolCampaignRow,
  item: {
    product_id: string | null;
    location_id: string | null;
    character_id: string | null;
    character_ids: string[] | null;
    reference_ids: string[] | null;
  },
): Promise<{ entries: ReferencePoolEntry[]; texts: ReferencePoolTexts }> {
  const supabase = await createClient();

  const characterIds = itemCharacterIds({ character_id: item.character_id, character_ids: item.character_ids });
  const ctx = await loadCampaignContext(workspaceId, campaign, characterIds);
  const usedCharacters = characterIds
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const locationIds = item.location_id ? [item.location_id] : [];
  const locations = await resolveLocations(supabase, workspaceId, locationIds);

  const extraRefIds = [...new Set(item.reference_ids ?? [])];
  const extraPaths = await resolvePaths(supabase, workspaceId, extraRefIds);

  const itemProduct = item.product_id
    ? await resolveItemProduct(supabase, workspaceId, item.product_id, campaign.include_packaging !== false)
    : null;

  // Fallback al producto de campaña: mismos campos que ctx expone (ya resueltos
  // por loadCampaignContext arriba), idéntico al bloque `product` de
  // directorContextFor cuando el clip no trae productOverride.
  const product = itemProduct
    ? {
        name: itemProduct.name,
        visualDetails: itemProduct.visualDetails,
        palette: itemProduct.palette,
        imagePaths: itemProduct.imagePaths,
        imageUsages: itemProduct.imageUsages,
        packagingImagePaths: itemProduct.packagingImagePaths ?? [],
        medium: itemProduct.medium,
        thicknessMm: itemProduct.thicknessMm,
        heightCm: itemProduct.heightCm,
        widthCm: itemProduct.widthCm,
        weightKg: itemProduct.weightKg,
      }
    : {
        name: ctx.productName,
        visualDetails: ctx.visualDetails,
        palette: ctx.palette,
        imagePaths: ctx.productImagePaths,
        imageUsages: ctx.productImageUsages,
        packagingImagePaths: ctx.packagingImagePaths,
        medium: ctx.productMedium,
        thicknessMm: ctx.productThicknessMm,
        heightCm: ctx.productHeightCm,
        widthCm: ctx.productWidthCm,
        weightKg: ctx.productWeightKg,
      };

  return assemblePool({
    productName: product.name,
    visualDetails: product.visualDetails,
    palette: product.palette,
    productImagePaths: product.imagePaths,
    productImageUsages: product.imageUsages,
    packagingImagePaths: product.packagingImagePaths,
    productMedium: product.medium,
    productThicknessMm: product.thicknessMm,
    productHeightCm: product.heightCm,
    productWidthCm: product.widthCm,
    productWeightKg: product.weightKg,
    characters: usedCharacters.map((c) => ({
      name: c.name,
      description: c.description,
      masterImagePath: c.masterImagePath,
      angleImagePaths: c.angleImagePaths,
    })),
    locations,
    extraImagePaths: [...extraPaths.values()],
  });
}
