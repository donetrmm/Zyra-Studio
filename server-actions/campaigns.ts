'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { analyzeProductBrief, fetchProductPageText } from '@/lib/campaigns/brief';
import {
  buildDirectedPlan,
  buildPlan,
  type DirectedIdea,
  type PlanItemDraft,
  type PlannerFormat,
} from '@/lib/campaigns/planner';
import { buildCaption } from '@/lib/campaigns/captions';
import { estimatePlanCost } from '@/lib/campaigns/estimate';
import { buildClosingFrameRef } from '@/lib/campaigns/closing-frame';
import { nextSceneItem } from '@/lib/campaigns/sequence-chain';
import {
  buildContinuationPrompt,
  enqueueBatch,
  itemCharacterIds,
  loadCampaignContext,
} from '@/lib/campaigns/orchestrator';
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
  MergeSequenceSchema,
  RequestFinalSchema,
  UpdateCampaignItemSchema,
} from '@/lib/schemas/campaigns';
import { mergeScenes } from '@/lib/campaigns/merge';
import { type StudioItem, toStudioItem } from '@/lib/campaigns/studio-item';
import { insertOrRecoverCustomFormat } from '@/lib/campaigns/custom-format';
import { seedanceCostPerItem } from '@/lib/campaigns/estimate';
import { buildSeries, buildTemplateParams, type TemplateFixedParams, type TemplateSlots } from '@/lib/campaigns/distill';
import { copyOutputVideoToReferences } from '@/lib/campaigns/video-ref';
import { buildCampaignCsv, type CsvRow } from '@/lib/campaigns/report';
import { signedOutputUrl } from '@/lib/supabase/storage';
import { compile, fromFormatRow, type FormatDirection } from '@/lib/prompt-director';
import { DIALOGUE_LANGUAGE } from '@/lib/prompt-director/compilers/seedance';
import { matchIdeas, type MatcherImage } from '@/lib/prompt-director/format-matcher';
import { ProviderError } from '@/lib/providers/types';
import { validateOwnedCharacters } from '@/lib/campaigns/characters';

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

// Lista solo colecciones (carpetas V1, sin brief de producto): es el destino
// al que se asignan generaciones sueltas. Las campañas studio reciben sus
// generaciones vía campaign_items, no por asignación manual (specs/v2/06 §4.3).
export async function listCampaignsAction(): Promise<Result<{ id: string; name: string; color: string }[]>> {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, color')
    .eq('workspace_id', workspace.id)
    .is('product_brief', null)
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

  // Imágenes de producto: del Brand Kit elegido, o subidas directo en el
  // wizard — en ese caso el kit se crea implícito tras el análisis, para que
  // el usuario nuevo no necesite conocer el concepto (specs/v2/06 §4.4).
  let kitId: string | null = null;
  let productImageIds: string[];
  if (parsed.data.brandKitId) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('id, workspace_id, product_image_ids, reference_image_ids')
      .eq('id', parsed.data.brandKitId)
      .single();
    if (!kit || kit.workspace_id !== workspace.id) {
      return { ok: false, error: 'not_found', message: 'Brand Kit no encontrado' };
    }
    productImageIds = ((kit.product_image_ids as string[]) ?? []).length
      ? (kit.product_image_ids as string[])
      : ((kit.reference_image_ids as string[]) ?? []);
    if (productImageIds.length === 0) {
      return { ok: false, error: 'validation_error', message: 'El Brand Kit necesita al menos una imagen de producto' };
    }
    kitId = kit.id as string;
  } else {
    productImageIds = parsed.data.productImageIds ?? [];
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, workspace_id')
      .in('id', productImageIds);
    const owned = new Set(
      (refs ?? []).filter((r) => r.workspace_id === workspace.id).map((r) => r.id as string),
    );
    if (productImageIds.some((id) => !owned.has(id))) {
      return { ok: false, error: 'not_found', message: 'Imagen de producto no encontrada' };
    }
  }

  // Pool de personajes (máx 3 por schema): ownership + que tengan imagen.
  let characterIds: string[] = [];
  if (parsed.data.characterIds.length) {
    const owned = await validateOwnedCharacters(supabase, workspace.id, parsed.data.characterIds);
    if (owned === null) {
      return { ok: false, error: 'validation_error', message: 'Personaje no encontrado o sin imagen' };
    }
    characterIds = owned; // orden del wizard = principal primero; dedupeado por el helper
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

  // Brand Kit implícito: nace del análisis (nombre del producto detectado)
  // y de las imágenes subidas. Se crea solo si el análisis tuvo éxito, para
  // no dejar kits huérfanos cuando el proveedor falla.
  if (!kitId) {
    const { data: newKit, error: kitError } = await supabase
      .from('brand_kits')
      .insert({
        workspace_id: workspace.id,
        name: brief.productName,
        colors: [],
        fonts: [],
        product_image_ids: productImageIds,
      })
      .select('id')
      .single();
    if (kitError || !newKit) {
      return { ok: false, error: 'internal_error', message: kitError?.message };
    }
    kitId = newKit.id as string;
    revalidatePath('/app/brand/kits');
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
      brand_kit_id: kitId,
      product_brief: brief,
      character_ids: characterIds,
      include_packaging: parsed.data.includePackaging,
      aspect_ratio: parsed.data.aspectRatio,
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

// Genera el plan. Con ideas del usuario: plan dirigido — exactamente los
// creativos que describió (matcher decide formato y cantidad por idea). Sin
// ideas: plan sugerido con el mix por categoría (totalItems, default 6).
// En ambos casos: escenas y personajes rotados, fechas intercaladas,
// estimación de créditos en tier draft.
export async function generatePlanAction(input: unknown): Promise<
  Result<{
    items: number;
    creditsEstimated: number;
    source: 'ideas' | 'mix';
    // Código del error del matcher cuando se dieron ideas pero el plan cayó
    // al mix: el wizard lo traduce a un motivo legible en el toast.
    matcherError?: string;
    // Nombres de personajes inventados por el matcher: para el toast del wizard.
    inventedNames?: string[];
  }>
> {
  const parsed = GeneratePlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, brand_kit_id, goal, product_brief, character_ids, include_packaging, language, aspect_ratio, date_start, date_end, status')
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
  const available = { product: false, packaging: false };
  // Primera imagen de producto: se adjunta al matcher para que VEA el producto.
  let matcherProductImageId: string | null = null;
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
    matcherProductImageId = productIds[0] ?? null;
    // El empaque solo está disponible si la campaña decidió incluirlo (032).
    available.packaging =
      campaign.include_packaging !== false &&
      ((kit?.packaging_image_ids as string[]) ?? []).length > 0;
  }

  // Pool de la campaña (spec 2026-06-12): el plan solo usa los personajes
  // asignados; pool vacío = formatos con presentador usan personaje inventado.
  const poolIds = ((campaign.character_ids as string[]) ?? []).slice(0, 3);
  let characters: Array<{ id: string; name: string; masterId: string | null }> = [];
  if (poolIds.length) {
    const { data: characterRows } = await supabase
      .from('characters')
      .select('id, name, master_image_id, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .in('id', poolIds);
    const byId = new Map(
      (characterRows ?? [])
        .filter((c) => c.master_image_id || ((c.reference_image_ids as string[]) ?? []).length > 0)
        .map((c) => [
          c.id as string,
          {
            id: c.id as string,
            name: c.name as string,
            masterId:
              (c.master_image_id as string | null) ??
              ((c.reference_image_ids as string[]) ?? [])[0] ??
              null,
          },
        ]),
    );
    // Personajes borrados del Cast desde la creación: se filtran en silencio.
    characters = poolIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  const { data: formatRows } = await supabase
    .from('formats')
    .select('id, slug, name, description, required_refs, default_duration_s, default_audio')
    .or(`is_system.eq.true,workspace_id.eq.${workspace.id}`);
  const formats: PlannerFormat[] = (formatRows ?? []).map((f) => ({
    id: f.id as string,
    slug: f.slug as string,
    name: f.name as string,
    requiredRefs: (f.required_refs as string[]) ?? [],
    defaultDurationS: f.default_duration_s as number,
    defaultAudio: f.default_audio as boolean,
  }));

  // Ideas del usuario (specs/v2/07): el plan se construye de lo que el usuario
  // describió. El matcher mapea cada idea a un formato (o crea uno custom) y
  // determina cuántos creativos pide; NO se rellena hasta un volumen fijo.
  const directed: DirectedIdea[] = [];
  let matcherError: string | undefined;
  // Un inventado por nombre: la PRIMERA descripción gana y se reusa en
  // todos los creativos que lo mencionen (coherencia razonable).
  const inventedByName = new Map<string, { name: string; description: string }>();
  const campaignLanguage: 'es' | 'en' = campaign.language === 'en' ? 'en' : 'es';
  if (parsed.data.userIdeas) {
    // Imágenes para el matcher (best-effort): que VEA el producto y a los
    // personajes produce acciones fieles a lo que existe. Cualquier fallo de
    // descarga degrada a solo-texto sin tirar el plan.
    const matcherImages: MatcherImage[] = [];
    try {
      const wanted = [
        ...(matcherProductImageId ? [{ refId: matcherProductImageId, label: 'producto' }] : []),
        ...characters.flatMap((c) =>
          c.masterId ? [{ refId: c.masterId, label: `personaje ${c.name}` }] : [],
        ),
      ];
      if (wanted.length) {
        const { data: refs } = await supabase
          .from('media_references')
          .select('id, storage_url, workspace_id')
          .in('id', wanted.map((w) => w.refId));
        const urlById = new Map(
          (refs ?? [])
            .filter((r) => r.workspace_id === workspace.id && r.storage_url)
            .map((r) => [r.id as string, r.storage_url as string]),
        );
        for (const { refId, label } of wanted) {
          const url = urlById.get(refId);
          if (!url) continue;
          const { buffer, mimeType } = await downloadReferenceBuffer(url);
          matcherImages.push({ mimeType, dataBase64: buffer.toString('base64'), label });
        }
      }
    } catch (err) {
      console.warn('[generatePlanAction] imágenes para el matcher no disponibles', err);
    }
    try {
      const matched = await matchIdeas({
        ideasText: parsed.data.userIdeas,
        formats: (formatRows ?? []).map((f) => ({
          id: f.id as string,
          slug: f.slug as string,
          name: f.name as string,
          description: (f.description as string | null) ?? null,
          defaultDurationS: f.default_duration_s as number,
        })),
        characters: characters.map((c) => ({ id: c.id, name: c.name })),
        ...(matcherImages.length ? { images: matcherImages } : {}),
        language: campaignLanguage,
      });
      for (const m of matched.matches) {
        for (const p of m.inventedCharacters) {
          const key = p.name.toLowerCase();
          if (!inventedByName.has(key)) inventedByName.set(key, p);
        }
      }
      let createdCustom = false;
      for (const m of matched.matches) {
        if (m.formatId) {
          const f = formats.find((x) => x.id === m.formatId);
          if (f) {
            directed.push({
              format: f,
              count: m.count,
              durationS: m.durationS,
              scenePrompt: m.scenePrompt,
              sceneSummary: m.sceneSummary,
              characterIds: m.characterIds,
              invented: m.inventedCharacters.map((p) => inventedByName.get(p.name.toLowerCase())!),
              scenes: m.scenes,
              sequenceLabel: m.sequenceLabel,
            });
          }
        } else if (m.customFormat) {
          const cf = m.customFormat;
          // Re-planificación: si el slug ya existe en el catálogo del
          // workspace (creado en un plan anterior), se reusa en vez de
          // chocar con el UNIQUE global de formats.slug.
          const existing = formats.find((x) => x.slug === cf.slug);
          if (existing) {
            directed.push({
              format: existing,
              count: m.count,
              durationS: m.durationS,
              scenePrompt: m.scenePrompt,
              sceneSummary: m.sceneSummary,
              characterIds: m.characterIds,
              invented: m.inventedCharacters.map((p) => inventedByName.get(p.name.toLowerCase())!),
              scenes: m.scenes,
              sequenceLabel: m.sequenceLabel,
            });
            continue;
          }
          // formats.slug tiene UNIQUE global: el helper inserta, recupera el del
          // workspace si choca, o uniquifica el slug (uniquifyOnConflict) para NO
          // descartar en silencio la idea que el usuario describió.
          const outcome = await insertOrRecoverCustomFormat(supabase, workspace.id, cf, {
            uniquifyOnConflict: true,
          });
          let pf: PlannerFormat | null = null;
          if (outcome.status === 'created' || outcome.status === 'recovered') {
            pf = {
              id: outcome.id, slug: outcome.slug, name: cf.name,
              requiredRefs: cf.requiredRefs, defaultDurationS: cf.defaultDurationS, defaultAudio: cf.defaultAudio,
            };
            if (outcome.status === 'created') createdCustom = true;
          }
          if (pf) {
            formats.push(pf);
            directed.push({
              format: pf,
              count: m.count,
              durationS: m.durationS,
              scenePrompt: m.scenePrompt,
              sceneSummary: m.sceneSummary,
              characterIds: m.characterIds,
              invented: m.inventedCharacters.map((p) => inventedByName.get(p.name.toLowerCase())!),
              scenes: m.scenes,
              sequenceLabel: m.sequenceLabel,
            });
          } else {
            console.error('[generatePlanAction] formato custom no creado; idea descartada', {
              slug: cf.slug,
              outcome: outcome.status,
              err: outcome.status === 'error' ? outcome.message : undefined,
            });
          }
        }
      }
      if (createdCustom) revalidatePath('/app/formats');
      // Matcher respondió pero el saneo descartó todos los matches (ids
      // inventados sin customFormat): también es fallback, también se avisa.
      if (directed.length === 0) matcherError = 'sin_match';
    } catch (err) {
      // Si Gemini falla, el plan cae al mix sugerido por categoría — pero
      // nunca en silencio: queda en logs y el wizard avisa (source: 'mix').
      console.error('[generatePlanAction] matcher falló; plan sugerido en su lugar', err);
      matcherError = err instanceof ProviderError ? err.code : 'unknown';
    }
  }

  const { data: sceneRows } = await supabase
    .from('scene_library')
    .select('name, prompt_fragment')
    .eq('type', 'escena');
  const scenes = (sceneRows ?? []).map((s) => ({
    name: s.name as string,
    fragment: s.prompt_fragment as string,
  }));

  const goal = (['awareness', 'conversion', 'mixed'].includes(campaign.goal as string)
    ? campaign.goal
    : 'mixed') as 'awareness' | 'conversion' | 'mixed';
  const dateStart = campaign.date_start ? new Date(campaign.date_start as string) : new Date();
  const dateEnd = campaign.date_end
    ? new Date(campaign.date_end as string)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let items: PlanItemDraft[];
  if (directed.length > 0) {
    // Plan dirigido: exactamente los creativos que el usuario describió.
    items = buildDirectedPlan({
      ideas: directed,
      productName: brief.productName,
      goal,
      scenes,
      characters,
      available,
      dateStart,
      dateEnd,
      draftModelSlug: DRAFT_MODEL,
      language: campaignLanguage,
      aspectRatio: (campaign.aspect_ratio as string | null) ?? '9:16',
    });
    if (items.length === 0) {
      return {
        ok: false,
        error: 'validation_error',
        message:
          'Tus ideas piden formatos que necesitan referencias que faltan (p. ej. un presentador en Cast). Agrégalas o describe otra cosa.',
      };
    }
  } else {
    // Plan sugerido (sin ideas o matcher caído): mix por categoría.
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

    items = buildPlan({
      totalItems: parsed.data.totalItems,
      category: (brief.category as never) ?? 'other',
      productName: brief.productName,
      goal,
      formats,
      scenes,
      characters,
      available,
      winningSlugs,
      dateStart,
      dateEnd,
      draftModelSlug: DRAFT_MODEL,
      language: campaignLanguage,
      aspectRatio: (campaign.aspect_ratio as string | null) ?? '9:16',
    });
    if (items.length === 0) {
      return { ok: false, error: 'validation_error', message: 'No hay formatos viables: revisa Brand Kit y Cast' };
    }
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
      character_id: i.characterIds[0] ?? null,
      character_ids: i.characterIds,
      scene_prompt: i.scenePrompt,
      scene_summary: i.sceneSummary,
      caption: i.caption,
      scheduled_date: i.scheduledDate,
      status: 'planned',
      sequence_id: i.sequenceId,
      scene_index: i.sceneIndex,
      sequence_label: i.sequenceLabel,
    })),
  );
  if (insertErr) return { ok: false, error: 'internal_error', message: insertErr.message };

  await supabase
    .from('campaigns')
    .update({ status: 'planned', total_items: items.length, credits_estimated: total })
    .eq('id', campaign.id);

  revalidatePath(`/app/campaigns/${campaign.id}`);
  const inventedNamesList = [...inventedByName.values()].map((p) => p.name);
  return {
    ok: true,
    data: {
      items: items.length,
      creditsEstimated: total,
      source: directed.length > 0 ? 'ideas' : 'mix',
      ...(matcherError ? { matcherError } : {}),
      ...(inventedNamesList.length ? { inventedNames: inventedNamesList } : {}),
    },
  };
}

export async function updateCampaignItemAction(input: unknown): Promise<Result<{ updated: true; status: string }>> {
  const parsed = UpdateCampaignItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership vía join campaña→workspace (RLS también lo cubre; defensa doble).
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, status, character_ids, campaigns!inner(workspace_id)')
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
    parsed.data.characterId !== undefined ||
    parsed.data.characterIds !== undefined;
  if (touchesProduction && !['planned', 'skipped', 'failed'].includes(item.status as string)) {
    return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.scenePrompt !== undefined) {
    patch.scene_prompt = parsed.data.scenePrompt;
    // El resumen display (033) describe el prompt anterior: al editar el
    // prompt a mano queda obsoleto — se anula y la UI cae al scenePrompt.
    patch.scene_summary = null;
  }
  if (parsed.data.scene !== undefined) patch.scene = parsed.data.scene;
  if (parsed.data.durationS !== undefined) patch.duration_s = parsed.data.durationS;
  if (parsed.data.aspectRatio !== undefined) patch.aspect_ratio = parsed.data.aspectRatio;
  if (parsed.data.characterIds !== undefined) {
    // Ownership de los ids entrantes (los del elenco existente vienen de la DB).
    const owned = await validateOwnedCharacters(supabase, workspace.id, parsed.data.characterIds);
    if (owned === null) {
      return { ok: false, error: 'validation_error', message: 'Personaje no encontrado o sin imagen' };
    }
    patch.character_ids = owned;
    patch.character_id = owned[0] ?? null;
  } else if (parsed.data.characterId !== undefined) {
    // Editar el principal conserva al resto del elenco del item (sin duplicarlo).
    const existing = (((item as Record<string, unknown>).character_ids as string[] | null) ?? []);
    const idsToValidate = parsed.data.characterId ? [parsed.data.characterId] : [];
    if (idsToValidate.length) {
      const owned = await validateOwnedCharacters(supabase, workspace.id, idsToValidate);
      if (owned === null) {
        return { ok: false, error: 'validation_error', message: 'Personaje no encontrado o sin imagen' };
      }
    }
    const rest = existing.slice(1).filter((id) => id !== parsed.data.characterId);
    patch.character_id = parsed.data.characterId;
    patch.character_ids = parsed.data.characterId ? [parsed.data.characterId, ...rest].slice(0, 3) : rest;
  }
  if (parsed.data.scheduledDate !== undefined) {
    patch.scheduled_date = parsed.data.scheduledDate.toISOString().slice(0, 10);
  }
  if (parsed.data.caption !== undefined) patch.caption = parsed.data.caption;
  if (touchesProduction) patch.status = 'planned'; // editar un item failed/skipped lo re-habilita

  // Devolver el status REAL post-update (no el snapshot pre-lectura): en una
  // edición de solo caption/fecha refleja una transición concurrente a
  // 'queued'/'sample' en vez de pisarla con un valor viejo. El cliente lo aplica
  // tal cual, evitando re-habilitar los botones de generar y un doble cobro.
  const { data: updated, error } = await supabase
    .from('campaign_items')
    .update(patch)
    .eq('id', parsed.data.itemId)
    .select('status')
    .single();
  if (error || !updated) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { updated: true, status: updated.status as string } };
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
    .select('id, workspace_id, goal, product_brief, aspect_ratio')
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

  // Ownership de personajes: los ids vienen del cliente, validar antes de persistir.
  const rawCharIds = parsed.data.characterIds ?? (parsed.data.characterId ? [parsed.data.characterId] : []);
  if (rawCharIds.length) {
    const owned = await validateOwnedCharacters(supabase, workspace.id, rawCharIds);
    if (owned === null) {
      return { ok: false, error: 'validation_error', message: 'Personaje no encontrado o sin imagen' };
    }
  }

  const durationS = parsed.data.durationS ?? (format.default_duration_s as number) ?? 8;
  // El formato de video lo decide la campaña (034).
  const aspectRatio = (campaign.aspect_ratio as string | null) ?? '9:16';
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
      character_id: parsed.data.characterIds?.[0] ?? parsed.data.characterId ?? null,
      character_ids: parsed.data.characterIds ?? (parsed.data.characterId ? [parsed.data.characterId] : []),
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

// Genera (o regenera) UNA sola escena, sin re-tirar el lote. Recupera escenas
// planned/skipped/failed. Si la escena de una secuencia quedó 'failed' por falta
// de créditos, RESUME su generación de continuación preservada (mantiene
// [producto, fotograma previo] → continuidad real, Tier 2); en cualquier otro
// caso la genera fresca con la referencia del producto (Tier 1).
export type RegenMode = 'auto' | 'only-this' | 'this-and-forward';

export async function generateItemAction(
  itemId: string,
  mode: RegenMode = 'auto',
): Promise<Result<{ generationId?: string }>> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('campaign_items')
    .select(
      'id, campaign_id, format_id, template_id, model_slug, duration_s, aspect_ratio, scene, audio, character_id, character_ids, reference_ids, scene_prompt, status, sequence_id, scene_index, generation_id, campaigns!inner(workspace_id)',
    )
    .eq('id', itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };
  // draft_ready incluido: regenerar un borrador que no convenció (crea una nueva
  // versión; la anterior queda en la biblioteca). En curso (sample/queued) no.
  if (!['planned', 'skipped', 'failed', 'draft_ready'].includes(item.status as string)) {
    return { ok: false, error: 'forbidden', message: 'La escena está generándose; espera a que termine' };
  }

  // RESUME (Tier 2): escena 'failed' por falta de créditos cuya generación de
  // continuación quedó preservada → reservar + re-encolar (sin recompilar, así
  // conserva las referencias [producto, fotograma del clip previo]).
  if (item.status === 'failed' && item.generation_id) {
    const { data: gen } = await supabase
      .from('generations')
      .select('id, status, credits_estimated, error_message, params')
      .eq('id', item.generation_id as string)
      .single();
    const isChainGen = !!(gen?.params as { chain?: unknown } | null)?.chain;
    if (gen && gen.status === 'failed' && gen.error_message === 'insufficient_credits' && isChainGen) {
      const cost = (gen.credits_estimated as number) ?? 0;
      const reserved = await reserveCredits(user.id, cost, gen.id as string);
      if (!reserved) return { ok: false, error: 'insufficient_credits' };
      const admin = createAdminClient();
      await admin
        .from('generations')
        .update({
          status: 'queued',
          poll_attempts: 0,
          error_message: null,
          timeout_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        })
        .eq('id', gen.id as string);
      await admin.from('campaign_items').update({ status: 'sample', warnings: [] }).eq('id', itemId);
      await enqueueJob({ generationId: gen.id as string, action: 'submit', delaySeconds: 0 });
      revalidatePath(`/app/campaigns/${item.campaign_id}`);
      return { ok: true, data: { generationId: gen.id as string } };
    }
  }

  // RE-GENERAR CON CONTINUIDAD (Tier 2): escena de secuencia (índice > 0) cuya
  // generación previa fue de continuación → crea una NUEVA versión reutilizando
  // sus referencias [producto, fotograma del clip previo] con el prompt ACTUAL
  // del item (respeta refinados). Así regenerar un borrador de secuencia
  // mantiene la continuidad cuadro-a-cuadro, no solo el producto.
  if (item.generation_id && item.sequence_id && (item.scene_index ?? 0) > 0) {
    const { data: prevGen } = await supabase
      .from('generations')
      .select('model_id, params, credits_estimated')
      .eq('id', item.generation_id as string)
      .single();
    const pp = prevGen?.params as
      | {
          chain?: { productImagePaths?: string[] };
          referenceImagePaths?: string[];
          returnLastFrame?: boolean;
          aspectRatio?: string;
          resolution?: string;
          duration?: number;
          generateAudio?: boolean;
        }
      | undefined;
    if (prevGen && pp?.chain && pp.referenceImagePaths?.length) {
      const productCount = pp.chain.productImagePaths?.length ?? Math.max(0, pp.referenceImagePaths.length - 1);

      // Consulta compartida de la secuencia (la usan modo A y, en una tarea
      // posterior, modo B). Se eleva fuera del branching de modo.
      const { data: seqRows } = await supabase
        .from('campaign_items')
        .select('id, scene_index, generation_id')
        .eq('sequence_id', item.sequence_id as string);
      const chainItems = (seqRows ?? []).map((r) => ({
        id: r.id as string,
        sceneIndex: r.scene_index as number,
      }));

      // Modo A: si el usuario pide "solo este" y existe clip siguiente ya
      // generado, añadir su primer fotograma como cuadro de cierre (anclaje
      // bidireccional). Si no hay siguiente o falla la extracción, cae a solo-init.
      let closingRef: string | null = null;
      let anchored = false;
      if (mode === 'only-this') {
        const next = nextSceneItem(chainItems, item.scene_index as number);
        const nextRow = next ? (seqRows ?? []).find((r) => r.id === next.id) : null;
        if (nextRow?.generation_id) {
          const { data: nextGen } = await supabase
            .from('generations')
            .select('output_url')
            .eq('id', nextRow.generation_id as string)
            .single();
          if (nextGen?.output_url) {
            closingRef = await buildClosingFrameRef({
              workspaceId: workspace.id,
              sequenceId: item.sequence_id as string,
              sceneIndex: item.scene_index as number,
              nextOutputPath: nextGen.output_url as string,
            });
            anchored = closingRef !== null;
          }
        }
      }

      const referenceImagePaths = closingRef
        ? [...pp.referenceImagePaths, closingRef]
        : pp.referenceImagePaths;

      const prompt = buildContinuationPrompt(item.scene_prompt as string, productCount, {
        withClosingFrame: anchored,
      });
      const cost = (prevGen.credits_estimated as number) ?? 0;
      const admin = createAdminClient();
      const { data: inserted, error: insErr } = await admin
        .from('generations')
        .insert({
          user_id: user.id,
          workspace_id: workspace.id,
          type: 'video',
          provider: 'seedance',
          model_id: prevGen.model_id as string,
          prompt,
          params: {
            operation: 'reference2video',
            aspectRatio: pp.aspectRatio ?? (item.aspect_ratio as string | null) ?? '9:16',
            resolution: pp.resolution ?? '480p',
            duration: pp.duration ?? (item.duration_s as number | null) ?? 5,
            generateAudio: pp.generateAudio ?? (item.audio as boolean | null) ?? true,
            referenceImagePaths,
            returnLastFrame: pp.returnLastFrame ?? false,
            chain: (prevGen.params as { chain?: unknown }).chain,
          },
          status: 'queued',
          credits_estimated: cost,
          campaign_id: item.campaign_id,
          timeout_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        })
        .select('id')
        .single();
      if (insErr || !inserted) {
        return { ok: false, error: 'internal_error', message: insErr?.message ?? 'No se pudo regenerar' };
      }
      const newGenId = inserted.id as string;
      const reserved = await reserveCredits(user.id, cost, newGenId);
      if (!reserved) {
        await admin.from('generations').delete().eq('id', newGenId);
        return { ok: false, error: 'insufficient_credits' };
      }
      await admin
        .from('campaign_items')
        .update({
          status: 'sample',
          generation_id: newGenId,
          warnings: anchored ? ['Anclado al inicio del clip siguiente — revisa la transición'] : [],
        })
        .eq('id', itemId);
      await enqueueJob({ generationId: newGenId, action: 'submit', delaySeconds: 0 });
      revalidatePath(`/app/campaigns/${item.campaign_id}`);
      return { ok: true, data: { generationId: newGenId } };
    }
  }

  // FRESH (Tier 1): generar la escena de cero con la referencia del producto,
  // reusando el orquestador para un único item.
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, brand_kit_id, product_brief, language, include_packaging')
    .eq('id', item.campaign_id as string)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  // enqueueBatch solo toma items 'planned'/'failed'; resetear limpia la gen previa.
  await supabase.from('campaign_items').update({ status: 'planned', generation_id: null }).eq('id', itemId);

  const { data: formatRows } = item.format_id
    ? await supabase
        .from('formats')
        .select('id, slug, name, register, camera_style, pacing, required_refs, default_duration_s, default_audio')
        .eq('id', item.format_id as string)
    : { data: [] };
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
      include_packaging: campaign.include_packaging as boolean | null,
    },
    items: [{ ...item, status: 'planned' }] as never,
    formats: formatsMap as never,
    mode: 'full',
  });

  if (result.enqueued === 0) {
    if (result.skipped.some((s) => s.reason === 'insufficient_credits')) {
      return { ok: false, error: 'insufficient_credits' };
    }
    return { ok: false, error: 'internal_error', message: result.skipped[0]?.reason ?? 'No se pudo generar la escena' };
  }
  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: {} };
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
    .select('id, workspace_id, brand_kit_id, product_brief, language, include_packaging')
    .eq('id', parsed.data.campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return { ok: false, error: 'not_found' };

  const { data: itemRows } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, format_id, template_id, model_slug, duration_s, aspect_ratio, scene, audio, character_id, character_ids, reference_ids, scene_prompt, status, sequence_id, scene_index')
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
      include_packaging: campaign.include_packaging as boolean | null,
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
): Promise<Result<{ items: number; campaignId: string; created: StudioItem[] }>> {
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
  let seriesFormatName = 'Formato';
  let seriesFormatDescription = '';
  if (template.format_id) {
    const { data: fmt } = await supabase
      .from('formats')
      .select('slug, name, description')
      .eq('id', template.format_id as string)
      .single();
    seriesFormatSlug = (fmt?.slug as string) ?? '';
    seriesFormatName = (fmt?.name as string) ?? 'Formato';
    seriesFormatDescription = (fmt?.description as string | null) ?? '';
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

  const { data: insertedRows, error: insertErr } = await supabase
    .from('campaign_items')
    .insert(
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
        character_ids: i.characterId ? [i.characterId] : [],
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
    )
    .select(
      'id, format_id, template_id, duration_s, aspect_ratio, scene, scene_prompt, scene_summary, caption, character_id, character_ids, scheduled_date, status, warnings, generation_id, is_winner, sequence_id, scene_index, sequence_label',
    );
  if (insertErr) return { ok: false, error: 'internal_error', message: insertErr.message };

  await supabase
    .from('creative_templates')
    .update({ uses_count: ((template.uses_count as number) ?? 0) + 1 })
    .eq('id', template.id);

  // Devolver los items ya formados (toStudioItem, igual que el loader) para que
  // el cliente los agregue al estado sin recargar — el canal realtime solo
  // escucha UPDATE, no INSERT. Todos comparten un único formato (la plantilla).
  const characterNameById = new Map(characters.map((c) => [c.id, c.name]));
  const formatNames = template.format_id
    ? new Map([[template.format_id as string, seriesFormatName]])
    : new Map<string, string>();
  const formatDescriptions = template.format_id
    ? new Map([[template.format_id as string, seriesFormatDescription]])
    : new Map<string, string>();
  const created: StudioItem[] = (insertedRows ?? []).map((r) =>
    toStudioItem(r, formatNames, formatDescriptions, characterNameById),
  );

  revalidatePath(`/app/campaigns/${campaignId}`);
  return { ok: true, data: { items: items.length, campaignId, created } };
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

// Preview del prompt final (spec 2026-06-12 §8): compila el item por el mismo
// camino del orquestador SIN encolar ni cobrar. Solo lectura.
// templateVideoPath se omite a propósito: el preview muestra composición y
// referencias de imagen; cargar la plantilla requeriría otra query.
export async function previewItemPromptAction(itemId: string): Promise<
  Result<{
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  }>
> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, format_id, template_id, model_slug, duration_s, aspect_ratio, scene, audio, character_id, character_ids, reference_ids, scene_prompt, status, campaigns!inner(workspace_id, brand_kit_id, product_brief, language, include_packaging)')
    .eq('id', itemId)
    .single();
  const camp = (item as { campaigns?: { workspace_id?: string; brand_kit_id?: string | null; product_brief?: Record<string, unknown> | null; language?: string | null; include_packaging?: boolean | null } } | null)?.campaigns;
  if (!item || camp?.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };

  let format: FormatDirection | undefined;
  if (item.format_id) {
    const { data: f } = await supabase
      .from('formats')
      .select('slug, name, register, camera_style, pacing, required_refs, default_duration_s, default_audio')
      .eq('id', item.format_id)
      .single();
    if (f) {
      format = fromFormatRow({
        slug: f.slug as string, name: f.name as string,
        register: f.register as string | null, camera_style: f.camera_style as string | null,
        pacing: f.pacing as string | null, required_refs: (f.required_refs as string[]) ?? [],
        default_duration_s: f.default_duration_s as number, default_audio: f.default_audio as boolean,
      });
    }
  }

  const charIds = itemCharacterIds({
    character_id: item.character_id as string | null,
    character_ids: (item.character_ids as string[] | null) ?? null,
  });
  const ctx = await loadCampaignContext(
    workspace.id,
    {
      brand_kit_id: (camp.brand_kit_id as string | null) ?? null,
      product_brief: (camp.product_brief as Record<string, unknown> | null) ?? null,
      language: (camp.language as string | null) ?? null,
      include_packaging: camp.include_packaging ?? null,
    },
    charIds,
  );

  const extraIds = (item.reference_ids as string[] | null) ?? [];
  let extraImagePaths: string[] = [];
  if (extraIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, workspace_id')
      .in('id', extraIds);
    extraImagePaths = (refs ?? [])
      .filter((r) => r.workspace_id === workspace.id && r.storage_url)
      .map((r) => r.storage_url as string);
  }

  const characters = charIds
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<ReturnType<typeof ctx.characters.get>> => !!c);

  const result = compile(
    {
      modelSlug: item.model_slug as string,
      scenePrompt: item.scene_prompt as string,
      durationS: (item.duration_s as number | null) ?? undefined,
      aspectRatio: (item.aspect_ratio as string | null) ?? undefined,
      generateAudio: item.audio as boolean,
    },
    {
      format,
      product: {
        name: ctx.productName,
        visualDetails: ctx.visualDetails,
        palette: ctx.palette,
        imagePaths: ctx.productImagePaths,
        packagingImagePaths: format?.requiredRefs.includes('packaging') ? ctx.packagingImagePaths : undefined,
      },
      characters: characters.length ? characters : undefined,
      scene: item.scene ? { fragment: item.scene as string } : undefined,
      extraImagePaths: extraImagePaths.length ? extraImagePaths : undefined,
      language: ctx.language,
    },
  );

  if (!result.ok) {
    return { ok: true, data: { prompt: null, references: [], warnings: result.warnings, errors: result.errors } };
  }
  return {
    ok: true,
    data: {
      prompt: result.compiled.prompt,
      references: result.compiled.references.map((r) => ({ kind: r.kind, role: r.role, path: r.storagePath })),
      warnings: result.compiled.warnings,
      errors: [],
    },
  };
}

// ============================================================
// Secuencias: unir N escenas planificadas en 1 clip (specs/v2 §7 secuencias)
// ============================================================

// Colapsa todas las escenas de una secuencia (sequence_id) en un único
// campaign_item: los prompts se concatenan y la duracion total se capa a 15s.
// Solo funciona si TODAS las escenas estan en estado 'planned'.
export async function mergeSequenceAction(input: unknown): Promise<Result<{ merged: true; item: StudioItem }>> {
  const parsed = MergeSequenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership + estado: todas las escenas deben ser de la campaña del workspace
  // y estar en 'planned' (sin generar).
  const { data: rows } = await supabase
    .from('campaign_items')
    .select('id, status, scene_prompt, duration_s, format_id, model_slug, aspect_ratio, scene, audio, character_id, character_ids, caption, scheduled_date, sequence_label, campaigns!inner(workspace_id)')
    .eq('campaign_id', parsed.data.campaignId)
    .eq('sequence_id', parsed.data.sequenceId)
    .order('scene_index', { ascending: true });

  if (!rows || rows.length === 0) return { ok: false, error: 'not_found' };
  const ws = (rows[0] as { campaigns?: { workspace_id?: string } }).campaigns?.workspace_id;
  if (ws !== workspace.id) return { ok: false, error: 'not_found' };
  if (rows.some((r) => r.status !== 'planned')) {
    return { ok: false, error: 'validation_error', message: 'No se puede unir: alguna escena ya se generó' };
  }

  const first = rows[0] as Record<string, unknown>;
  const { joinedPrompt, mergedDuration } = mergeScenes(
    rows.map((r) => ({ scene_prompt: r.scene_prompt as string, duration_s: r.duration_s as number | null })),
  );

  // Fusión atómica vía RPC (migración 036): INSERT del clip fusionado + DELETE de
  // las escenas, en una sola transacción. Cierra la ventana en que, si el proceso
  // moría entre ambos commits, quedaban fusionado + originales duplicados.
  const { data: rpcData, error: rpcErr } = await supabase.rpc('merge_sequence', {
    p_campaign_id: parsed.data.campaignId,
    p_sequence_id: parsed.data.sequenceId,
    p_joined_prompt: joinedPrompt,
    p_merged_duration: mergedDuration,
  });
  if (rpcErr) {
    // P0001 = carrera: alguna escena dejó de estar 'planned' tras el chequeo previo.
    if (rpcErr.code === 'P0001') {
      return { ok: false, error: 'validation_error', message: 'No se puede unir: alguna escena ya se generó' };
    }
    // 42501 (no autorizado) / P0002 (secuencia vacía) → not_found para no filtrar.
    if (rpcErr.code === '42501' || rpcErr.code === 'P0002') return { ok: false, error: 'not_found' };
    return { ok: false, error: 'internal_error', message: rpcErr.message };
  }
  const mergedRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as Record<string, unknown> | null;
  if (!mergedRow) return { ok: false, error: 'internal_error', message: 'No se pudo unir la secuencia' };

  // Proyectar el item fusionado a la forma del cliente (toStudioItem, igual que
  // el loader y la serie): el canal realtime solo escucha UPDATE, así que sin
  // esto el clip fusionado no aparece hasta recargar.
  let mergedFormatName = 'Formato';
  let mergedFormatDescription = '';
  if (first.format_id) {
    const { data: fmt } = await supabase
      .from('formats').select('name, description').eq('id', first.format_id as string).single();
    mergedFormatName = (fmt?.name as string) ?? 'Formato';
    mergedFormatDescription = (fmt?.description as string | null) ?? '';
  }
  const mergedCharIds =
    (first.character_ids as string[] | null) ?? (first.character_id ? [first.character_id as string] : []);
  const characterNameById = new Map<string, string>();
  if (mergedCharIds.length) {
    const { data: chars } = await supabase
      .from('characters').select('id, name').in('id', mergedCharIds).eq('workspace_id', workspace.id);
    for (const c of chars ?? []) characterNameById.set(c.id as string, c.name as string);
  }
  const formatNames = first.format_id
    ? new Map([[first.format_id as string, mergedFormatName]])
    : new Map<string, string>();
  const formatDescriptions = first.format_id
    ? new Map([[first.format_id as string, mergedFormatDescription]])
    : new Map<string, string>();
  const mergedItem = toStudioItem(mergedRow, formatNames, formatDescriptions, characterNameById);

  revalidatePath(`/app/campaigns/${parsed.data.campaignId}`);
  return { ok: true, data: { merged: true, item: mergedItem } };
}
