import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPricing } from '@/lib/credits/pricing';
import { failGeneration, reserveCredits } from '@/lib/credits/operations';
import { enqueueJob } from '@/lib/jobs/queue';
import { compile, fromFormatRow, type DirectorContext } from '@/lib/prompt-director';
import { seedanceCostPerItem } from './estimate';
import { selectBatchItems } from './batch-selection';

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

  const result: BatchResult = { enqueued: 0, skipped: [], creditsReserved: 0 };

  for (let idx = 0; idx < selected.length; idx++) {
    const item = selected[idx];
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
    const refVideos = compiled.compiled.references.filter((r) => r.kind === 'video').map((r) => r.storagePath);
    const refAudios = compiled.compiled.references.filter((r) => r.kind === 'audio').map((r) => r.storagePath);

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
