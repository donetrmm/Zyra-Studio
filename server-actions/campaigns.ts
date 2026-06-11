'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { analyzeProductBrief, fetchProductPageText } from '@/lib/campaigns/brief';
import { buildPlan, type PlannerFormat } from '@/lib/campaigns/planner';
import { buildCaption } from '@/lib/campaigns/captions';
import { estimatePlanCost } from '@/lib/campaigns/estimate';
import { enqueueBatch } from '@/lib/campaigns/orchestrator';
import { enqueueJob } from '@/lib/jobs/queue';
import { failGeneration, reserveCredits } from '@/lib/credits/operations';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  AddCampaignItemSchema,
  ApproveBatchSchema,
  CreateCampaignStudioSchema,
  CreateVariantSchema,
  DistillTemplateSchema,
  GeneratePlanSchema,
  GenerateSeriesSchema,
  RequestFinalSchema,
  UpdateCampaignItemSchema,
} from '@/lib/schemas/campaigns';
import { seedanceCostPerItem } from '@/lib/campaigns/estimate';
import { buildSeries, buildTemplateParams, type TemplateFixedParams, type TemplateSlots } from '@/lib/campaigns/distill';
import { copyOutputVideoToReferences } from '@/lib/campaigns/video-ref';
import { buildCampaignCsv, type CsvRow } from '@/lib/campaigns/report';
import { signedOutputUrl } from '@/lib/supabase/storage';
import { compile } from '@/lib/prompt-director';
import { DIALOGUE_LANGUAGE } from '@/lib/prompt-director/compilers/seedance';

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
      color: parsed.data.color ?? '#009fff',
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

  // URL del producto (opcional): su texto entra como contexto del análisis.
  // Falla dura: si la URL no sirve, el usuario debe corregirla o quitarla.
  let extraContext: string | undefined;
  if (parsed.data.productUrl) {
    try {
      extraContext = await fetchProductPageText(parsed.data.productUrl);
    } catch (e) {
      return { ok: false, error: 'validation_error', message: `URL del producto: ${(e as Error).message}` };
    }
  }

  let brief;
  try {
    const { buffer, mimeType } = await downloadReferenceBuffer(refRow.storage_url as string);
    brief = await analyzeProductBrief({ imageBuffer: buffer, mimeType, extraContext });
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
      language: parsed.data.language,
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
    .select('id, workspace_id, brand_kit_id, goal, product_brief, date_start, date_end, status')
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
  const available = { product: false, packaging: false, character: false };
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

  // Aprendizaje: formatos con creativos ganadores o plantillas destiladas en
  // el workspace reciben doble peso en el mix de esta campaña.
  const [{ data: winnerRows }, { data: templateRows }] = await Promise.all([
    supabase
      .from('campaign_items')
      .select('format_id, campaigns!inner(workspace_id)')
      .eq('is_winner', true)
      .eq('campaigns.workspace_id', workspace.id),
    supabase.from('creative_templates').select('format_id').eq('workspace_id', workspace.id),
  ]);
  const winningFormatIds = new Set(
    [...(winnerRows ?? []), ...(templateRows ?? [])]
      .map((r) => r.format_id as string | null)
      .filter((id): id is string => !!id),
  );
  const winningSlugs = formats.filter((f) => winningFormatIds.has(f.id)).map((f) => f.slug);

  const goal = (['awareness', 'conversion', 'mixed'].includes(campaign.goal as string)
    ? campaign.goal
    : 'mixed') as 'awareness' | 'conversion' | 'mixed';
  const items = buildPlan({
    totalItems: parsed.data.totalItems,
    category: (brief.category as never) ?? 'other',
    productName: brief.productName,
    goal,
    formats,
    scenes,
    characters,
    available,
    winningSlugs,
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
      caption: i.caption,
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

  // Caption y fecha son metadatos de publicación: editables en cualquier
  // estado. Los campos de producción solo antes de encolar.
  const touchesProduction =
    parsed.data.scenePrompt !== undefined ||
    parsed.data.scene !== undefined ||
    parsed.data.durationS !== undefined ||
    parsed.data.aspectRatio !== undefined ||
    parsed.data.characterId !== undefined;
  if (touchesProduction && !['planned', 'skipped', 'failed'].includes(item.status as string)) {
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
  if (touchesProduction) patch.status = 'planned'; // editar un item failed/skipped lo re-habilita

  const { error } = await supabase.from('campaign_items').update(patch).eq('id', parsed.data.itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { updated: true } };
}

// Agrega un creativo suelto al plan (specs/v2/03 tarea 1: addItem).
export async function addCampaignItemAction(input: unknown): Promise<
  Result<{
    id: string;
    aspectRatio: string;
    durationS: number;
    caption: string;
    scheduledDate: string | null;
  }>
> {
  const parsed = AddCampaignItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, goal, product_brief')
    .eq('id', parsed.data.campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  const { data: format } = await supabase
    .from('formats')
    .select('id, slug, default_duration_s, default_audio')
    .eq('id', parsed.data.formatId)
    .single();
  if (!format) return { ok: false, error: 'not_found', message: 'Formato no encontrado' };

  const productName =
    ((campaign.product_brief as { productName?: string } | null)?.productName ?? '').trim() ||
    'el producto';
  const goal = (['awareness', 'conversion', 'mixed'].includes(campaign.goal as string)
    ? campaign.goal
    : 'mixed') as 'awareness' | 'conversion' | 'mixed';

  const durationS = parsed.data.durationS ?? (format.default_duration_s as number) ?? 8;
  const aspectRatio = (format.slug as string) === 'gran-pantalla' ? '16:9' : '9:16';
  const caption = buildCaption({
    productName,
    formatSlug: format.slug as string,
    goal,
    index: 0,
  });
  const scheduledDate = parsed.data.scheduledDate
    ? parsed.data.scheduledDate.toISOString().slice(0, 10)
    : null;

  const { data: inserted, error } = await supabase
    .from('campaign_items')
    .insert({
      campaign_id: campaign.id,
      format_id: format.id,
      model_slug: DRAFT_MODEL,
      duration_s: durationS,
      aspect_ratio: aspectRatio,
      scene: parsed.data.scene ?? null,
      audio: (format.default_audio as boolean) ?? true,
      character_id: parsed.data.characterId ?? null,
      scene_prompt: parsed.data.scenePrompt,
      caption,
      scheduled_date: scheduledDate,
      status: 'planned',
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, error: 'internal_error', message: error?.message };

  revalidatePath(`/app/campaigns/${campaign.id}`);
  return {
    ok: true,
    data: { id: inserted.id as string, aspectRatio, durationS, caption, scheduledDate },
  };
}

// Rehacer muestra (specs/v2/03 tarea 1: redoSamples): regresa los drafts del
// formato a 'planned' para editarlos o volver a tirar la muestra. Los videos
// ya generados quedan en la librería; rehacer cobra créditos de nuevo.
export async function redoSamplesAction(
  campaignId: string,
  formatId: string,
): Promise<Result<{ reset: number }>> {
  if (!z.string().uuid().safeParse(campaignId).success || !z.string().uuid().safeParse(formatId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  const { data: rows, error } = await supabase
    .from('campaign_items')
    .update({ status: 'planned', generation_id: null })
    .eq('campaign_id', campaignId)
    .eq('format_id', formatId)
    .eq('status', 'draft_ready')
    .select('id');
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaignId}`);
  return { ok: true, data: { reset: rows?.length ?? 0 } };
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
    .select('id, workspace_id, brand_kit_id, product_brief, language')
    .eq('id', parsed.data.campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, format_id, template_id, model_slug, duration_s, aspect_ratio, scene, audio, character_id, scene_prompt, status')
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
      language: campaign.language as string | null,
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

// ============================================================
// Fase D: plantillas vivas y variantes (specs/v2/04)
// ============================================================

// Destila un creativo ganador en plantilla viva: el video queda como
// referencia de estructura (@Video1 en la serie); producto, escena y
// personaje son slots rotables.
export async function distillTemplateAction(
  input: unknown,
): Promise<Result<{ templateId: string }>> {
  const parsed = DistillTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: gen } = await supabase
    .from('generations')
    .select('id, workspace_id, type, provider, model_id, status, output_url, params, campaign_id')
    .eq('id', parsed.data.generationId)
    .single();
  if (!gen || gen.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };
  if (gen.type !== 'video' || gen.status !== 'done' || !gen.output_url) {
    return { ok: false, error: 'validation_error', message: 'La generación no es un video terminado' };
  }

  // El item de campaña del ganador aporta formato y slots.
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, format_id, scene, scene_prompt, character_id, audio')
    .eq('generation_id', gen.id)
    .maybeSingle();
  if (!item) {
    return { ok: false, error: 'not_found', message: 'El video no pertenece a un item de campaña' };
  }

  const { data: campaign } = gen.campaign_id
    ? await supabase.from('campaigns').select('product_brief').eq('id', gen.campaign_id as string).single()
    : { data: null };
  const productName =
    ((campaign?.product_brief ?? {}) as { productName?: string }).productName ?? 'the product';

  let templateVideoPath: string;
  try {
    templateVideoPath = await copyOutputVideoToReferences({
      workspaceId: workspace.id,
      userId: user.id,
      outputPath: gen.output_url as string,
      label: 'template',
    });
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }

  const genParams = (gen.params ?? {}) as Record<string, unknown>;
  const fixed = buildTemplateParams({
    modelSlug: gen.model_id as string,
    durationS: (genParams.duration as number | null) ?? null,
    aspectRatio: (genParams.aspectRatio as string | null) ?? null,
    resolution: (genParams.resolution as string | null) ?? null,
    audio: (genParams.generateAudio as boolean | undefined) ?? (item.audio as boolean) ?? true,
    templateVideoPath,
  });
  const slots: TemplateSlots = {
    scenePrompt: item.scene_prompt as string,
    scene: (item.scene as string | null) ?? null,
    characterId: (item.character_id as string | null) ?? null,
    productName,
  };

  const { data: inserted, error } = await supabase
    .from('creative_templates')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      source_generation_id: gen.id,
      format_id: item.format_id,
      fixed_params: fixed,
      slots,
    })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, error: 'internal_error', message: error?.message };

  // Destilar es la señal de ganador más fuerte: marca el item para el
  // ciclo de aprendizaje (el mix de la siguiente campaña lo pondera).
  await supabase.from('campaign_items').update({ is_winner: true }).eq('id', item.id);

  if (gen.campaign_id) revalidatePath(`/app/campaigns/${gen.campaign_id}`);
  return { ok: true, data: { templateId: inserted.id as string } };
}

// Marca o desmarca un creativo final como ganador (doc V2 §4.1 etapa 5).
export async function toggleWinnerAction(itemId: string): Promise<Result<{ isWinner: boolean }>> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, status, is_winner, campaigns!inner(workspace_id)')
    .eq('id', itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };
  if (item.status !== 'final_ready') {
    return { ok: false, error: 'validation_error', message: 'Solo los finales pueden marcarse como ganadores' };
  }

  const next = !(item.is_winner as boolean);
  const { error } = await supabase
    .from('campaign_items')
    .update({ is_winner: next })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { isWinner: next } };
}

// Genera una serie desde la plantilla: N items nuevos en la campaña de origen
// rotando escena (y opcionalmente personaje); estructura fija vía @Video1.
// Pasan por el flujo normal de lotes/compuertas.
export async function generateSeriesAction(
  input: unknown,
): Promise<Result<{ items: number; campaignId: string }>> {
  const parsed = GenerateSeriesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: template } = await supabase
    .from('creative_templates')
    .select('id, workspace_id, format_id, fixed_params, slots, uses_count, source_generation_id')
    .eq('id', parsed.data.templateId)
    .single();
  if (!template || template.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };

  const fixed = template.fixed_params as TemplateFixedParams;
  const slots = template.slots as TemplateSlots;
  if (!fixed?.templateVideoPath || !slots?.scenePrompt) {
    return { ok: false, error: 'validation_error', message: 'Plantilla incompleta' };
  }

  // Campaña destino: la de origen del ganador.
  const { data: sourceGen } = await supabase
    .from('generations')
    .select('campaign_id')
    .eq('id', template.source_generation_id as string)
    .single();
  const campaignId = (sourceGen?.campaign_id as string | null) ?? null;
  if (!campaignId) {
    return { ok: false, error: 'not_found', message: 'La campaña de origen ya no existe' };
  }

  // Para los captions de la serie: producto y objetivo de la campaña de origen.
  const { data: campaignRow } = await supabase
    .from('campaigns')
    .select('goal, product_brief')
    .eq('id', campaignId)
    .single();
  const seriesProduct =
    ((campaignRow?.product_brief as { productName?: string } | null)?.productName ?? '').trim() ||
    'el producto';
  const seriesGoal = (['awareness', 'conversion', 'mixed'].includes(campaignRow?.goal as string)
    ? campaignRow?.goal
    : 'mixed') as 'awareness' | 'conversion' | 'mixed';
  let seriesFormatSlug = '';
  if (template.format_id) {
    const { data: fmt } = await supabase
      .from('formats')
      .select('slug')
      .eq('id', template.format_id as string)
      .single();
    seriesFormatSlug = (fmt?.slug as string) ?? '';
  }

  // La serie se programa DESPUÉS del último creativo del calendario existente
  // (no encima de él): continúa la campaña, no la pisa.
  const { data: lastItem } = await supabase
    .from('campaign_items')
    .select('scheduled_date')
    .eq('campaign_id', campaignId)
    .not('scheduled_date', 'is', null)
    .order('scheduled_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const today = new Date();
  const lastDate = lastItem?.scheduled_date ? new Date(`${lastItem.scheduled_date}T12:00:00`) : null;
  const seriesStart =
    lastDate && lastDate.getTime() > today.getTime()
      ? new Date(lastDate.getTime() + 24 * 60 * 60 * 1000)
      : today;

  const [{ data: sceneRows }, { data: characterRows }] = await Promise.all([
    supabase.from('scene_library').select('name, prompt_fragment').eq('type', 'escena'),
    supabase
      .from('characters')
      .select('id, name, master_image_id, reference_image_ids')
      .eq('workspace_id', workspace.id),
  ]);
  const characters = (characterRows ?? [])
    .filter((c) => c.master_image_id || ((c.reference_image_ids as string[]) ?? []).length > 0)
    .map((c) => ({ id: c.id as string, name: c.name as string }));

  const items = buildSeries({
    templateId: template.id as string,
    formatId: (template.format_id as string | null) ?? null,
    fixed,
    slots,
    count: parsed.data.count,
    scenes: (sceneRows ?? []).map((s) => ({
      name: s.name as string,
      fragment: s.prompt_fragment as string,
    })),
    characters,
    rotateCharacters: parsed.data.rotateCharacters,
    startDate: seriesStart,
  });
  if (items.length === 0) return { ok: false, error: 'validation_error', message: 'Sin escenas para rotar' };

  const { error: insertErr } = await supabase.from('campaign_items').insert(
    items.map((i, idx) => ({
      campaign_id: campaignId,
      format_id: i.formatId,
      template_id: i.templateId,
      model_slug: i.modelSlug,
      duration_s: i.durationS,
      aspect_ratio: i.aspectRatio,
      scene: i.scene,
      audio: i.audio,
      character_id: i.characterId,
      scene_prompt: i.scenePrompt,
      caption: buildCaption({
        productName: seriesProduct,
        formatSlug: seriesFormatSlug,
        goal: seriesGoal,
        index: idx,
      }),
      scheduled_date: i.scheduledDate,
      status: 'planned',
    })),
  );
  if (insertErr) return { ok: false, error: 'internal_error', message: insertErr.message };

  await supabase
    .from('creative_templates')
    .update({ uses_count: ((template.uses_count as number) ?? 0) + 1 })
    .eq('id', template.id);

  revalidatePath(`/app/campaigns/${campaignId}`);
  return { ok: true, data: { items: items.length, campaignId } };
}

// Variante dirigida sobre un video terminado: extender la acción o reemplazar
// al personaje conservando todo lo demás (edición de video de Seedance).
export async function createVariantAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = CreateVariantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: gen } = await supabase
    .from('generations')
    .select('id, workspace_id, type, status, output_url, params, model_id, campaign_id')
    .eq('id', parsed.data.generationId)
    .single();
  if (!gen || gen.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };
  if (gen.type !== 'video' || gen.status !== 'done' || !gen.output_url) {
    return { ok: false, error: 'validation_error', message: 'La generación no es un video terminado' };
  }
  const genParams = (gen.params ?? {}) as Record<string, unknown>;
  const sourceResolution = ((genParams.resolution as string) ?? '720p') as '480p' | '720p' | '1080p';
  const sourceDuration = (genParams.duration as number | undefined) ?? 8;

  // Idioma del diálogo de la campaña de origen (migración 029); default es.
  let variantLanguage: 'es' | 'en' = 'es';
  if (gen.campaign_id) {
    const { data: langRow } = await supabase
      .from('campaigns')
      .select('language')
      .eq('id', gen.campaign_id as string)
      .single();
    if (langRow?.language === 'en') variantLanguage = 'en';
  }

  let videoRefPath: string;
  try {
    videoRefPath = await copyOutputVideoToReferences({
      workspaceId: workspace.id,
      userId: user.id,
      outputPath: gen.output_url as string,
      label: 'variant',
    });
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }

  let prompt: string;
  let durationS: number;
  const imagePaths: string[] = [];
  const videoPaths: string[] = [videoRefPath];

  if (parsed.data.mode === 'extend') {
    // Regla de las guías: duración de salida = LA EXTENSIÓN, no el total.
    durationS = parsed.data.extendSeconds ?? 5;
    const continuation = parsed.data.continuation?.trim()
      ? ` ${parsed.data.continuation.trim().replace(/\.?$/, '.')}`
      : '';
    prompt =
      `Extend @Video1 by ${durationS} seconds.${continuation} ` +
      'Continue the motion smoothly from the last frame with no cuts: same camera angle, lighting, ' +
      'pacing and subject appearance. No on-screen text, no captions, no watermarks.';
  } else if (parsed.data.mode === 'change_action') {
    // Edición de video (doc V2 §4.5): cambia la acción/desenlace acotando lo
    // intocable — sujeto, escenario, luz y cámara se conservan.
    durationS = Math.min(15, Math.max(4, sourceDuration));
    const action = (parsed.data.newAction as string).trim().replace(/\.?$/, '.');
    prompt =
      'In @Video1, keep the subject identity, the setting, the lighting and the camera style ' +
      `exactly as shown; change the action and outcome: ${action} ` +
      'One continuous take, no cuts. No on-screen text, no captions, no watermarks.';
  } else if (parsed.data.mode === 'bridge') {
    // Escena puente (doc V2 §4.5): conecta el final de @Video1 con el inicio
    // de @Video2 para montar narrativas multi-clip.
    const { data: target } = await supabase
      .from('generations')
      .select('id, workspace_id, type, status, output_url')
      .eq('id', parsed.data.targetGenerationId as string)
      .single();
    if (!target || target.workspace_id !== workspace.id) {
      return { ok: false, error: 'not_found', message: 'Clip destino no encontrado' };
    }
    if (target.type !== 'video' || target.status !== 'done' || !target.output_url) {
      return { ok: false, error: 'validation_error', message: 'El clip destino no es un video terminado' };
    }
    let targetRefPath: string;
    try {
      targetRefPath = await copyOutputVideoToReferences({
        workspaceId: workspace.id,
        userId: user.id,
        outputPath: target.output_url as string,
        label: 'bridge',
      });
    } catch (e) {
      return { ok: false, error: 'internal_error', message: (e as Error).message };
    }
    videoPaths.push(targetRefPath);
    durationS = parsed.data.bridgeSeconds ?? 5;
    prompt =
      `Generate a ${durationS}-second bridge scene that connects @Video1 to @Video2: ` +
      'start from the final frame of @Video1 and end matching the first frame of @Video2. ' +
      'Maintain continuity of subject, environment, lighting and camera style throughout; ' +
      'one smooth camera move, no cuts. No on-screen text, no captions, no watermarks.';
  } else {
    // replace_character
    const { data: character } = await supabase
      .from('characters')
      .select('id, workspace_id, name, master_image_id, reference_image_ids')
      .eq('id', parsed.data.characterId as string)
      .single();
    if (!character || character.workspace_id !== workspace.id) {
      return { ok: false, error: 'not_found', message: 'Personaje no encontrado' };
    }
    const masterId =
      (character.master_image_id as string | null) ??
      ((character.reference_image_ids as string[]) ?? [])[0];
    if (!masterId) {
      return { ok: false, error: 'validation_error', message: 'El personaje no tiene hoja maestra' };
    }
    const { data: refRow } = await supabase
      .from('media_references')
      .select('storage_url, workspace_id')
      .eq('id', masterId)
      .single();
    if (!refRow?.storage_url || refRow.workspace_id !== workspace.id) {
      return { ok: false, error: 'not_found', message: 'Hoja maestra no encontrada' };
    }
    imagePaths.push(refRow.storage_url as string);
    durationS = Math.min(15, Math.max(4, sourceDuration));
    prompt =
      'In @Video1, replace the presenter with the person in @Image1 — exact appearance from the ' +
      'reference: same face, same hair, same build. Replicate the original actions, gestures, ' +
      'expressions and timing frame by frame. Keep the scene, lighting and camera movements ' +
      'unchanged. No on-screen text, no captions, no watermarks.';
  }

  // El audio se conserva/regenera: el diálogo debe seguir en el idioma de la campaña.
  prompt = `${prompt} ${DIALOGUE_LANGUAGE[variantLanguage]}`;

  const modelSlug = 'bytedance/seedance-2.0/reference-to-video';
  const variantResolution = sourceResolution === '1080p' ? '720p' : sourceResolution;
  const pricing = await loadPricing();
  const cost = seedanceCostPerItem(pricing, modelSlug, variantResolution, durationS);

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'video',
      provider: 'seedance',
      model_id: modelSlug,
      prompt,
      params: {
        operation: 'reference2video',
        aspectRatio: (genParams.aspectRatio as string) ?? '9:16',
        resolution: variantResolution,
        duration: durationS,
        generateAudio: (genParams.generateAudio as boolean | undefined) ?? true,
        referenceImagePaths: imagePaths,
        referenceVideoPaths: videoPaths,
        referenceAudioPaths: [],
      },
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      campaign_id: gen.campaign_id,
      parent_generation_id: gen.id,
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
    if (gen.campaign_id) revalidatePath(`/app/campaigns/${gen.campaign_id}`);
    revalidatePath('/app/library');
    return { ok: true, data: { generationId } };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    try {
      await failGeneration(user.id, generationId, reserved ? cost : 0, `variant_enqueue: ${message}`);
    } catch (failErr) {
      console.error('[create_variant:fail_generation]', {
        generationId,
        error: message,
        failError: (failErr as Error)?.message,
      });
    }
    return { ok: false, error: 'internal_error', message };
  }
}

// ============================================================
// Fase E: entrega y reporte (specs/v2/05)
// ============================================================

// Reprogramar la fecha de publicación de un item desde el calendario.
// Solo toca la fecha: permitido en cualquier estado (la fecha es de
// publicación, no de generación).
export async function updateItemScheduleAction(
  itemId: string,
  dateIso: string,
): Promise<Result<{ updated: true }>> {
  if (!z.string().uuid().safeParse(itemId).success || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, campaigns!inner(workspace_id)')
    .eq('id', itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };
  const { error } = await supabase
    .from('campaign_items')
    .update({ scheduled_date: dateIso })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { updated: true } };
}

// Export del calendario a CSV: fecha, formato, escena, caption y URL firmada
// del archivo (expira; el export es para publicar hoy, no para archivar).
export async function exportCampaignCsvAction(
  campaignId: string,
): Promise<Result<{ csv: string; filename: string }>> {
  if (!z.string().uuid().safeParse(campaignId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, workspace_id')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  const [{ data: itemRows }, { data: formatRows }] = await Promise.all([
    supabase
      .from('campaign_items')
      .select('format_id, scene, scene_prompt, duration_s, aspect_ratio, status, caption, scheduled_date, generation_id')
      .eq('campaign_id', campaignId)
      .order('scheduled_date'),
    supabase.from('formats').select('id, name'),
  ]);
  const formatNames = new Map((formatRows ?? []).map((f) => [f.id as string, f.name as string]));

  // URLs firmadas solo para items con video listo.
  const genIds = (itemRows ?? [])
    .filter((r) => ['draft_ready', 'final_ready'].includes(r.status as string) && r.generation_id)
    .map((r) => r.generation_id as string);
  const urlByGen = new Map<string, string>();
  if (genIds.length) {
    const { data: gens } = await supabase
      .from('generations')
      .select('id, output_url, status')
      .in('id', genIds);
    await Promise.all(
      (gens ?? [])
        .filter((g) => g.status === 'done' && g.output_url)
        .map(async (g) => {
          try {
            urlByGen.set(g.id as string, await signedOutputUrl(g.output_url as string));
          } catch {
            // sin URL: la celda queda vacía
          }
        }),
    );
  }

  const rows: CsvRow[] = (itemRows ?? []).map((r) => ({
    date: (r.scheduled_date as string | null) ?? '',
    format: r.format_id ? (formatNames.get(r.format_id as string) ?? '') : '',
    scene: (r.scene as string | null) ?? '',
    durationS: (r.duration_s as number | null) ?? null,
    aspectRatio: (r.aspect_ratio as string | null) ?? '',
    status: r.status as string,
    caption: (r.caption as string | null) ?? '',
    fileUrl: r.generation_id ? (urlByGen.get(r.generation_id as string) ?? '') : '',
  }));

  const slug = (campaign.name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return {
    ok: true,
    data: { csv: buildCampaignCsv(rows), filename: `${slug || 'campana'}-calendario.csv` },
  };
}

// Pack de imágenes complementario (specs/v2/05 tarea 5): compila prompts FLUX
// desde las escenas ganadoras. El cliente genera cada imagen con el flujo
// normal de imagen (submitGenerationAction), una por llamada — cada una se
// cobra y aparece en la librería de la campaña.
export async function buildImagePackAction(
  campaignId: string,
  count: number,
): Promise<
  Result<{
    specs: Array<{ prompt: string; aspectRatio: '1:1' | '16:9'; kind: string }>;
    references: Array<{ id: string; storagePath: string }>;
  }>
> {
  if (!z.string().uuid().safeParse(campaignId).success || ![4, 6, 8].includes(count)) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, brand_kit_id, product_brief')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };
  const brief = (campaign.product_brief ?? {}) as {
    productName?: string;
    visualDetails?: string;
    palette?: string[];
  };
  if (!brief.productName) return { ok: false, error: 'validation_error', message: 'Campaña sin brief' };

  // Escenas ganadoras: finales primero, drafts como fallback.
  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('scene, status')
    .eq('campaign_id', campaignId)
    .in('status', ['final_ready', 'draft_ready'])
    .order('status'); // draft_ready < final_ready alfabéticamente; ambas sirven
  const scenes = [...new Set((itemRows ?? []).map((r) => r.scene as string | null).filter((s): s is string => !!s))];
  if (scenes.length === 0) {
    return { ok: false, error: 'validation_error', message: 'Genera al menos un video antes del pack' };
  }

  // Referencias de producto del Brand Kit (FLUX acepta hasta 8; usamos 3).
  let references: Array<{ id: string; storagePath: string }> = [];
  if (campaign.brand_kit_id) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('product_image_ids, reference_image_ids')
      .eq('id', campaign.brand_kit_id as string)
      .single();
    const ids = (((kit?.product_image_ids as string[]) ?? []).length
      ? ((kit?.product_image_ids as string[]) ?? [])
      : ((kit?.reference_image_ids as string[]) ?? [])
    ).slice(0, 3);
    if (ids.length) {
      const { data: refs } = await supabase
        .from('media_references')
        .select('id, storage_url, workspace_id')
        .in('id', ids);
      references = (refs ?? [])
        .filter((r) => r.workspace_id === workspace.id && r.storage_url)
        .map((r) => ({ id: r.id as string, storagePath: r.storage_url as string }));
    }
  }

  const product = {
    name: brief.productName,
    visualDetails: brief.visualDetails,
    palette: brief.palette,
    imagePaths: references.map((r) => r.storagePath),
  };

  // Mix del pack: mitad posts 1:1 (escenas ganadoras), cuarto banners 16:9
  // (espacio limpio para copy — el texto va en post, no quemado), cuarto
  // stills de producto sin personas.
  const specs: Array<{ prompt: string; aspectRatio: '1:1' | '16:9'; kind: string }> = [];
  const posts = Math.ceil(count / 2);
  const banners = Math.ceil(count / 4);
  const stills = count - posts - banners;

  const pushSpec = (scenePrompt: string, sceneFragment: string | undefined, aspectRatio: '1:1' | '16:9', kind: string) => {
    const compiled = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt, aspectRatio },
      { product, scene: sceneFragment ? { fragment: sceneFragment } : undefined },
    );
    if (compiled.ok) specs.push({ prompt: compiled.compiled.prompt, aspectRatio, kind });
  };

  for (let i = 0; i < posts; i++) {
    pushSpec(
      `Lifestyle still of the ${brief.productName} as the natural focus of the scene, social-media ready, no people in frame unless implied by context`,
      scenes[i % scenes.length],
      '1:1',
      'post',
    );
  }
  for (let i = 0; i < banners; i++) {
    pushSpec(
      `Hero banner composition of the ${brief.productName}: product on one third of the frame, generous clean negative space on the other side for campaign copy, premium minimal styling`,
      undefined,
      '16:9',
      'banner',
    );
  }
  for (let i = 0; i < stills; i++) {
    pushSpec(
      `Studio product still of the ${brief.productName} on a simple textured surface, no people, label facing the camera, subtle props that suggest the product context`,
      undefined,
      '1:1',
      'still',
    );
  }

  if (specs.length === 0) return { ok: false, error: 'internal_error', message: 'No se pudieron compilar los prompts' };
  return { ok: true, data: { specs, references } };
}
