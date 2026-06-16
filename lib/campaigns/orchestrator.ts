import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPricing } from '@/lib/credits/pricing';
import { failGeneration, reserveCredits } from '@/lib/credits/operations';
import { enqueueJob } from '@/lib/jobs/queue';
import { compile, fromFormatRow, type DirectorContext } from '@/lib/prompt-director';
import { seedanceCostPerItem } from './estimate';
import { selectBatchItems } from './batch-selection';
import { nextSceneItem, shouldReturnLastFrame } from './sequence-chain';
import { uploadReference } from '@/lib/supabase/storage';

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
  characters: Map<string, { name: string; description: string; masterImagePath: string; angleImagePaths: string[] }>;
  // Idioma del diálogo hablado de la campaña (migración 029); default 'es'.
  language: 'es' | 'en';
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

export async function loadCampaignContext(
  workspaceId: string,
  campaign: {
    brand_kit_id: string | null;
    product_brief: Record<string, unknown> | null;
    language?: string | null;
    // Toggle del wizard (migración 032): false = el empaque del kit no viaja
    // al modelo. undefined (callers viejos) se trata como true.
    include_packaging?: boolean | null;
  },
  characterIds: string[],
): Promise<CampaignContext> {
  const supabase = await createClient();
  const brief = (campaign.product_brief ?? {}) as {
    productName?: string;
    visualDetails?: string;
    palette?: string[];
  };

  let productImagePaths: string[] = [];
  let packagingImagePaths: string[] = [];
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
    }
  }

  const characters = new Map<string, { name: string; description: string; masterImagePath: string; angleImagePaths: string[] }>();
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

  return {
    productName: brief.productName ?? 'the product',
    visualDetails: brief.visualDetails,
    palette: brief.palette,
    productImagePaths,
    packagingImagePaths,
    characters,
    language: campaign.language === 'en' ? 'en' : 'es',
  };
}

function directorContextFor(
  item: ItemRow,
  format: FormatRow | null,
  ctx: CampaignContext,
  templateVideoPath?: string,
  extraImagePaths?: string[],
): DirectorContext {
  const characters = itemCharacterIds(item)
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      name: c.name,
      description: c.description,
      masterImagePath: c.masterImagePath,
      angleImagePaths: c.angleImagePaths,
    }));
  return {
    format: format ? fromFormatRow(format) : undefined,
    product: {
      name: ctx.productName,
      visualDetails: ctx.visualDetails,
      palette: ctx.palette,
      imagePaths: ctx.productImagePaths,
      packagingImagePaths: format?.required_refs.includes('packaging')
        ? ctx.packagingImagePaths
        : undefined,
    },
    characters: characters.length ? characters : undefined,
    extraImagePaths: extraImagePaths?.length ? extraImagePaths : undefined,
    scene: item.scene ? { fragment: item.scene } : undefined,
    // Plantilla viva: el video ganador entra como @Video1 (estructura/cámara/ritmo).
    templateVideoPath,
    language: ctx.language,
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
};

// Construye el prompt de continuación de un clip encadenado. Las referencias se
// citan como @image{N} (1-based, minúscula — formato oficial de Atlas), en el
// MISMO orden del array reference_images: primero el producto, luego el último
// fotograma del plano anterior.
export function buildContinuationPrompt(
  scenePrompt: string,
  productCount: number,
  characterCount: number,
  opts?: { withClosingFrame?: boolean },
): string {
  const refs: string[] = [];
  let idx = 0;
  for (let i = 0; i < productCount; i++) {
    idx++;
    refs.push(`@image${idx} is the product — keep it identical (same colors, proportions, details).`);
  }
  for (let i = 0; i < characterCount; i++) {
    idx++;
    refs.push(
      `@image${idx} is a main character — keep the exact same face, hair and build, identical in every shot; only wardrobe and expression follow the scene.`,
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
  return `${refs.join(' ')} ${scenePrompt.trim()}`.trim();
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
  lastFrameUrl: string,
): Promise<void> {
  const chain = gen.params.chain as ChainParams | undefined;
  if (!chain) return;
  const admin = createAdminClient();

  const { data: itemRows } = await admin
    .from('campaign_items')
    .select('id, scene_prompt, scene, duration_s, aspect_ratio, audio, scene_index, generation_id')
    .eq('campaign_id', chain.campaignId)
    .eq('sequence_id', chain.sequenceId);
  if (!itemRows?.length) return;

  const chainItems = itemRows.map((r) => ({ id: r.id as string, sceneIndex: r.scene_index as number }));
  const next = nextSceneItem(chainItems, chain.sceneIndex);
  if (!next) return; // era el último clip de la secuencia
  const nextRow = itemRows.find((r) => r.id === next.id);
  if (!nextRow || nextRow.generation_id) return; // ya avanzado (duplicado de QStash)

  // Heredar el último fotograma: descargar de Atlas y subir a references.
  let framePath: string;
  try {
    const res = await fetch(lastFrameUrl);
    if (!res.ok) throw new Error(`fetch fotograma ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get('content-type') ?? 'image/png';
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    framePath = await uploadReference(
      gen.workspace_id,
      `chain/${chain.sequenceId}/${next.sceneIndex}.${ext}`,
      buf,
      mime,
    );
  } catch (err) {
    console.error('[chain] heredar fotograma falló', { sequenceId: chain.sequenceId, err });
    return;
  }

  // Clip de continuación: R2V con [producto..., fotograma previo]. El producto
  // se cita @image1.. y el fotograma como la última imagen. Mismo modelo R2V que
  // el clip 1 (no i2v): así el producto se re-ancla en cada clip.
  const productPaths = (chain.productImagePaths ?? []).slice(0, 3);
  const characterPaths = (chain.characterImagePaths ?? []).slice(0, 3);
  const referenceImagePaths = [...productPaths, ...characterPaths, framePath];
  const r2vModel = gen.model_id; // ya es .../reference-to-video
  const resolution = '480p' as const;
  const duration = nextRow.duration_s ?? 5;
  const pricing = await loadPricing();
  const cost = seedanceCostPerItem(pricing, r2vModel, resolution, duration);
  const returnLast = shouldReturnLastFrame(chainItems, next.sceneIndex);
  const prompt = buildContinuationPrompt(nextRow.scene_prompt as string, productPaths.length, characterPaths.length);

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
        returnLastFrame: returnLast,
        chain: {
          campaignId: chain.campaignId,
          sequenceId: chain.sequenceId,
          sceneIndex: next.sceneIndex,
          productImagePaths: productPaths,
          characterImagePaths: characterPaths,
          prevFramePath: framePath,
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

    const compiled = compile(
      {
        modelSlug: item.model_slug,
        scenePrompt: item.scene_prompt,
        durationS: item.duration_s ?? undefined,
        aspectRatio: item.aspect_ratio ?? undefined,
        generateAudio: item.audio,
      },
      directorContextFor(
        item,
        format,
        ctx,
        item.template_id ? templateVideos.get(item.template_id) : undefined,
        (item.reference_ids ?? []).map((id) => extraPaths.get(id)).filter((p): p is string => !!p),
      ),
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
    const cost = seedanceCostPerItem(pricing, item.model_slug, resolution, durationS);

    const refImages = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
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
        model_id: item.model_slug,
        prompt: compiled.compiled.prompt,
        params: {
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
                },
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
