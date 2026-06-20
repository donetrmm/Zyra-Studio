'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  downloadOutputBuffer,
  downloadReferenceBuffer,
  uploadOutput,
  uploadThumbnail,
  promoteOutputToReference,
} from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import {
  completeGeneration,
  failGeneration,
  reserveCredits,
} from '@/lib/credits/operations';
import { generate as generateNanoBanana } from '@/lib/providers/nano-banana';
import { ProviderError, type ImageReference } from '@/lib/providers/types';
import {
  loadCampaignContext,
  directorContextFor,
  resolveLocations,
  type ItemRow,
} from '@/lib/campaigns/orchestrator';
import { compilePanel, compilePanelEdit } from '@/lib/campaigns/storyboard';

// Slugs reales del proyecto (mirror de lib/router/model-selector.ts).
// FLUX_MODEL_SLUG: SOLO para compilar el prompt de composición (el compiler FLUX
//   arma escena + producto + personaje). La GENERACIÓN del panel la hace Nano Banana
//   (reference-grounded), porque FLUX no mantenía fieles producto/personaje.
// NANO: Gemini 3 Pro — genera y edita el panel preservando las referencias.
const FLUX_MODEL_SLUG = 'flux-2-pro-preview';
const NANO_MODEL_SLUG = 'gemini-3-pro-image-preview';

// Resolución por defecto para los paneles Nano.
const NANO_VARIANT = '2k';

type ActionError =
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'no_panel'
  | 'insufficient_credits'
  | 'provider_error'
  | 'compile_error'
  | 'safety'
  | 'internal_error';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError; message?: string };

async function makeThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

function inferExtension(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

function nanoVariantToResolution(variant: string): '512' | '1K' | '2K' | '4K' {
  switch (variant) {
    case '1k':
      return '1K';
    case '2k':
      return '2K';
    case '4k':
      return '4K';
    default:
      return '2K';
  }
}

// ─── carga el campaign_item + campaña validando ownership ────────────────────

type CampaignItemRow = {
  id: string;
  campaign_id: string;
  scene_prompt: string;
  aspect_ratio: string | null;
  character_id: string | null;
  character_ids: string[] | null;
  storyboard_image_id: string | null;
  storyboard_generation_id: string | null;
  // extra fields para armar ItemRow
  format_id: string | null;
  template_id: string | null;
  duration_s: number | null;
  scene: string | null;
  audio: boolean;
  reference_ids: string[] | null;
  sequence_id: string | null;
  scene_index: number | null;
  location_id: string | null;
  status: string;
};

type CampaignRow = {
  id: string;
  workspace_id: string;
  brand_kit_id: string | null;
  product_brief: Record<string, unknown> | null;
  language: string | null;
  include_packaging: boolean | null;
};

async function loadItemAndCampaign(
  workspaceId: string,
  itemId: string,
): Promise<{ item: CampaignItemRow; campaign: CampaignRow } | null> {
  const supabase = await createClient();
  // Literal estático para que el tipo generado por Supabase sea correcto.
  const { data: rawItem, error: itemErr } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, scene_prompt, aspect_ratio, character_id, character_ids, storyboard_image_id, storyboard_generation_id, format_id, template_id, duration_s, scene, audio, reference_ids, sequence_id, scene_index, location_id, status')
    .eq('id', itemId)
    .single();
  if (itemErr || !rawItem) return null;
  const item = rawItem as unknown as CampaignItemRow;

  const { data: rawCampaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, workspace_id, brand_kit_id, product_brief, language, include_packaging')
    .eq('id', item.campaign_id)
    .single();
  if (campErr || !rawCampaign) return null;
  const campaign = rawCampaign as unknown as CampaignRow;

  if (campaign.workspace_id !== workspaceId) return null;

  return { item, campaign };
}

// Turno previo (panel del beat ANTERIOR que ya tenga panel) para ENCADENAR
// conversacionalmente: el panel nuevo se genera EDITANDO el anterior (conserva escena,
// arreglo y producto colocado) y aplica la acción del beat. La identidad se re-ancla
// con las referencias limpias. Best-effort: null si no hay anterior o no carga.
async function loadPreviousPanelTurn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  campaignId: string,
  sceneIndex: number | null,
): Promise<{ prompt: string; imageBuffer: Buffer; mimeType: string; thoughtSignature?: string } | null> {
  if (sceneIndex == null) return null;
  const { data: rows } = await supabase
    .from('campaign_items')
    .select('scene_index, storyboard_generation_id')
    .eq('campaign_id', campaignId)
    .lt('scene_index', sceneIndex)
    .not('storyboard_generation_id', 'is', null)
    .order('scene_index', { ascending: false })
    .limit(1);
  const prevGenId = (rows?.[0]?.storyboard_generation_id as string | null | undefined) ?? null;
  if (!prevGenId) return null;
  const { data: gen } = await supabase
    .from('generations')
    .select('output_url, workspace_id, status, prompt, provider_payload, model_id')
    .eq('id', prevGenId)
    .single();
  const g = gen as
    | {
        output_url: string | null;
        workspace_id: string;
        status: string;
        prompt: string | null;
        provider_payload: { thought_signature?: string } | null;
        model_id: string;
      }
    | null;
  if (!g || g.workspace_id !== workspaceId || !g.output_url || g.status !== 'done') return null;
  try {
    const { buffer, mimeType } = await downloadOutputBuffer(g.output_url);
    return {
      prompt: g.prompt ?? '',
      imageBuffer: buffer,
      mimeType,
      thoughtSignature: g.model_id === NANO_MODEL_SLUG ? g.provider_payload?.thought_signature : undefined,
    };
  } catch {
    return null;
  }
}

// ─── acción: generar panel (FLUX) ────────────────────────────────────────────

export async function generatePanelAction(
  itemId: string,
): Promise<Result<{ imageId: string | null; generationId: string }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };

  const { user, workspace } = await requireWorkspace();

  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  // Personajes efectivos: array nuevo con fallback al principal legacy.
  const characterIds: string[] = item.character_ids?.length
    ? item.character_ids.slice(0, 3)
    : item.character_id
      ? [item.character_id]
      : [];

  const ctx = await loadCampaignContext(workspace.id, campaign, characterIds);

  // Locación de la escena: la imagen del lugar se ancla como referencia environment
  // en cada panel → consistencia de escena entre paneles del storyboard.
  const locClient = await createClient();
  const locMap = await resolveLocations(locClient, workspace.id, item.location_id ? [item.location_id] : []);
  const resolvedLoc = item.location_id ? locMap.get(item.location_id) : undefined;
  const dirLocation = resolvedLoc
    ? { name: resolvedLoc.name, description: resolvedLoc.description ?? undefined, imagePaths: resolvedLoc.imagePaths }
    : undefined;

  // Armar ItemRow mínimo para directorContextFor
  const itemRow: ItemRow = {
    id: item.id,
    campaign_id: item.campaign_id,
    format_id: item.format_id,
    template_id: item.template_id,
    model_slug: FLUX_MODEL_SLUG,
    duration_s: item.duration_s,
    aspect_ratio: item.aspect_ratio,
    scene: item.scene,
    audio: item.audio,
    character_id: item.character_id,
    character_ids: item.character_ids,
    reference_ids: item.reference_ids,
    scene_prompt: item.scene_prompt,
    status: item.status,
    sequence_id: item.sequence_id,
    scene_index: item.scene_index,
    location_id: item.location_id,
    storyboard_image_id: null,
  };

  const dirCtx = directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation);

  const beat = {
    id: item.id,
    scene_prompt: item.scene_prompt,
    aspect_ratio: item.aspect_ratio,
    storyboard_image_id: item.storyboard_image_id,
  };

  const compiled = compilePanel(beat, dirCtx, FLUX_MODEL_SLUG);
  if (!compiled.ok) {
    return { ok: false, error: 'compile_error', message: compiled.errors.join('; ') };
  }

  // Continuidad por ENCADENADO CONVERSACIONAL: si hay panel anterior, este panel se
  // genera EDITÁNDOLO (conserva escena, arreglo y producto colocado) y aplica la acción
  // del beat. El primer panel se genera fresco (compose). La identidad se re-ancla con
  // las referencias limpias en ambos casos. Prohibir texto dentro del panel.
  const prevTurn = await loadPreviousPanelTurn(locClient, workspace.id, item.campaign_id, item.scene_index);
  const noText = ' Do not render any text, captions, speech bubbles, subtitles, labels or watermark in the image.';
  const panelPrompt = prevTurn
    ? `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and where it hangs on the wall), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${item.scene_prompt.trim()}.${noText}`
    : `${compiled.compiled.prompt}${noText}`;

  // Precio Nano Banana Pro: el panel se GENERA con Nano (reference-grounded) porque
  // FLUX no mantenía fieles producto/personaje aunque se le pasaran como referencia.
  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: Boolean(prevTurn) },
  });
  const cost = breakdown.total;

  const supabase = await createClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'image',
      provider: 'nano-banana',
      model_id: NANO_MODEL_SLUG,
      prompt: panelPrompt,
      params: {
        aspect_ratio: item.aspect_ratio,
        conversational: Boolean(prevTurn),
        has_text_in_image: false,
        use_grounding: false,
        storyboard: { campaignItemId: itemId },
      },
      reference_ids: [],
      campaign_id: item.campaign_id,
      status: 'processing',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
  const generationId = inserted.id as string;

  let reserved = false;
  const startedAt = Date.now();
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }

    // Cargar referencias como buffers directamente desde el storage path compilado.
    // Las referencias compiladas ya fueron validadas por ownership en loadCampaignContext → resolvePaths.
    const references = await Promise.all(
      compiled.compiled.references
        .filter((r) => r.kind === 'image')
        .map(async (r): Promise<ImageReference> => {
          const { buffer, mimeType } = await downloadReferenceBuffer(r.storagePath);
          return { buffer, mimeType };
        }),
    );

    // Genera con Nano Banana. Encadenado: si hay panel anterior, va como previousTurn
    // (modo conversacional → conserva escena/arreglo/producto y aplica la acción del
    // beat). El primer panel se genera fresco. Producto/personaje/locación van como
    // referencias limpias en ambos casos (re-anclan identidad, acotan el drift).
    const result = await generateNanoBanana({
      model: NANO_MODEL_SLUG,
      prompt: panelPrompt,
      aspectRatio: item.aspect_ratio ?? '9:16',
      resolution: nanoVariantToResolution(NANO_VARIANT),
      references,
      previousTurn: prevTurn,
      conversational: Boolean(prevTurn),
      useGrounding: false,
      hasTextInImage: false,
    });

    const ext = inferExtension(result.mimeType);
    const outputPath = await uploadOutput(
      workspace.id,
      generationId,
      result.buffer,
      result.mimeType,
      ext,
    );
    const thumbBuffer = await makeThumbnail(result.buffer);
    const thumbPath = await uploadThumbnail(workspace.id, generationId, thumbBuffer);

    const processingMs = Date.now() - startedAt;
    // Guardar el thought_signature: permite que el PRIMER refinado encadene el turno
    // conversacional desde este panel generado (preserva composición al editar).
    const providerPayload: Record<string, unknown> = {};
    if (result.thoughtSignature) providerPayload.thought_signature = result.thoughtSignature;

    await completeGeneration({
      userId: user.id,
      generationId,
      cost,
      outputUrl: outputPath,
      thumbnailUrl: thumbPath,
      processingMs,
      fileSizeBytes: result.buffer.byteLength,
      providerPayload: Object.keys(providerPayload).length > 0 ? providerPayload : null,
    });

    // Promoción best-effort: output → media_reference → campaign_item
    let imageId: string | null = null;
    try {
      imageId = await promoteOutputToReference(workspace.id, user.id, outputPath, generationId);
      await supabase
        .from('campaign_items')
        .update({
          storyboard_image_id: imageId,
          storyboard_generation_id: generationId,
        })
        .eq('id', itemId);
    } catch (promoteErr) {
      console.error('[storyboard:promote]', {
        generationId,
        itemId,
        error: (promoteErr as Error)?.message,
      });
    }

    revalidatePath(`/app/campaigns/${item.campaign_id}/storyboard`);
    revalidatePath('/app/library');

    return {
      ok: true,
      data: { imageId, generationId },
    };
  } catch (err) {
    const errMsg =
      err instanceof ProviderError ? err.message : (err as Error)?.message ?? 'unknown';
    const refundAmount = reserved ? cost : 0;
    try {
      await failGeneration(user.id, generationId, refundAmount, errMsg);
    } catch (failErr) {
      console.error('[storyboard:fail_generation:generate]', {
        userId: user.id,
        generationId,
        cost: refundAmount,
        originalError: errMsg,
        failError: (failErr as Error)?.message,
      });
    }
    if (err instanceof ProviderError && err.code === 'safety') {
      return { ok: false, error: 'safety', message: errMsg };
    }
    return { ok: false, error: 'provider_error', message: errMsg };
  }
}

// ─── acción: asignar la locación del storyboard ──────────────────────────────

// Asigna (o quita con null) la locación a TODOS los beats de la campaña. Sus
// paneles se anclan a esa locación como referencia de escena. Valida ownership.
export async function setStoryboardLocationAction(
  campaignId: string,
  locationId: string | null,
): Promise<Result<{ updated: true }>> {
  if (!campaignId) return { ok: false, error: 'validation_error', message: 'campaignId requerido' };

  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, workspace_id')
    .eq('id', campaignId)
    .single();
  if (!camp || (camp as { workspace_id: string }).workspace_id !== workspace.id) {
    return { ok: false, error: 'forbidden' };
  }
  if (locationId) {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, workspace_id')
      .eq('id', locationId)
      .single();
    if (!loc || (loc as { workspace_id: string }).workspace_id !== workspace.id) {
      return { ok: false, error: 'forbidden' };
    }
  }

  const { error } = await supabase
    .from('campaign_items')
    .update({ location_id: locationId })
    .eq('campaign_id', campaignId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaignId}/storyboard`);
  return { ok: true, data: { updated: true } };
}

// ─── acción: refinar panel (Nano Banana Pro conversacional) ──────────────────

export async function refinePanelAction(
  itemId: string,
  instruction: string,
): Promise<Result<{ imageId: string | null; generationId: string }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };
  if (!instruction?.trim()) {
    return { ok: false, error: 'validation_error', message: 'instruction requerida' };
  }

  const { user, workspace } = await requireWorkspace();

  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  // Requiere panel existente
  if (!item.storyboard_image_id) {
    return { ok: false, error: 'no_panel' };
  }

  const characterIds: string[] = item.character_ids?.length
    ? item.character_ids.slice(0, 3)
    : item.character_id
      ? [item.character_id]
      : [];

  const ctx = await loadCampaignContext(workspace.id, campaign, characterIds);

  // Locación: misma referencia environment que en la generación, para que el
  // refinado no pierda el lugar.
  const locClient = await createClient();
  const locMap = await resolveLocations(locClient, workspace.id, item.location_id ? [item.location_id] : []);
  const resolvedLoc = item.location_id ? locMap.get(item.location_id) : undefined;
  const dirLocation = resolvedLoc
    ? { name: resolvedLoc.name, description: resolvedLoc.description ?? undefined, imagePaths: resolvedLoc.imagePaths }
    : undefined;

  const itemRow: ItemRow = {
    id: item.id,
    campaign_id: item.campaign_id,
    format_id: item.format_id,
    template_id: item.template_id,
    model_slug: NANO_MODEL_SLUG,
    duration_s: item.duration_s,
    aspect_ratio: item.aspect_ratio,
    scene: item.scene,
    audio: item.audio,
    character_id: item.character_id,
    character_ids: item.character_ids,
    reference_ids: item.reference_ids,
    scene_prompt: item.scene_prompt,
    status: item.status,
    sequence_id: item.sequence_id,
    scene_index: item.scene_index,
    location_id: item.location_id,
    storyboard_image_id: null,
  };

  const dirCtx = directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation);

  const compiled = compilePanelEdit(instruction, item.aspect_ratio, dirCtx, NANO_MODEL_SLUG);
  if (!compiled.ok) {
    return { ok: false, error: 'compile_error', message: compiled.errors.join('; ') };
  }

  // Precio Nano Banana Pro conversacional
  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: true },
  });
  const cost = breakdown.total;

  const supabase = await createClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'image',
      provider: 'nano-banana',
      model_id: NANO_MODEL_SLUG,
      prompt: compiled.compiled.prompt,
      params: {
        aspect_ratio: item.aspect_ratio,
        conversational: true,
        has_text_in_image: false,
        use_grounding: false,
        storyboard: { campaignItemId: itemId },
      },
      reference_ids: [],
      parent_generation_id: item.storyboard_generation_id ?? null,
      campaign_id: item.campaign_id,
      status: 'processing',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
  const generationId = inserted.id as string;

  let reserved = false;
  const startedAt = Date.now();
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }

    // Cargar referencias extra compiladas como buffers directamente desde el storage path compilado.
    // Las referencias compiladas ya fueron validadas por ownership en loadCampaignContext → resolvePaths.
    const references = await Promise.all(
      compiled.compiled.references
        .filter((r) => r.kind === 'image')
        .map(async (r): Promise<ImageReference> => {
          const { buffer, mimeType } = await downloadReferenceBuffer(r.storagePath);
          return { buffer, mimeType };
        }),
    );

    // Conversacional: turno previo del panel anterior (output + thought_signature).
    // Idéntico al patrón de submitGenerationAction con parentGenerationId.
    let previousTurn: {
      prompt: string;
      imageBuffer: Buffer;
      mimeType: string;
      thoughtSignature?: string;
    } | null = null;

    const parentGenId = item.storyboard_generation_id;
    if (parentGenId) {
      const { data: parent } = await supabase
        .from('generations')
        .select('output_url, workspace_id, status, prompt, provider_payload, model_id')
        .eq('id', parentGenId)
        .single();
      if (
        parent &&
        parent.workspace_id === workspace.id &&
        parent.output_url &&
        parent.status === 'done'
      ) {
        const { buffer, mimeType } = await downloadOutputBuffer(parent.output_url as string);
        const payload = (parent.provider_payload ?? {}) as { thought_signature?: string };
        const modelMatches = parent.model_id === NANO_MODEL_SLUG;
        previousTurn = {
          prompt: (parent.prompt as string) ?? '',
          imageBuffer: buffer,
          mimeType,
          thoughtSignature: modelMatches ? payload.thought_signature : undefined,
        };
      }
    }

    const result = await generateNanoBanana({
      model: NANO_MODEL_SLUG,
      prompt: compiled.compiled.prompt,
      aspectRatio: item.aspect_ratio ?? '9:16',
      resolution: nanoVariantToResolution(NANO_VARIANT),
      references,
      previousTurn,
      useGrounding: false,
      conversational: true,
      hasTextInImage: false,
      noBackground: false,
    });

    const ext = inferExtension(result.mimeType);
    const outputPath = await uploadOutput(
      workspace.id,
      generationId,
      result.buffer,
      result.mimeType,
      ext,
    );
    const thumbBuffer = await makeThumbnail(result.buffer);
    const thumbPath = await uploadThumbnail(workspace.id, generationId, thumbBuffer);

    const processingMs = Date.now() - startedAt;
    const providerPayload: Record<string, unknown> = {};
    if (result.thoughtSignature) {
      providerPayload.thought_signature = result.thoughtSignature;
    }

    await completeGeneration({
      userId: user.id,
      generationId,
      cost,
      outputUrl: outputPath,
      thumbnailUrl: thumbPath,
      processingMs,
      fileSizeBytes: result.buffer.byteLength,
      providerPayload: Object.keys(providerPayload).length > 0 ? providerPayload : null,
    });

    // Promoción best-effort
    let imageId: string | null = null;
    try {
      imageId = await promoteOutputToReference(workspace.id, user.id, outputPath, generationId);
      await supabase
        .from('campaign_items')
        .update({
          storyboard_image_id: imageId,
          storyboard_generation_id: generationId,
        })
        .eq('id', itemId);
    } catch (promoteErr) {
      console.error('[storyboard:promote]', {
        generationId,
        itemId,
        error: (promoteErr as Error)?.message,
      });
    }

    revalidatePath(`/app/campaigns/${item.campaign_id}/storyboard`);
    revalidatePath('/app/library');

    return {
      ok: true,
      data: { imageId, generationId },
    };
  } catch (err) {
    const errMsg =
      err instanceof ProviderError ? err.message : (err as Error)?.message ?? 'unknown';
    const refundAmount = reserved ? cost : 0;
    try {
      await failGeneration(user.id, generationId, refundAmount, errMsg);
    } catch (failErr) {
      console.error('[storyboard:fail_generation:refine]', {
        userId: user.id,
        generationId,
        cost: refundAmount,
        originalError: errMsg,
        failError: (failErr as Error)?.message,
      });
    }
    if (err instanceof ProviderError && err.code === 'safety') {
      return { ok: false, error: 'safety', message: errMsg };
    }
    return { ok: false, error: 'provider_error', message: errMsg };
  }
}
