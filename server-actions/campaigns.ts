'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { analyzeProductBrief } from '@/lib/campaigns/brief';
import { buildPlan, type PlannerFormat } from '@/lib/campaigns/planner';
import { estimatePlanCost } from '@/lib/campaigns/estimate';
import { enqueueBatch } from '@/lib/campaigns/orchestrator';
import { enqueueJob } from '@/lib/jobs/queue';
import { failGeneration, reserveCredits } from '@/lib/credits/operations';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ApproveBatchSchema,
  CreateCampaignStudioSchema,
  GeneratePlanSchema,
  RequestFinalSchema,
  UpdateCampaignItemSchema,
} from '@/lib/schemas/campaigns';
import { seedanceCostPerItem } from '@/lib/campaigns/estimate';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const DRAFT_MODEL = 'bytedance/seedance-2.0/fast/reference-to-video';
const FINAL_MODEL = 'bytedance/seedance-2.0/reference-to-video';

const CampaignSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function createCampaignAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? '#7c3aed',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/campaigns');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateCampaignAction(id: string, input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = CampaignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      color: parsed.data.color,
    })
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/campaigns');
  return { ok: true, data: { updated: true } };
}

export async function deleteCampaignAction(id: string): Promise<Result<{ deleted: true }>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/campaigns');
  return { ok: true, data: { deleted: true } };
}

export async function assignCampaignAction(
  generationId: string,
  campaignId: string | null,
): Promise<Result<{ assigned: true }>> {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('generations')
    .update({ campaign_id: campaignId })
    .eq('id', generationId)
    .eq('user_id', user.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/library');
  revalidatePath('/app/campaigns');
  return { ok: true, data: { assigned: true } };
}

export async function listCampaignsAction(): Promise<Result<{ id: string; name: string; color: string }[]>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, color')
    .eq('workspace_id', workspace.id)
    .order('name');
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  return { ok: true, data: (data ?? []) as { id: string; name: string; color: string }[] };
}

// ============================================================
// Campaign Studio V2 (specs/v2/03)
// ============================================================

// Crea la campaña orquestable: analiza el brief desde la primera imagen de
// producto del Brand Kit (auto-detección — nunca preguntar lo inferible).
export async function createCampaignStudioAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = CreateCampaignStudioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Brand Kit con al menos una imagen de producto (columna vertebral de V2).
  const { data: kit } = await supabase
    .from('brand_kits')
    .select('id, workspace_id, product_image_ids, reference_image_ids')
    .eq('id', parsed.data.brandKitId)
    .single();
  if (!kit || kit.workspace_id !== workspace.id) {
    return { ok: false, error: 'not_found', message: 'Brand Kit no encontrado' };
  }
  const productImageIds = ((kit.product_image_ids as string[]) ?? []).length
    ? (kit.product_image_ids as string[])
    : ((kit.reference_image_ids as string[]) ?? []);
  if (productImageIds.length === 0) {
    return { ok: false, error: 'validation_error', message: 'El Brand Kit necesita al menos una imagen de producto' };
  }

  // Auto-detección del brief con la primera imagen.
  const { data: refRow } = await supabase
    .from('media_references')
    .select('storage_url, workspace_id')
    .eq('id', productImageIds[0])
    .single();
  if (!refRow || refRow.workspace_id !== workspace.id || !refRow.storage_url) {
    return { ok: false, error: 'not_found', message: 'Imagen de producto no encontrada' };
  }

  let brief;
  try {
    const { buffer, mimeType } = await downloadReferenceBuffer(refRow.storage_url as string);
    brief = await analyzeProductBrief({ imageBuffer: buffer, mimeType });
  } catch (e) {
    return { ok: false, error: 'provider_error', message: (e as Error).message };
  }

  const dateStart = parsed.data.dateStart ?? new Date();
  const dateEnd =
    parsed.data.dateEnd ?? new Date(dateStart.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { data: inserted, error } = await supabase
    .from('campaigns')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      goal: parsed.data.goal,
      market: parsed.data.market ?? brief.market,
      brand_kit_id: kit.id,
      product_brief: brief,
      date_start: dateStart.toISOString().slice(0, 10),
      date_end: dateEnd.toISOString().slice(0, 10),
      status: 'draft',
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, error: 'internal_error', message: error?.message };

  revalidatePath('/app/campaigns');
  return { ok: true, data: { id: inserted.id as string } };
}

// Genera el plan: mix por categoría, escenas y personajes rotados, fechas
// intercaladas, estimación de créditos en tier draft.
export async function generatePlanAction(input: unknown): Promise<Result<{ items: number; creditsEstimated: number }>> {
  const parsed = GeneratePlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, brand_kit_id, product_brief, date_start, date_end, status')
    .eq('id', parsed.data.campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };
  const brief = (campaign.product_brief ?? {}) as {
    productName?: string;
    category?: string;
  };
  if (!brief.productName) {
    return { ok: false, error: 'validation_error', message: 'La campaña no tiene brief de producto' };
  }

  // Disponibilidad de referencias (el plan nunca propone formatos bloqueados).
  let available = { product: false, packaging: false, character: false };
  if (campaign.brand_kit_id) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('id', campaign.brand_kit_id)
      .single();
    const productIds = ((kit?.product_image_ids as string[]) ?? []).length
      ? ((kit?.product_image_ids as string[]) ?? [])
      : ((kit?.reference_image_ids as string[]) ?? []);
    available.product = productIds.length > 0;
    available.packaging = ((kit?.packaging_image_ids as string[]) ?? []).length > 0;
  }

  const { data: characterRows } = await supabase
    .from('characters')
    .select('id, name, master_image_id, reference_image_ids')
    .eq('workspace_id', workspace.id);
  const characters = (characterRows ?? [])
    .filter((c) => c.master_image_id || ((c.reference_image_ids as string[]) ?? []).length > 0)
    .map((c) => ({ id: c.id as string, name: c.name as string }));
  available.character = characters.length > 0;

  const { data: formatRows } = await supabase
    .from('formats')
    .select('id, slug, name, required_refs, default_duration_s, default_audio')
    .or(`is_system.eq.true,workspace_id.eq.${workspace.id}`);
  const formats: PlannerFormat[] = (formatRows ?? []).map((f) => ({
    id: f.id as string,
    slug: f.slug as string,
    name: f.name as string,
    requiredRefs: (f.required_refs as string[]) ?? [],
    defaultDurationS: f.default_duration_s as number,
    defaultAudio: f.default_audio as boolean,
  }));

  const { data: sceneRows } = await supabase
    .from('scene_library')
    .select('name, prompt_fragment')
    .eq('type', 'escena');
  const scenes = (sceneRows ?? []).map((s) => ({
    name: s.name as string,
    fragment: s.prompt_fragment as string,
  }));

  const items = buildPlan({
    totalItems: parsed.data.totalItems,
    category: (brief.category as never) ?? 'other',
    productName: brief.productName,
    formats,
    scenes,
    characters,
    available,
    dateStart: campaign.date_start ? new Date(campaign.date_start as string) : new Date(),
    dateEnd: campaign.date_end
      ? new Date(campaign.date_end as string)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    draftModelSlug: DRAFT_MODEL,
  });
  if (items.length === 0) {
    return { ok: false, error: 'validation_error', message: 'No hay formatos viables: revisa Brand Kit y Cast' };
  }

  const pricing = await loadPricing();
  const { total } = estimatePlanCost(
    pricing,
    items.map((i) => ({ modelSlug: i.modelSlug, durationS: i.durationS })),
    '480p',
  );

  // Re-planificar: limpiar items previos no generados.
  await supabase
    .from('campaign_items')
    .delete()
    .eq('campaign_id', campaign.id)
    .in('status', ['planned', 'skipped']);

  const { error: insertErr } = await supabase.from('campaign_items').insert(
    items.map((i) => ({
      campaign_id: campaign.id,
      format_id: i.formatId,
      model_slug: i.modelSlug,
      duration_s: i.durationS,
      aspect_ratio: i.aspectRatio,
      scene: i.scene,
      audio: i.audio,
      character_id: i.characterId,
      scene_prompt: i.scenePrompt,
      scheduled_date: i.scheduledDate,
      status: 'planned',
    })),
  );
  if (insertErr) return { ok: false, error: 'internal_error', message: insertErr.message };

  await supabase
    .from('campaigns')
    .update({ status: 'planned', total_items: items.length, credits_estimated: total })
    .eq('id', campaign.id);

  revalidatePath(`/app/campaigns/${campaign.id}`);
  return { ok: true, data: { items: items.length, creditsEstimated: total } };
}

export async function updateCampaignItemAction(input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = UpdateCampaignItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership vía join campaña→workspace (RLS también lo cubre; defensa doble).
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, status, campaigns!inner(workspace_id)')
    .eq('id', parsed.data.itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };
  if (!['planned', 'skipped', 'failed'].includes(item.status as string)) {
    return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.scenePrompt !== undefined) patch.scene_prompt = parsed.data.scenePrompt;
  if (parsed.data.scene !== undefined) patch.scene = parsed.data.scene;
  if (parsed.data.durationS !== undefined) patch.duration_s = parsed.data.durationS;
  if (parsed.data.aspectRatio !== undefined) patch.aspect_ratio = parsed.data.aspectRatio;
  if (parsed.data.characterId !== undefined) patch.character_id = parsed.data.characterId;
  if (parsed.data.scheduledDate !== undefined) {
    patch.scheduled_date = parsed.data.scheduledDate.toISOString().slice(0, 10);
  }
  if (parsed.data.caption !== undefined) patch.caption = parsed.data.caption;
  patch.status = 'planned'; // editar un item failed/skipped lo re-habilita

  const { error } = await supabase.from('campaign_items').update(patch).eq('id', parsed.data.itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { updated: true } };
}

export async function deleteCampaignItemAction(itemId: string): Promise<Result<{ deleted: true }>> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, status, campaigns!inner(workspace_id)')
    .eq('id', itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };
  if (!['planned', 'skipped', 'failed'].includes(item.status as string)) {
    return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
  }
  const { error } = await supabase.from('campaign_items').delete().eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { deleted: true } };
}

// Compuerta del lote: 'sample' genera 2 de muestra, 'full' el resto del formato.
export async function approveBatchAction(
  input: unknown,
): Promise<Result<{ enqueued: number; skipped: number; creditsReserved: number }>> {
  const parsed = ApproveBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, brand_kit_id, product_brief')
    .eq('id', parsed.data.campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, format_id, model_slug, duration_s, aspect_ratio, scene, audio, character_id, scene_prompt, status')
    .eq('campaign_id', campaign.id)
    .eq('format_id', parsed.data.formatId)
    .order('created_at');
  if (!itemRows?.length) return { ok: false, error: 'not_found', message: 'Sin items para este formato' };

  const { data: formatRows } = await supabase
    .from('formats')
    .select('id, slug, name, register, camera_style, pacing, required_refs, default_duration_s, default_audio')
    .eq('id', parsed.data.formatId);
  const formatsMap = new Map(
    (formatRows ?? []).map((f) => [
      f.id as string,
      {
        id: f.id as string,
        slug: f.slug as string,
        name: f.name as string,
        register: f.register as string | null,
        camera_style: f.camera_style as string | null,
        pacing: f.pacing as string | null,
        required_refs: (f.required_refs as string[]) ?? [],
        default_duration_s: f.default_duration_s as number,
        default_audio: f.default_audio as boolean,
      },
    ]),
  );

  const result = await enqueueBatch({
    userId: user.id,
    workspaceId: workspace.id,
    campaign: {
      id: campaign.id as string,
      brand_kit_id: campaign.brand_kit_id as string | null,
      product_brief: campaign.product_brief as Record<string, unknown> | null,
    },
    items: itemRows as never,
    formats: formatsMap,
    mode: parsed.data.mode,
  });

  if (result.enqueued > 0) {
    await supabase.from('campaigns').update({ status: 'producing' }).eq('id', campaign.id);
  }
  const insufficientCredits = result.skipped.some((s) => s.reason === 'insufficient_credits');
  if (insufficientCredits && result.enqueued === 0) {
    return { ok: false, error: 'insufficient_credits' };
  }

  revalidatePath(`/app/campaigns/${campaign.id}`);
  return {
    ok: true,
    data: {
      enqueued: result.enqueued,
      skipped: result.skipped.length,
      creditsReserved: result.creditsReserved,
    },
  };
}

// Draft aprobado → render final: re-encola el MISMO prompt con tier standard
// 720p y el seed real del draft (composición estable, doc V2 §4.6).
export async function requestFinalAction(input: unknown): Promise<Result<{ generationId: string }>> {
  const parsed = RequestFinalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, status, generation_id, duration_s, campaigns!inner(workspace_id)')
    .eq('id', parsed.data.itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };
  if (item.status !== 'draft_ready' || !item.generation_id) {
    return { ok: false, error: 'forbidden', message: 'El item no tiene draft listo' };
  }

  const { data: draft } = await supabase
    .from('generations')
    .select('id, prompt, params, provider_payload, model_id, workspace_id')
    .eq('id', item.generation_id as string)
    .single();
  if (!draft || draft.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };

  const draftParams = (draft.params ?? {}) as Record<string, unknown>;
  const payload = (draft.provider_payload ?? {}) as { seed?: number };
  const durationS = (draftParams.duration as number | undefined) ?? item.duration_s ?? 8;

  const pricing = await loadPricing();
  const cost = seedanceCostPerItem(pricing, FINAL_MODEL, '720p', durationS);

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'video',
      provider: 'seedance',
      model_id: FINAL_MODEL,
      prompt: draft.prompt,
      params: {
        ...draftParams,
        resolution: '720p',
        ...(payload.seed !== undefined ? { seed: payload.seed } : {}),
      },
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      campaign_id: item.campaign_id,
      parent_generation_id: draft.id,
      timeout_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
  const generationId = inserted.id as string;

  let reserved = false;
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }
    await enqueueJob({ generationId, action: 'submit' });
    await supabase
      .from('campaign_items')
      .update({ status: 'approved', generation_id: generationId })
      .eq('id', item.id);
    revalidatePath(`/app/campaigns/${item.campaign_id}`);
    return { ok: true, data: { generationId } };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    try {
      await failGeneration(user.id, generationId, reserved ? cost : 0, `final_enqueue: ${message}`);
    } catch (failErr) {
      console.error('[request_final:fail_generation]', {
        generationId,
        error: message,
        failError: (failErr as Error)?.message,
      });
    }
    return { ok: false, error: 'internal_error', message };
  }
}
