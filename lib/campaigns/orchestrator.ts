import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPricing } from '@/lib/credits/pricing';
import { failGeneration, reserveCredits } from '@/lib/credits/operations';
import { enqueueJob } from '@/lib/jobs/queue';
import { compile, fromFormatRow, type DirectorContext } from '@/lib/prompt-director';
import { seedanceCostPerItem } from './estimate';

// Orquestador de lotes (specs/v2/03 tarea 5). Un lote = los items de un
// formato. Cada item se vuelve una generación V1 normal (cola QStash) con
// ESCALONAMIENTO: delay incremental para no reventar rate limits de fal.ai
// ni invocaciones de Vercel Hobby (doc V2 §5.5).
const STAGGER_SECONDS = 20;
const SAMPLE_SIZE = 2;

type ItemRow = {
  id: string;
  campaign_id: string;
  format_id: string | null;
  model_slug: string;
  duration_s: number | null;
  aspect_ratio: string | null;
  scene: string | null;
  audio: boolean;
  character_id: string | null;
  scene_prompt: string;
  status: string;
};

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
  characters: Map<string, { name: string; description: string; masterImagePath: string }>;
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
  campaign: { brand_kit_id: string | null; product_brief: Record<string, unknown> | null },
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
      .select('workspace_id, product_image_ids, packaging_image_ids')
      .eq('id', campaign.brand_kit_id)
      .single();
    if (kit && kit.workspace_id === workspaceId) {
      const productIds = (kit.product_image_ids ?? []) as string[];
      const packagingIds = (kit.packaging_image_ids ?? []) as string[];
      const paths = await resolvePaths(supabase, workspaceId, [...productIds, ...packagingIds]);
      productImagePaths = productIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
      packagingImagePaths = packagingIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
    }
  }

  const characters = new Map<string, { name: string; description: string; masterImagePath: string }>();
  if (characterIds.length) {
    const { data: rows } = await supabase
      .from('characters')
      .select('id, workspace_id, name, description, master_image_id, reference_image_ids')
      .in('id', characterIds);
    const imageIds: string[] = [];
    for (const c of rows ?? []) {
      const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0];
      if (masterId) imageIds.push(masterId);
    }
    const paths = await resolvePaths(supabase, workspaceId, imageIds);
    for (const c of rows ?? []) {
      if (c.workspace_id !== workspaceId) continue;
      const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0];
      const masterPath = masterId ? paths.get(masterId) : undefined;
      if (masterPath) {
        characters.set(c.id as string, {
          name: c.name as string,
          description: (c.description as string) ?? '',
          masterImagePath: masterPath,
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
  };
}

function directorContextFor(
  item: ItemRow,
  format: FormatRow | null,
  ctx: CampaignContext,
): DirectorContext {
  const character = item.character_id ? ctx.characters.get(item.character_id) : undefined;
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
    character: character
      ? {
          name: character.name,
          description: character.description,
          masterImagePath: character.masterImagePath,
        }
      : undefined,
    scene: item.scene ? { fragment: item.scene } : undefined,
  };
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
  };
  items: ItemRow[];
  formats: Map<string, FormatRow>;
  mode: 'sample' | 'full';
}): Promise<BatchResult> {
  const { userId, workspaceId, campaign, formats, mode } = params;
  const pending = params.items.filter((i) => i.status === 'planned' || i.status === 'failed');

  let selected: ItemRow[];
  if (mode === 'sample') {
    // Escenas distintas para que la muestra sea representativa.
    const seen = new Set<string>();
    selected = [];
    for (const item of pending) {
      const key = item.scene ?? item.id;
      if (!seen.has(key)) {
        seen.add(key);
        selected.push(item);
      }
      if (selected.length >= SAMPLE_SIZE) break;
    }
    if (selected.length < SAMPLE_SIZE) selected = pending.slice(0, SAMPLE_SIZE);
  } else {
    selected = pending;
  }
  if (selected.length === 0) return { enqueued: 0, skipped: [], creditsReserved: 0 };

  const characterIds = [...new Set(selected.map((i) => i.character_id).filter((c): c is string => !!c))];
  const ctx = await loadCampaignContext(workspaceId, campaign, characterIds);
  const pricing = await loadPricing();
  const supabase = await createClient();
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
      directorContextFor(item, format, ctx),
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
