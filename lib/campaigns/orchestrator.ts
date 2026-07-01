import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPricing } from '@/lib/credits/pricing';
import { failGeneration, reserveCredits } from '@/lib/credits/operations';
import { enqueueJob } from '@/lib/jobs/queue';
import { compile, fromFormatRow, onlyCharacterRefs, type DirectorContext } from '@/lib/prompt-director';
import {
  DIALOGUE_LANGUAGE,
  SPEECH_DIRECTION,
  hasSpokenDialogue,
  sceneHasVoice,
} from '@/lib/prompt-director/compilers/seedance';
import type { SeedanceResolution } from '@/lib/providers/seedance';
import { seedanceCostPerItem } from './estimate';
import { selectBatchItems } from './batch-selection';
import { isLocationMode, isStoryboardVideoMode, nextSceneItem, shouldReturnLastFrame, toImage2VideoSlug } from './sequence-chain';
import { uploadReference } from '@/lib/supabase/storage';
import { beatNamesCast, buildCastR2VRefs, STORYBOARD_EDIT_HANDLES } from '@/lib/campaigns/storyboard-video';
import { CreativeGuidelinesSchema, type CreativeGuidelines } from './guidelines';

// Orquestador de lotes (specs/v2/03 tarea 5). Un lote = los items de un
// formato. Cada item se vuelve una generación V1 normal (cola QStash) con
// ESCALONAMIENTO: delay incremental para no reventar rate limits del proveedor
// (ModelArk para Seedance) ni invocaciones de Vercel Hobby (doc V2 §5.5).
const STAGGER_SECONDS = 20;

export type ItemRow = {
  id: string;
  campaign_id: string;
  format_id: string | null;
  template_id: string | null;
  model_slug: string;
  duration_s: number | null;
  aspect_ratio: string | null;
  scene: string | null;
  audio: boolean;
  character_id: string | null;
  character_ids: string[] | null;
  reference_ids: string[] | null;
  scene_prompt: string;
  status: string;
  // Secuencia: las escenas de un mismo anuncio comparten sequence_id y se
  // ordenan por scene_index. null en creativos sueltos.
  sequence_id: string | null;
  scene_index: number | null;
  // Locación de la secuencia (migración 041): no null => modo-locación (sin encadenar).
  location_id: string | null;
  // Panel de storyboard (sub-proyecto B): si no es null, el clip se genera
  // image2video desde el panel (fotograma inicial), sin encadenar.
  storyboard_image_id: string | null;
  // Estado físico del personaje para esta escena (P05). null = sin estado declarado.
  character_state_hint: string | null;
};

// Personajes efectivos del item: array nuevo con fallback al principal legacy.
export function itemCharacterIds(item: Pick<ItemRow, 'character_id' | 'character_ids'>): string[] {
  if (item.character_ids?.length) return item.character_ids.slice(0, 3);
  return item.character_id ? [item.character_id] : [];
}

// Resuelve la imagen MAESTRA (hoja de identidad) de cada personaje a su storage
// path, 1 por personaje y máx 3, preservando el orden de `characterIds`. Se usa
// para re-anclar al personaje en cada clip de una secuencia (encadenado y
// regeneración): sin esto el personaje solo persiste por arrastre del último
// fotograma y deriva. Valida ownership por workspace.
export async function resolveCharacterMasterPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  characterIds: string[],
): Promise<string[]> {
  const ids = characterIds.slice(0, 3);
  if (ids.length === 0) return [];
  const { data: rows } = await supabase
    .from('characters')
    .select('id, workspace_id, master_image_id, reference_image_ids')
    .in('id', ids);
  const byId = new Map<string, string>(); // characterId -> masterImageId
  for (const c of rows ?? []) {
    if (c.workspace_id !== workspaceId) continue;
    const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0];
    if (masterId) byId.set(c.id as string, masterId);
  }
  const orderedMasterIds = ids.map((id) => byId.get(id)).filter((m): m is string => !!m);
  const paths = await resolvePaths(supabase, workspaceId, orderedMasterIds);
  return orderedMasterIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
}

type FormatRow = {
  id: string;
  slug: string;
  name: string;
  register: string | null;
  camera_style: string | null;
  pacing: string | null;
  required_refs: string[];
  default_duration_s: number;
  default_audio: boolean;
};

export type CampaignContext = {
  productName: string;
  visualDetails?: string;
  palette?: string[];
  productImagePaths: string[];
  packagingImagePaths: string[];
  characters: Map<string, { name: string; description: string; masterImagePath: string; angleImagePaths: string[]; states?: Record<string, string> }>;
  // Idioma del diálogo hablado de la campaña (migración 029); default 'es'.
  language: 'es' | 'en';
  // P16: storage path de la pista de referencia de ritmo (media_reference
  // type='audio'). undefined cuando la campaña no tiene pista.
  audioRefPath?: string;
  // AM: uso por imagen de producto (path -> "three-quarter view"). Opcional.
  productImageUsages?: Record<string, string>;
  // Tamaño físico del producto (de product_brief). Opcional; ancla la escala en
  // el storyboard. Ausente = sin ancla.
  productHeightCm?: number;
  productWidthCm?: number;
  // Medio/soporte del producto (canvas, taza, playera…) y grosor en mm.
  // Propagan desde product_brief al DirectorContext (feature objeto-vs-impreso).
  productMedium?: string;
  productThicknessMm?: number;
  // Guías creativas opt-in de la campaña (spec 2026-06-29).
  guidelines?: CreativeGuidelines;
};

// Resuelve media_references ids → storage paths, validando workspace.
async function resolvePaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('media_references')
    .select('id, storage_url, workspace_id')
    .in('id', ids);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.workspace_id === workspaceId && row.storage_url) {
      map.set(row.id as string, row.storage_url as string);
    }
  }
  return map;
}

// AM: resuelve usage_description por media_reference id (validando workspace).
// Dedicado para no tocar resolvePaths (compartido por cast/locacion).
async function resolveUsages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('media_references')
    .select('id, usage_description, workspace_id')
    .in('id', ids);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.workspace_id === workspaceId && row.usage_description) {
      map.set(row.id as string, row.usage_description as string);
    }
  }
  return map;
}

// Resuelve location_id -> { name, description, imagePaths, scaleMap? }. v1 usa SOLO la imagen
// master de la locación (1 por clip); los ángulos se difieren. Valida ownership.
export async function resolveLocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  locationIds: string[],
): Promise<
  Map<
    string,
    { name: string; description: string | null; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }
  >
> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const out = new Map<
    string,
    { name: string; description: string | null; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }
  >();
  if (ids.length === 0) return out;
  const { data: rows } = await supabase
    .from('locations')
    .select('id, workspace_id, name, description, master_image_id, scale_map_image_id, scale_map_notes')
    .in('id', ids);
  const masterByLoc = new Map<string, string>();
  const scaleByLoc = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.workspace_id !== workspaceId) continue;
    if (r.master_image_id) masterByLoc.set(r.id as string, r.master_image_id as string);
    if (r.scale_map_image_id) scaleByLoc.set(r.id as string, r.scale_map_image_id as string);
  }
  // Una sola resolución de paths para masters + mapas de escala.
  const paths = await resolvePaths(supabase, workspaceId, [...masterByLoc.values(), ...scaleByLoc.values()]);
  for (const r of rows ?? []) {
    if (r.workspace_id !== workspaceId) continue;
    const masterId = masterByLoc.get(r.id as string);
    const masterPath = masterId ? paths.get(masterId) : undefined;
    const scaleId = scaleByLoc.get(r.id as string);
    const scalePath = scaleId ? paths.get(scaleId) : undefined;
    out.set(r.id as string, {
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      imagePaths: masterPath ? [masterPath] : [],
      ...(scalePath
        ? { scaleMap: { path: scalePath, ...((r.scale_map_notes as string | null) ? { notes: r.scale_map_notes as string } : {}) } }
        : {}),
    });
  }
  return out;
}

export async function loadCampaignContext(
  workspaceId: string,
  campaign: {
    brand_kit_id: string | null;
    product_brief: Record<string, unknown> | null;
    language?: string | null;
    // Toggle del wizard (migración 032): false = el empaque del kit no viaja
    // al modelo. undefined (callers viejos) se trata como true.
    include_packaging?: boolean | null;
    // P16: media_reference id de la pista de referencia de ritmo.
    music_ref_id?: string | null;
    // Guías creativas opt-in (columna creative_guidelines). Tolerante: si no llega o
    // falla el parse, se trata como vacío (sin guías activas).
    creative_guidelines?: Record<string, unknown> | null;
  },
  characterIds: string[],
): Promise<CampaignContext> {
  const supabase = await createClient();
  const brief = (campaign.product_brief ?? {}) as {
    productName?: string;
    visualDetails?: string;
    palette?: string[];
    heightCm?: number;
    widthCm?: number;
    medium?: string;
    thicknessMm?: number;
  };

  let productImagePaths: string[] = [];
  let packagingImagePaths: string[] = [];
  const productImageUsages: Record<string, string> = {};
  if (campaign.brand_kit_id) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('workspace_id, product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('id', campaign.brand_kit_id)
      .single();
    if (kit && kit.workspace_id === workspaceId) {
      // Compat kits V1 — mismo fallback que generatePlanAction.
      const rawProductIds = (kit.product_image_ids ?? []) as string[];
      const productIds = rawProductIds.length
        ? rawProductIds
        : ((kit.reference_image_ids ?? []) as string[]);
      const packagingIds =
        campaign.include_packaging === false ? [] : ((kit.packaging_image_ids ?? []) as string[]);
      const paths = await resolvePaths(supabase, workspaceId, [...productIds, ...packagingIds]);
      productImagePaths = productIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
      packagingImagePaths = packagingIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
      const usages = await resolveUsages(supabase, workspaceId, productIds);
      for (const id of productIds) {
        const path = paths.get(id);
        const usage = usages.get(id);
        if (path && usage) productImageUsages[path] = usage;
      }
    }
  }

  const characters = new Map<string, { name: string; description: string; masterImagePath: string; angleImagePaths: string[]; states?: Record<string, string> }>();
  if (characterIds.length) {
    const { data: rows } = await supabase
      .from('characters')
      .select('id, workspace_id, name, description, master_image_id, reference_image_ids, angle_image_ids')
      .in('id', characterIds);
    const imageIds: string[] = [];
    for (const c of rows ?? []) {
      const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0];
      if (masterId) imageIds.push(masterId);
      imageIds.push(...((c.angle_image_ids as string[]) ?? []).slice(0, 2));
    }
    const paths = await resolvePaths(supabase, workspaceId, imageIds);
    for (const c of rows ?? []) {
      if (c.workspace_id !== workspaceId) continue;
      const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0];
      const masterPath = masterId ? paths.get(masterId) : undefined;
      if (masterPath) {
        const angleIds = ((c.angle_image_ids as string[]) ?? []).slice(0, 2);
        const angleImagePaths = angleIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
        characters.set(c.id as string, {
          name: c.name as string,
          description: (c.description as string) ?? '',
          masterImagePath: masterPath,
          angleImagePaths,
        });
      }
    }
  }

  // P05: cargar variantes de estado de cada personaje (character_states) y
  // resolver state_image_id → path. Se mezclan en el Map de characters.
  const charIds = [...characters.keys()];
  if (charIds.length) {
    const { data: stRows } = await supabase
      .from('character_states').select('character_id, label, state_image_id')
      .in('character_id', charIds);
    const stImgIds = (stRows ?? []).map((r) => r.state_image_id as string | null).filter((x): x is string => !!x);
    const stPaths = await resolvePaths(supabase, workspaceId, stImgIds);
    for (const r of stRows ?? []) {
      const ent = characters.get(r.character_id as string);
      const path = (r.state_image_id as string | null) ? stPaths.get(r.state_image_id as string) : undefined;
      if (ent && path) { (ent.states ??= {})[r.label as string] = path; }
    }
  }

  let audioRefPath: string | undefined;
  if (campaign.music_ref_id) {
    const audioMap = await resolvePaths(supabase, workspaceId, [campaign.music_ref_id]);
    audioRefPath = audioMap.get(campaign.music_ref_id);
  }

  const guidelinesParsed = CreativeGuidelinesSchema.safeParse(campaign.creative_guidelines ?? {});
  const guidelines = guidelinesParsed.success ? guidelinesParsed.data : {};

  return {
    productName: brief.productName ?? 'the product',
    visualDetails: brief.visualDetails,
    palette: brief.palette,
    productImagePaths,
    packagingImagePaths,
    productImageUsages,
    productHeightCm: brief.heightCm,
    productWidthCm: brief.widthCm,
    productMedium: brief.medium,
    productThicknessMm: brief.thicknessMm,
    characters,
    language: campaign.language === 'en' ? 'en' : 'es',
    audioRefPath,
    guidelines,
  };
}

export function directorContextFor(
  item: ItemRow,
  format: FormatRow | null,
  ctx: CampaignContext,
  templateVideoPath?: string,
  extraImagePaths?: string[],
  location?: { name?: string; description?: string; imagePaths: string[]; scaleMap?: { path: string; notes?: string } },
): DirectorContext {
  const stateHint = (item.character_state_hint as string | null) ?? null;
  const characters = itemCharacterIds(item)
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => {
      const statePath = stateHint ? c.states?.[stateHint] : undefined;
      return {
        name: c.name,
        description: c.description,
        masterImagePath: statePath ?? c.masterImagePath,
        angleImagePaths: c.angleImagePaths,
        ...(statePath ? { stateLabel: stateHint as string } : {}),
      };
    });
  return {
    format: format ? fromFormatRow(format) : undefined,
    product: {
      name: ctx.productName,
      visualDetails: ctx.visualDetails,
      palette: ctx.palette,
      imagePaths: ctx.productImagePaths,
      imageUsages: ctx.productImageUsages,
      heightCm: ctx.productHeightCm,
      widthCm: ctx.productWidthCm,
      medium: ctx.productMedium,
      thicknessMm: ctx.productThicknessMm,
      packagingImagePaths: format?.required_refs.includes('packaging')
        ? ctx.packagingImagePaths
        : undefined,
    },
    characters: characters.length ? characters : undefined,
    extraImagePaths: extraImagePaths?.length ? extraImagePaths : undefined,
    location: (location?.imagePaths.length || location?.description?.trim() || location?.scaleMap) ? location : undefined,
    scene: item.scene ? { fragment: item.scene } : undefined,
    // Plantilla viva: el video ganador entra como @Video1 (estructura/cámara/ritmo).
    templateVideoPath,
    language: ctx.language,
    audioRefPath: ctx.audioRefPath,
    guidelines: ctx.guidelines,
  };
}

// Carga los paths de video de las plantillas usadas por los items de la serie.
async function loadTemplateVideoPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  items: ItemRow[],
): Promise<Map<string, string>> {
  const templateIds = [...new Set(items.map((i) => i.template_id).filter((t): t is string => !!t))];
  const map = new Map<string, string>();
  if (templateIds.length === 0) return map;
  const { data } = await supabase
    .from('creative_templates')
    .select('id, fixed_params')
    .in('id', templateIds);
  for (const row of data ?? []) {
    const fixed = (row.fixed_params ?? {}) as { templateVideoPath?: string };
    if (fixed.templateVideoPath) map.set(row.id as string, fixed.templateVideoPath);
  }
  return map;
}

export type BatchResult = {
  enqueued: number;
  skipped: Array<{ itemId: string; reason: string }>;
  creditsReserved: number;
};

// ¿Backend con encadenado soportado? Solo AtlasCloud devuelve el último
// fotograma (return_last_frame). En ModelArk la secuencia cae al modo paralelo.
function chainSupported(): boolean {
  return process.env.SEEDANCE_PROVIDER === 'atlas';
}

// Datos de cadena que viajan en generations.params.chain. productImagePaths se
// propaga desde el clip 1 para re-anclar el producto en CADA clip (evita drift).
type ChainParams = {
  campaignId: string;
  sequenceId: string;
  sceneIndex: number;
  productImagePaths?: string[];
  // Hoja maestra de cada personaje, re-anclada en CADA clip (evita drift de
  // identidad). Se propaga clip a clip igual que productImagePaths.
  characterImagePaths?: string[];
  // Último fotograma del clip previo (heredado como continuidad). Se guarda
  // explícito para que la regeneración lo recupere sin depender del orden del
  // array referenceImagePaths.
  prevFramePath?: string;
  // Resolución del clip 1: los clips de continuación la HEREDAN para no saltar
  // de 720p a 480p a mitad de la secuencia (#1). undefined en cadenas viejas.
  resolution?: SeedanceResolution;
  // Idioma del diálogo de la campaña: se re-ancla en cada clip para no perder el
  // acento es-MX ni el lip-sync a mitad de la toma continua (#3). undefined → 'es'.
  language?: 'es' | 'en';
  // P16: pista de referencia de ritmo de la campaña; se re-ancla en cada clip
  // de la cadena (los encadenados no pasan por el compiler). undefined → sin pista.
  audioRefPath?: string;
};

// Construye el prompt de continuación de un clip encadenado. Las referencias se
// citan como @image{N} (1-based, minúscula — formato oficial de Atlas), en el
// MISMO orden del array reference_images: primero el producto, luego el último
// fotograma del plano anterior.
export function buildContinuationPrompt(
  scenePrompt: string,
  productCount: number,
  characterCount: number,
  opts?: { withClosingFrame?: boolean; language?: 'es' | 'en'; generateAudio?: boolean },
): string {
  const refs: string[] = [];
  let idx = 0;
  for (let i = 0; i < productCount; i++) {
    idx++;
    refs.push(
      `@image${idx} is the product — keep its design, colors and proportions consistent; any printed photo or text on it stays a still print, not animated.`,
    );
  }
  for (let i = 0; i < characterCount; i++) {
    idx++;
    refs.push(
      `@image${idx} is a main character — keep the same face, hair and build; only wardrobe and expression follow the scene.`,
    );
  }
  idx++;
  refs.push(
    `@image${idx} is the final frame of the previous shot — continue seamlessly from it: same subject, lighting, palette and setting, as one continuous sequence.`,
  );
  if (opts?.withClosingFrame) {
    idx++;
    refs.push(
      `@image${idx} is the target final frame — end the shot exactly on it, matching its composition, framing and pose so the next shot continues seamlessly.`,
    );
  }
  const base = `${refs.join(' ')} ${scenePrompt.trim()}`.trim();
  // Re-anclar la voz en CADA clip (#3): sin esto el clip 1 habla es-MX con
  // lip-sync pero los siguientes pierden la directiva y Seedance puede derivar a
  // inglés/acento neutro o narración a mitad de la toma continua. Mismas
  // constantes y guards que el compiler; gateado por audio.
  const generateAudio = opts?.generateAudio ?? true;
  const voice: string[] = [];
  if (generateAudio && hasSpokenDialogue(scenePrompt)) voice.push(SPEECH_DIRECTION);
  if (generateAudio && sceneHasVoice(scenePrompt)) voice.push(DIALOGUE_LANGUAGE[opts?.language ?? 'es']);
  return voice.length ? `${base} ${voice.join(' ')}` : base;
}

// Descarga el fotograma del proveedor (URL efímera) y lo sube a references,
// devolviendo el PATH interno (#10). Se llama en el FINALIZE, con la URL fresca,
// para que la URL del proveedor nunca sobreviva al worker ni dependa de cuándo
// corra el job de avance. Best-effort: null si falla.
export async function storeChainFrame(
  workspaceId: string,
  sequenceId: string,
  sceneIndex: number,
  frameUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(frameUrl);
    if (!res.ok) throw new Error(`fetch fotograma ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') ?? 'image/png';
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    return await uploadReference(workspaceId, `chain/${sequenceId}/from-${sceneIndex}.${ext}`, buf, mime);
  } catch (err) {
    console.error('[chain] heredar fotograma falló', { sequenceId, err });
    return null;
  }
}

// Resuelve la hoja maestra de cada personaje con el cliente ADMIN (el worker no
// tiene sesión, así que RLS no aplica y resolveCharacterMasterPaths —tipado al
// cliente de servidor— no encaja). Preserva orden y valida ownership.
async function resolveCharacterMasterPathsAdmin(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  characterIds: string[],
): Promise<string[]> {
  const ids = characterIds.slice(0, 3);
  if (ids.length === 0) return [];
  const { data: chars } = await admin
    .from('characters')
    .select('id, workspace_id, master_image_id, reference_image_ids')
    .in('id', ids);
  const orderedMasterIds: string[] = [];
  for (const id of ids) {
    const c = (chars ?? []).find((r) => r.id === id);
    if (!c || c.workspace_id !== workspaceId) continue;
    const mid = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0];
    if (mid) orderedMasterIds.push(mid as string);
  }
  if (orderedMasterIds.length === 0) return [];
  const { data: media } = await admin
    .from('media_references')
    .select('id, storage_url, workspace_id')
    .in('id', orderedMasterIds);
  return orderedMasterIds
    .map((mid) => {
      const m = (media ?? []).find((row) => row.id === mid && row.workspace_id === workspaceId);
      return m?.storage_url as string | undefined;
    })
    .filter((p): p is string => !!p);
}

// Avanza la cadena de una secuencia: tras finalizar un clip, genera el siguiente
// como reference-to-video con DOS referencias — la imagen del producto (re-ancla,
// evita drift) y el último fotograma del clip previo (continuidad). El producto y
// el mundo persisten porque la referencia del producto viaja en CADA clip, no
// solo en el primero. Idempotente: si el siguiente item ya tiene generación, no
// hace nada. Best-effort: cualquier fallo se loguea y corta la cadena sin tirar
// el clip ya finalizado.
export async function advanceSequenceChain(
  gen: { id: string; user_id: string; workspace_id: string; model_id: string; params: Record<string, unknown> },
  frame: { path?: string; url?: string },
): Promise<void> {
  const chain = gen.params.chain as ChainParams | undefined;
  if (!chain) return;
  const admin = createAdminClient();

  const { data: itemRows } = await admin
    .from('campaign_items')
    .select('id, scene_prompt, scene, duration_s, aspect_ratio, audio, scene_index, generation_id, character_id, character_ids, character_state_hint')
    .eq('campaign_id', chain.campaignId)
    .eq('sequence_id', chain.sequenceId);
  if (!itemRows?.length) return;

  const chainItems = itemRows.map((r) => ({ id: r.id as string, sceneIndex: r.scene_index as number }));
  const next = nextSceneItem(chainItems, chain.sceneIndex);
  if (!next) return; // era el último clip de la secuencia
  const nextRow = itemRows.find((r) => r.id === next.id);
  if (!nextRow || nextRow.generation_id) return; // ya avanzado (duplicado de QStash)

  // Heredar el último fotograma como PATH interno (#10). Lo normal: ya viene en
  // frame.path (lo subió el finalize con la URL fresca). Compat: jobs encolados
  // antes del deploy traen la URL cruda → se descarga aquí (puede haber expirado).
  let framePath = frame.path ?? null;
  if (!framePath && frame.url) {
    framePath = await storeChainFrame(gen.workspace_id, chain.sequenceId, next.sceneIndex, frame.url);
  }
  if (!framePath) return;

  // Clip de continuación: R2V con [producto..., personaje..., fotograma previo].
  // El producto se cita @image1.. y el fotograma como la última imagen. Mismo
  // modelo R2V que el clip 1 (no i2v): así el producto se re-ancla en cada clip.
  const productPaths = (chain.productImagePaths ?? []).slice(0, 3);
  let characterPaths = (chain.characterImagePaths ?? []).slice(0, 3);
  if (characterPaths.length === 0) {
    // Cadenas iniciadas antes del 2026-06-16 no propagan characterImagePaths:
    // re-resolver la hoja maestra del item para no perder el re-anclaje (#6).
    const charIds = itemCharacterIds({
      character_id: (nextRow.character_id as string | null) ?? null,
      character_ids: (nextRow.character_ids as string[] | null) ?? null,
    });
    if (charIds.length) {
      characterPaths = await resolveCharacterMasterPathsAdmin(admin, gen.workspace_id, charIds);
    }
  }
  const referenceImagePaths = [...productPaths, ...characterPaths, framePath];
  const r2vModel = gen.model_id; // ya es .../reference-to-video
  // Heredar la resolución del clip 1 (#1): sin esto los clips 2+ caían a 480p
  // mientras el clip 1 podía ser 720p → salto de nitidez en cada juntura.
  const resolution: SeedanceResolution = chain.resolution ?? '480p';
  const language = chain.language ?? 'es';
  const duration = nextRow.duration_s ?? 8;
  const pricing = await loadPricing();
  const cost = seedanceCostPerItem(pricing, r2vModel, resolution, duration);
  const returnLast = shouldReturnLastFrame(chainItems, next.sceneIndex);
  const prompt = buildContinuationPrompt(
    nextRow.scene_prompt as string,
    productPaths.length,
    characterPaths.length,
    { language, generateAudio: (nextRow.audio as boolean | null) ?? true },
  );

  const { data: inserted, error: insErr } = await admin
    .from('generations')
    .insert({
      user_id: gen.user_id,
      workspace_id: gen.workspace_id,
      type: 'video',
      provider: 'seedance',
      model_id: r2vModel,
      prompt,
      params: {
        operation: 'reference2video',
        aspectRatio: nextRow.aspect_ratio ?? '9:16',
        resolution,
        duration,
        generateAudio: nextRow.audio ?? true,
        referenceImagePaths,
        ...(chain.audioRefPath ? { referenceAudioPaths: [chain.audioRefPath] } : {}),
        returnLastFrame: returnLast,
        chain: {
          campaignId: chain.campaignId,
          sequenceId: chain.sequenceId,
          sceneIndex: next.sceneIndex,
          productImagePaths: productPaths,
          characterImagePaths: characterPaths,
          prevFramePath: framePath,
          resolution,
          language,
          ...(chain.audioRefPath ? { audioRefPath: chain.audioRefPath } : {}),
        } satisfies ChainParams,
      },
      status: 'queued',
      credits_estimated: cost,
      campaign_id: chain.campaignId,
      timeout_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    console.error('[chain] insert generación falló', { itemId: next.id, err: insErr?.message });
    return;
  }
  const nextGenId = inserted.id as string;

  // Claim idempotente del item: solo si sigue sin generación. Si otro avance
  // ganó la carrera, borrar la generación huérfana y salir.
  const { count } = await admin
    .from('campaign_items')
    .update({ status: 'sample', generation_id: nextGenId }, { count: 'exact' })
    .eq('id', next.id)
    .is('generation_id', null);
  if (count === 0) {
    await admin.from('generations').delete().eq('id', nextGenId);
    return;
  }

  // El item ya quedó reclamado ('sample', generation_id=nextGenId) y la
  // generación insertada 'queued'. Si reserveCredits o enqueueJob LANZAN, sin
  // este try/catch el item quedaría colgado para siempre: nadie la encola →
  // nadie la pollea → su timeout_at nunca se evalúa. En cualquier fallo se
  // libera dejando la generación 'failed' (refund solo si se reservó) y el item
  // 'failed', reanudable con sus referencias intactas.
  let reserved = false;
  try {
    reserved = await reserveCredits(gen.user_id, cost, nextGenId);
    if (!reserved) {
      // Sin créditos: NO borrar la generación. Se deja 'failed' con sus referencias
      // intactas ([producto, fotograma previo]) para que "Generar esta escena"
      // pueda RESUMIRLA con continuidad real (reserva + re-encola). El item queda
      // 'failed' apuntando a esa generación.
      await admin
        .from('generations')
        .update({ status: 'failed', error_message: 'insufficient_credits' })
        .eq('id', nextGenId);
      await admin
        .from('campaign_items')
        .update({ status: 'failed', warnings: ['Sin créditos: regenera esta escena cuando tengas saldo'] })
        .eq('id', next.id);
      return;
    }
    await enqueueJob({ generationId: nextGenId, action: 'submit', delaySeconds: 0 });
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    try {
      await failGeneration(gen.user_id, nextGenId, reserved ? cost : 0, `chain_advance: ${message}`);
    } catch (failErr) {
      console.error('[chain:fail_generation]', { itemId: next.id, error: message, failError: (failErr as Error)?.message });
    }
    await admin
      .from('campaign_items')
      .update({ status: 'failed', warnings: ['Error al continuar la secuencia: regenera esta escena'] })
      .eq('id', next.id);
  }
}

// Encola los items de un lote. mode='sample' toma SAMPLE_SIZE items con
// escenas distintas; el resto queda 'planned' para el lote completo.
export async function enqueueBatch(params: {
  userId: string;
  workspaceId: string;
  campaign: {
    id: string;
    brand_kit_id: string | null;
    product_brief: Record<string, unknown> | null;
    language?: string | null;
    include_packaging?: boolean | null;
    music_ref_id?: string | null;
    creative_guidelines?: Record<string, unknown> | null;
  };
  items: ItemRow[];
  formats: Map<string, FormatRow>;
  mode: 'sample' | 'full';
}): Promise<BatchResult> {
  const { userId, workspaceId, campaign, formats, mode } = params;
  const pending = params.items.filter((i) => i.status === 'planned' || i.status === 'failed');

  // Regla de selección (atómica para secuencias) extraída a módulo puro.
  const selected = selectBatchItems(pending, mode);
  if (selected.length === 0) return { enqueued: 0, skipped: [], creditsReserved: 0 };

  const characterIds = [...new Set(selected.flatMap((i) => itemCharacterIds(i)))];
  const ctx = await loadCampaignContext(workspaceId, campaign, characterIds);
  const pricing = await loadPricing();
  const supabase = await createClient();
  const templateVideos = await loadTemplateVideoPaths(supabase, selected);
  // Referencias extra del refinado (campaign_items.reference_ids): hoy el
  // refinado las guarda pero nunca llegaban al modelo. Se resuelven una vez
  // por lote y entran al contexto como extraImagePaths (rol environment).
  const extraRefIds = [...new Set(selected.flatMap((i) => i.reference_ids ?? []))];
  const extraPaths = await resolvePaths(supabase, workspaceId, extraRefIds);
  const locationIds = selected.map((i) => i.location_id).filter((l): l is string => !!l);
  const locations = await resolveLocations(supabase, workspaceId, locationIds);
  // Paneles de storyboard de los items seleccionados (sub-proyecto B). storyboard_image_id
  // es un media_reference id → resolvePaths da su storage_url (el first_frame del clip).
  const storyboardIds = selected.map((i) => i.storyboard_image_id).filter((s): s is string => !!s);
  const storyboardPanels = await resolvePaths(supabase, workspaceId, storyboardIds);
  const itemStatus = mode === 'sample' ? 'sample' : 'queued';

  // Encadenado de secuencias (specs/v2/09, solo Atlas): de una secuencia
  // multi-escena se encola SOLO la 1ª escena; las demás las genera el avance de
  // cadena (advanceSequenceChain) al finalizar cada clip, heredando su último
  // fotograma. Por sequence_id: los scene_index presentes en este lote.
  const chaining = chainSupported();
  // min/max se calculan sobre TODA la secuencia (params.items), no solo el
  // subconjunto pendiente: si una escena intermedia se evaluara como 'primer
  // clip' (porque la cabecera ya generada quedó fuera de lo pendiente) se
  // generaría como R2V fresco y rompería la continuidad. seqPending registra qué
  // escenas entran a este lote y seqHeadStatus el estado de la cabecera, para
  // detectar reanudaciones que el lote no puede producir.
  const seqGroups = new Map<string, number[]>();
  const seqPending = new Map<string, Set<number>>();
  const seqHeadStatus = new Map<string, string>();
  if (chaining) {
    for (const it of params.items) {
      if (!it.sequence_id) continue;
      const arr = seqGroups.get(it.sequence_id) ?? [];
      arr.push(it.scene_index ?? 0);
      seqGroups.set(it.sequence_id, arr);
    }
    for (const it of selected) {
      if (!it.sequence_id) continue;
      const set = seqPending.get(it.sequence_id) ?? new Set<number>();
      set.add(it.scene_index ?? 0);
      seqPending.set(it.sequence_id, set);
    }
    for (const [seqId, idxs] of seqGroups) {
      const min = Math.min(...idxs);
      const head = params.items.find((it) => it.sequence_id === seqId && (it.scene_index ?? 0) === min);
      if (head) seqHeadStatus.set(seqId, head.status);
    }
  }
  function chainRole(item: ItemRow): {
    skip: boolean;
    isFirst: boolean;
    returnLastFrame: boolean;
    orphanResume: boolean;
  } {
    // Modo storyboard-video: el clip se genera image2video desde el panel, SIN
    // encadenar. Gana sobre location y encadenado.
    if (isStoryboardVideoMode(item)) {
      return { skip: false, isFirst: false, returnLastFrame: false, orphanResume: false };
    }
    // Modo-locación: la secuencia NO se encadena. Cada escena se genera
    // independiente (no se salta, no return_last_frame, no chain). Gana sobre
    // el encadenado aunque el backend sea Atlas.
    if (isLocationMode(item)) {
      return { skip: false, isFirst: false, returnLastFrame: false, orphanResume: false };
    }
    if (!chaining || !item.sequence_id)
      return { skip: false, isFirst: false, returnLastFrame: false, orphanResume: false };
    const idxs = seqGroups.get(item.sequence_id) ?? [];
    if (idxs.length <= 1)
      return { skip: false, isFirst: false, returnLastFrame: false, orphanResume: false }; // secuencia de 1 → normal
    const min = Math.min(...idxs);
    const max = Math.max(...idxs);
    const myIdx = item.scene_index ?? 0;
    // Solo el primer clip (min) se encola; los demás los produce el avance de
    // cadena. Esta escena (no-cabecera) solo es huérfana si la cadena NO la va a
    // producir: la cabecera no entra a este lote (no se re-encola como primer
    // clip) Y tampoco está en vuelo ('sample'/'queued'). Si la cabecera está
    // pendiente (planned/failed → seleccionada), se re-encola y arrastra la
    // cadena, así que esta escena NO es huérfana.
    const headPending = seqPending.get(item.sequence_id)?.has(min) ?? false;
    const headStatus = seqHeadStatus.get(item.sequence_id);
    const headInFlight = headStatus === 'sample' || headStatus === 'queued';
    const orphanResume = myIdx !== min && !headPending && !headInFlight;
    return { skip: myIdx !== min, isFirst: myIdx === min, returnLastFrame: myIdx !== max, orphanResume };
  }

  const result: BatchResult = { enqueued: 0, skipped: [], creditsReserved: 0 };

  for (let idx = 0; idx < selected.length; idx++) {
    const item = selected[idx];
    const role = chainRole(item);
    // Clip encadenado (no el primero): lo genera el avance de cadena al
    // finalizar el clip previo. Se deja en 'planned' sin tocar. Si la cabecera
    // de la secuencia ya pasó (orphanResume), la cadena no lo va a producir: se
    // reporta como skipped para que la UI invite a regenerarlo individualmente
    // en vez de quedar en silencio sin generarse nunca.
    if (role.skip) {
      if (role.orphanResume) {
        result.skipped.push({
          itemId: item.id,
          reason: 'La secuencia ya empezó: regenera esta escena para continuarla',
        });
      }
      continue;
    }
    const format = item.format_id ? (formats.get(item.format_id) ?? null) : null;

    const panelPath = item.storyboard_image_id ? storyboardPanels.get(item.storyboard_image_id) : undefined;
    const storyboardMode = !!panelPath;

    const baseDirCtx = directorContextFor(
      item,
      format,
      ctx,
      item.template_id ? templateVideos.get(item.template_id) : undefined,
      (item.reference_ids ?? []).map((id) => extraPaths.get(id)).filter((p): p is string => !!p),
      (() => {
        const loc = item.location_id ? locations.get(item.location_id) : undefined;
        if (!loc) return undefined;
        return { name: loc.name, description: loc.description ?? undefined, imagePaths: loc.imagePaths, scaleMap: loc.scaleMap };
      })(),
    );
    const dirCtx = storyboardMode ? onlyCharacterRefs(baseDirCtx) : baseDirCtx;

    const compiled = compile(
      {
        modelSlug: item.model_slug,
        scenePrompt: item.scene_prompt,
        durationS: item.duration_s ?? undefined,
        aspectRatio: item.aspect_ratio ?? undefined,
        generateAudio: item.audio,
        isOpeningBeat: (item.scene_index ?? 0) === 0,
      },
      dirCtx,
    );

    if (!compiled.ok) {
      result.skipped.push({ itemId: item.id, reason: compiled.errors.join('; ') });
      await supabase
        .from('campaign_items')
        .update({ warnings: compiled.errors, status: 'skipped' })
        .eq('id', item.id);
      continue;
    }

    const p = compiled.compiled.params;
    const resolution = (p.resolution as '480p' | '720p' | '1080p') ?? '480p';
    const durationS = (p.duration as number | undefined) ?? 8;
    const refImages = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
    // Modo storyboard: las únicas refs de imagen compiladas son los personajes
    // (onlyCharacterRefs quita producto/locación), en el orden en que el prompt las cita.
    const storyboardCastRefs = storyboardMode ? refImages : [];
    // El cast solo se manda como referencia VIVA cuando el beat lo NOMBRA (los
    // personajes actúan en la toma). En tomas donde no actúan (p.ej. close-up del
    // producto, donde la gente está impresa en el cuadro) mandar el cast hacía que el
    // modelo lo pegara literal y no animara → esos beats van por I2V (panel exacto).
    const storyboardCastNames = storyboardMode
      ? itemCharacterIds(item)
          .map((id) => ctx.characters.get(id)?.name)
          .filter((n): n is string => !!n)
      : [];
    const castActs = storyboardMode && beatNamesCast(item.scene_prompt, storyboardCastNames);
    // Atlas no deja mezclar first_frame + referencias: beat CON cast que actúa →
    // reference2video (cast + producto + panel como reference_image); resto de beats
    // del storyboard → image2video (panel exacto, lock total + movimiento real).
    const useR2V = storyboardMode && castActs && storyboardCastRefs.length > 0;
    // El slug debe coincidir con la operación: R2V → reference-to-video (el slug del item
    // ya lo es); I2V solo-panel → image-to-video.
    const effectiveModelSlug = storyboardMode
      ? useR2V
        ? item.model_slug
        : toImage2VideoSlug(item.model_slug)
      : item.model_slug;
    const cost = seedanceCostPerItem(pricing, effectiveModelSlug, resolution, durationS);
    // R2V re-ancla el PRODUCTO como referencia dedicada (antes solo viajaba dentro del
    // panel → derivaba). Se toma del contexto base, ANTES de onlyCharacterRefs (que lo
    // quitó del dirCtx del compile). El cast lo cita el compiler (@image1..N); producto
    // y panel se citan en extraCitation.
    const storyboardProductRefs = useR2V ? (baseDirCtx.product?.imagePaths ?? []).slice(0, 2) : [];
    // P16: la música (audioRefPath) no está en el panel; se toma del contexto
    // base ANTES de onlyCharacterRefs (que lo quitó del dirCtx del compile) y se
    // re-ancla solo en beats R2V (reference2video la soporta; image2video no).
    const storyboardAudioRef = useR2V ? baseDirCtx.audioRefPath : undefined;
    const { referenceImagePaths: castR2VRefs, referenceAudioPaths: castR2VAudios, extraCitation } = useR2V
      ? buildCastR2VRefs(storyboardCastRefs, storyboardProductRefs, panelPath as string, storyboardAudioRef)
      : { referenceImagePaths: [] as string[], referenceAudioPaths: [] as string[], extraCitation: '' };
    // Manijas de entrada/salida solo en clips de storyboard (independientes): puntos
    // de corte limpios para montaje en post.
    const storyboardPrompt =
      compiled.compiled.prompt + extraCitation + (storyboardMode ? STORYBOARD_EDIT_HANDLES : '');
    // Producto y personaje se re-anclan en cada clip de la cadena (ver
    // characterMasterPaths abajo). Packaging/environment NO: hacerlo haría que el
    // modelo trate esas refs como "el producto" y derive la secuencia.
    const productImages = compiled.compiled.references
      .filter((r) => r.kind === 'image' && r.role === 'product')
      .map((r) => r.storagePath);
    const refVideos = compiled.compiled.references.filter((r) => r.kind === 'video').map((r) => r.storagePath);
    const refAudios = compiled.compiled.references.filter((r) => r.kind === 'audio').map((r) => r.storagePath);
    // Hoja maestra de cada personaje del clip: se re-ancla en CADA clip de la
    // cadena (igual que el producto) para que la identidad no derive. Se toma de
    // ctx.characters (master explícita), no de las refs compiladas (que mezclan
    // master y ángulos).
    const characterMasterPaths = itemCharacterIds(item)
      .map((id) => ctx.characters.get(id)?.masterImagePath)
      .filter((p): p is string => !!p);

    const { data: inserted, error: insertErr } = await supabase
      .from('generations')
      .insert({
        user_id: userId,
        workspace_id: workspaceId,
        type: 'video',
        provider: 'seedance',
        model_id: effectiveModelSlug,
        prompt: storyboardPrompt,
        params: useR2V
          ? {
              // Beat con cast: reference2video (Atlas no deja first_frame + refs).
              // cast (@image1..N) + panel (@image{N+1}) como reference_image.
              operation: 'reference2video',
              referenceImagePaths: castR2VRefs,
              referenceAudioPaths: castR2VAudios,
              aspectRatio: p.aspectRatio,
              resolution,
              duration: durationS,
              generateAudio: p.generateAudio,
              ...(p.seed !== undefined ? { seed: p.seed } : {}),
            }
          : storyboardMode
            ? {
                // Beat sin cast: image2video con el panel como fotograma inicial.
                operation: 'image2video',
                referenceStoragePath: panelPath as string,
                aspectRatio: p.aspectRatio,
                resolution,
                duration: durationS,
                generateAudio: p.generateAudio,
                ...(p.seed !== undefined ? { seed: p.seed } : {}),
              }
            : {
              operation: p.operation,
              aspectRatio: p.aspectRatio,
              resolution,
              duration: durationS,
              generateAudio: p.generateAudio,
              ...(p.seed !== undefined ? { seed: p.seed } : {}),
              referenceImagePaths: refImages,
              referenceVideoPaths: refVideos,
              referenceAudioPaths: refAudios,
              ...(role.isFirst
                ? {
                    returnLastFrame: role.returnLastFrame,
                    chain: {
                      campaignId: campaign.id,
                      sequenceId: item.sequence_id as string,
                      sceneIndex: item.scene_index ?? 0,
                      // Refs del producto y del personaje: se re-anclan en cada clip.
                      productImagePaths: productImages,
                      characterImagePaths: characterMasterPaths,
                      // Resolución e idioma del clip 1: los clips de continuación los
                      // heredan para no saltar de nitidez (#1) ni perder es-MX (#3).
                      resolution,
                      language: ctx.language,
                      ...(ctx.audioRefPath ? { audioRefPath: ctx.audioRefPath } : {}),
                    } satisfies ChainParams,
                  }
                : {}),
            },
        reference_ids: [],
        status: 'queued',
        credits_estimated: cost,
        campaign_id: campaign.id,
        timeout_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      result.skipped.push({ itemId: item.id, reason: insertErr?.message ?? 'insert falló' });
      continue;
    }
    const generationId = inserted.id as string;

    let reserved = false;
    try {
      reserved = await reserveCredits(userId, cost, generationId);
      if (!reserved) {
        const admin = createAdminClient();
        await admin.from('generations').delete().eq('id', generationId);
        result.skipped.push({ itemId: item.id, reason: 'insufficient_credits' });
        // Señal persistente: sin esto los items restantes del lote quedan mudos
        // (el toast muere y tras un reload nadie sabe por qué no se generaron).
        // El warning se limpia solo al re-encolar (el update post-enqueue del
        // lote escribe warnings de compilación encima).
        // Solo los items que este lote habría encolado: las escenas de
        // continuación de cadena (role.skip) no pasan por reserveCredits aquí —
        // su señal la escribe advanceSequenceChain con su propio mensaje, y
        // marcarlas invitaría a regenerarlas sueltas rompiendo la continuidad.
        const remainingIds = selected
          .slice(idx)
          .filter((it) => !chainRole(it).skip)
          .map((it) => it.id);
        try {
          await admin
            .from('campaign_items')
            .update({ warnings: ['Sin créditos: este item no entró al lote. Regenéralo cuando tengas saldo.'] })
            .in('id', remainingIds);
        } catch (warnErr) {
          // Best-effort: un fallo anotando el aviso no debe impedir cortar el
          // lote (el catch externo re-fallaría una generación ya borrada).
          console.error('[campaign_batch:warn_skipped]', {
            itemId: item.id,
            error: (warnErr as Error)?.message,
          });
        }
        // Sin créditos no tiene caso seguir con el resto del lote.
        break;
      }
      // Escalonamiento: delay incremental por posición en el lote.
      await enqueueJob({
        generationId,
        action: 'submit',
        delaySeconds: idx * STAGGER_SECONDS,
      });
      await supabase
        .from('campaign_items')
        .update({
          status: itemStatus,
          generation_id: generationId,
          warnings: compiled.compiled.warnings,
        })
        .eq('id', item.id);
      result.enqueued += 1;
      result.creditsReserved += cost;
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown';
      try {
        await failGeneration(userId, generationId, reserved ? cost : 0, `batch_enqueue: ${message}`);
      } catch (failErr) {
        console.error('[campaign_batch:fail_generation]', {
          generationId,
          itemId: item.id,
          error: message,
          failError: (failErr as Error)?.message,
        });
      }
      result.skipped.push({ itemId: item.id, reason: message });
    }
  }

  return result;
}
