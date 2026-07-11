'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import {
  failGeneration,
  reserveCredits,
} from '@/lib/credits/operations';
import {
  NANO_MODEL_SLUG,
  NANO_VARIANT,
} from '@/lib/providers/nano-banana';
import {
  loadCampaignContext,
  directorContextFor,
  resolveLocations,
  resolveItemProduct,
  type ItemRow,
} from '@/lib/campaigns/orchestrator';
import { applyReferenceSelection, normalizeReferenceSelection } from '@/lib/campaigns/reference-selection';
import { compilePanel, expressionDirective, humanRealismDirective, sceneStyleDirective, physicsClause, chainedProductFidelity, chainedCharacterFidelity, chatRefPathsFor, stripDialogueForPanel, NO_TEXT_CLAUSE, SINGLE_FRAME_CLAUSE } from '@/lib/campaigns/storyboard';
import { buildStoryboardJobPayload } from '@/lib/campaigns/storyboard-job';
import { enqueueJob } from '@/lib/jobs/queue';
import { uploadReference, downloadReferenceBuffer, promoteOutputToReference } from '@/lib/supabase/storage';
import { deriveLightProfileFromImage } from '@/lib/locations/light-profile';
import { describeProductScale, describeProductWeight, productUsageClause } from '@/lib/prompt-director/inventory';
import { creativeGuidelineClauses, guidelinesForSafeBase } from '@/lib/campaigns/guidelines';
import { replaceDialogue } from '@/lib/campaigns/speech-fit';

// Slugs reales del proyecto (mirror de lib/router/model-selector.ts).
// FLUX_MODEL_SLUG: SOLO para compilar el prompt de composición (el compiler FLUX
//   arma escena + producto + personaje). La GENERACIÓN del panel la hace Nano Banana
//   (reference-grounded), porque FLUX no mantenía fieles producto/personaje.
// NANO: Gemini 3 Pro — genera y edita el panel preservando las referencias.
const FLUX_MODEL_SLUG = 'flux-2-pro-preview';

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
  | 'internal_error'
  | 'in_flight'
  | 'max_turns';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError; message?: string };

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
  // V3 fase 1: producto de ESTE clip. null = usa el producto de campaña (fallback).
  product_id: string | null;
  // V3 fase 4: selección manual de referencias de ESTE clip. null/vacío = cae a
  // la de campaña (fallback/compat: backfill de la migración 060).
  reference_selection: unknown;
};

type CampaignRow = {
  id: string;
  workspace_id: string;
  brand_kit_id: string | null;
  product_brief: Record<string, unknown> | null;
  language: string | null;
  include_packaging: boolean | null;
  creative_guidelines: Record<string, unknown> | null;
  visual_style: string | null;
  visual_style_custom: string | null;
  // Selección manual de referencias (054): también filtra las refs del panel.
  reference_selection: Record<string, unknown> | null;
  // Vestuario (specs/v2/16): outfit por personaje de toda la campaña; el
  // narrowing del jsonb lo hace loadCampaignContext.
  character_outfit_map: Record<string, unknown> | null;
};

async function loadItemAndCampaign(
  workspaceId: string,
  itemId: string,
): Promise<{ item: CampaignItemRow; campaign: CampaignRow } | null> {
  const supabase = await createClient();
  // Literal estático para que el tipo generado por Supabase sea correcto.
  const { data: rawItem, error: itemErr } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, scene_prompt, aspect_ratio, character_id, character_ids, storyboard_image_id, storyboard_generation_id, format_id, template_id, duration_s, scene, audio, reference_ids, sequence_id, scene_index, location_id, status, product_id, reference_selection')
    .eq('id', itemId)
    .single();
  if (itemErr || !rawItem) return null;
  const item = rawItem as unknown as CampaignItemRow;

  const { data: rawCampaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, workspace_id, brand_kit_id, product_brief, language, include_packaging, creative_guidelines, visual_style, visual_style_custom, reference_selection, character_outfit_map')
    .eq('id', item.campaign_id)
    .single();
  if (campErr || !rawCampaign) return null;
  const campaign = rawCampaign as unknown as CampaignRow;

  if (campaign.workspace_id !== workspaceId) return null;

  return { item, campaign };
}

// Ref del panel previo para ENCADENAR (sin descargar la imagen: el worker la baja).
// Devuelve el PATH que calza con el thought_signature: en estricto el safe_base_path
// (base 4:5 de Nano), si no el output. Misma logica de cadena (secuencia, break por
// locacion) que antes.
async function loadPreviousPanelRef(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  campaignId: string,
  sceneIndex: number | null,
  sequenceId: string | null,
  currentLocationId: string | null,
): Promise<{ imagePath: string; prompt: string; sourceGenerationId?: string } | null> {
  if (sceneIndex == null || sequenceId == null) return null;
  const { data: rows } = await supabase
    .from('campaign_items')
    .select('scene_index, storyboard_generation_id, location_id')
    .eq('campaign_id', campaignId)
    .eq('sequence_id', sequenceId)
    .lt('scene_index', sceneIndex)
    .not('storyboard_generation_id', 'is', null)
    .order('scene_index', { ascending: false })
    .limit(1);
  const prevRow = rows?.[0] as { storyboard_generation_id: string | null; location_id: string | null } | undefined;
  const prevGenId = prevRow?.storyboard_generation_id ?? null;
  if (!prevGenId) return null;
  if ((prevRow?.location_id ?? null) !== (currentLocationId ?? null)) return null;
  // Solo safe_base_path por JSON path: provider_payload completo carga el
  // thought_signature (~8MB) que aqui no se necesita.
  const { data: gen } = await supabase
    .from('generations')
    .select('output_url, workspace_id, status, prompt, model_id, safe_base_path:provider_payload->>safe_base_path')
    .eq('id', prevGenId)
    .single();
  const g = gen as
    | {
        output_url: string | null;
        workspace_id: string;
        status: string;
        prompt: string | null;
        model_id: string;
        safe_base_path: string | null;
      }
    | null;
  if (!g || g.workspace_id !== workspaceId || !g.output_url || g.status !== 'done') return null;
  const imagePath = g.safe_base_path ?? g.output_url;
  return {
    imagePath,
    prompt: g.prompt ?? '',
    // La firma NO se copia al payload (viaja en params -> broadcast Realtime >1MB
    // + SELECT gigante en el worker): se referencia la gen y el worker la lee de
    // provider_payload (columna no publicada) al correr el job.
    sourceGenerationId: g.model_id === NANO_MODEL_SLUG ? prevGenId : undefined,
  };
}

// ─── acción: generar panel (FLUX) ────────────────────────────────────────────

export async function generatePanelAction(
  itemId: string,
  opts?: { productRefInChat?: boolean; characterRefInChat?: boolean; locationRefInChat?: boolean },
): Promise<Result<{ generationId: string }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };

  const { user, workspace } = await requireWorkspace();

  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  // Guard de concurrencia: si ya hay una generación de este panel en vuelo, no
  // crear otra (doble click, segunda pestaña o reload a media generación =
  // doble cobro). El candado del cliente (botones disabled) no cubre esos casos.
  // Queda una ventana check→insert entre requests simultáneos; aceptable a esta
  // escala (cerrarla del todo pediría un unique index parcial sobre JSONB).
  const supabase = await createClient();
  const { count: inFlight } = await supabase
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .in('status', ['queued', 'processing']);
  // Fail-open: si la query falla, count es null y el guard deja pasar — mejor
  // un raro doble encolado que bloquear la generación por un error transitorio.
  if ((inFlight ?? 0) > 0) {
    return { ok: false, error: 'in_flight' };
  }

  // Personajes efectivos: array nuevo con fallback al principal legacy.
  const characterIds: string[] = item.character_ids?.length
    ? item.character_ids.slice(0, 3)
    : item.character_id
      ? [item.character_id]
      : [];

  const ctx = await loadCampaignContext(workspace.id, campaign, characterIds);

  // Locación de la escena: la imagen del lugar se ancla como referencia environment
  // en cada panel → consistencia de escena entre paneles del storyboard.
  const locMap = await resolveLocations(supabase, workspace.id, item.location_id ? [item.location_id] : []);
  const resolvedLoc = item.location_id ? locMap.get(item.location_id) : undefined;
  // Perfil de luz (052), derivación LAZY: si la locación tiene maestra y aún no
  // tiene perfil, se deriva UNA vez aquí (visión flash sobre la maestra), se
  // persiste y se usa de inmediato — las locaciones existentes lo ganan sin
  // pasos manuales. Best-effort: si falla, el panel sale sin perfil (la
  // cláusula genérica de integración sigue aplicando).
  let locLightProfile = resolvedLoc?.lightProfile;
  if (resolvedLoc && item.location_id && !locLightProfile && resolvedLoc.imagePaths.length > 0) {
    try {
      const { buffer, mimeType } = await downloadReferenceBuffer(resolvedLoc.imagePaths[0]);
      locLightProfile = await deriveLightProfileFromImage({ imageBuffer: buffer, mimeType });
      await supabase
        .from('locations')
        .update({ light_profile: locLightProfile })
        .eq('id', item.location_id)
        .eq('workspace_id', workspace.id);
    } catch (err) {
      console.error('[storyboard] no se pudo derivar el perfil de luz de la locacion', {
        error: (err as Error)?.message,
      });
    }
  }
  const dirLocation = resolvedLoc
    ? {
        name: resolvedLoc.name,
        description: resolvedLoc.description ?? undefined,
        imagePaths: resolvedLoc.imagePaths,
        ...(locLightProfile ? { lightProfile: locLightProfile } : {}),
      }
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
    // Panel de storyboard (imagen FLUX/Nano, sin audio): sin concepto de tono de voz.
    voice_tone: null,
    status: item.status,
    sequence_id: item.sequence_id,
    scene_index: item.scene_index,
    character_state_hint: null,
    character_outfit_hint: null,
    location_id: item.location_id,
    storyboard_image_id: null,
    product_id: item.product_id,
    reference_selection: item.reference_selection,
  };

  // V3 fase 1: producto de ESTE clip (fallback a ctx si no hay product_id o no resuelve).
  const itemProduct = item.product_id
    ? await resolveItemProduct(supabase, workspace.id, item.product_id, true)
    : null;

  // La selección manual de referencias (054, por ítem desde V3 fase 4) también
  // filtra las refs del panel (producto/locación; los masters del cast nunca se
  // filtran). item.reference_selection gana; campaign.reference_selection es
  // fallback/compat.
  const dirCtx = applyReferenceSelection(
    directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation, itemProduct ?? undefined),
    normalizeReferenceSelection(itemRow.reference_selection ?? campaign.reference_selection ?? null),
  );

  // Modo estricto de zona segura: genera la base en 4:5 (garantia geometrica) y luego
  // extiende a 9:16. Solo cuando el flag esta on, hay safeCrop 4:5 y el aspecto es 9:16.
  const guidelines = dirCtx.guidelines;
  const strictSafe =
    Boolean(guidelines?.safeAreaExtend) &&
    guidelines?.safeCrop === '4:5' &&
    (item.aspect_ratio ?? '9:16') === '9:16';
  // Modo estricto: la base se genera en 4:5 (el frame 4:5 ES la zona segura, el
  // producto sale completo y a escala) y luego se expande a 9:16 con FLUX. La base
  // NO emite la clausula de safeCrop (guidelinesForSafeBase) porque en un 4:5 seria
  // redundante. Fuera de estricto: 9:16 nativo, comportamiento actual.
  const baseDirCtx = strictSafe ? { ...dirCtx, guidelines: guidelinesForSafeBase(dirCtx.guidelines) } : dirCtx;
  const genAspect = strictSafe ? '4:5' : (item.aspect_ratio ?? '9:16');

  const beat = {
    id: item.id,
    scene_prompt: item.scene_prompt,
    aspect_ratio: item.aspect_ratio,
    storyboard_image_id: item.storyboard_image_id,
  };

  const compiled = compilePanel(beat, baseDirCtx, FLUX_MODEL_SLUG, { isOpeningBeat: (item.scene_index ?? 0) === 0 });
  if (!compiled.ok) {
    return { ok: false, error: 'compile_error', message: compiled.errors.join('; ') };
  }

  const prevRef = await loadPreviousPanelRef(supabase, workspace.id, item.campaign_id, item.scene_index, item.sequence_id, item.location_id);
  const noText = NO_TEXT_CLAUSE;
  const productRefInChat =
    Boolean(prevRef) &&
    (opts?.productRefInChat ?? process.env.STORYBOARD_PRODUCT_REF_IN_CHAT === '1');
  const productRefPointer = productRefInChat
    ? ' A reference image of the product is also attached — reproduce its printed image and design exactly. The previous panel remains the base shot to re-frame; do not replace the scene with the product image.'
    : '';
  const characterRefInChat =
    Boolean(prevRef) &&
    (opts?.characterRefInChat ?? process.env.STORYBOARD_CHARACTER_REF_IN_CHAT === '1');
  const characterFidelityText = characterRefInChat ? chainedCharacterFidelity(dirCtx) : '';
  const characterRefPointer = characterRefInChat
    ? ' A reference image of each character is also attached — reproduce their exact face, hair, build and wardrobe; the previous panel remains the base shot to re-frame, do not replace the scene with the character image.'
    : '';
  const locationRefInChat =
    Boolean(prevRef) &&
    (opts?.locationRefInChat ?? process.env.STORYBOARD_LOCATION_REF_IN_CHAT === '1');
  const imageRefs = compiled.compiled.references.filter((r) => r.kind === 'image');
  // El pointer de locación se gatea por PRESENCIA de refs environment (locación
  // solo-texto no adjunta nada; un pointer a una imagen inexistente es una
  // instrucción muerta que confunde al modelo).
  const locationRefPointer =
    locationRefInChat && imageRefs.some((r) => r.role === 'environment')
      ? ' A reference image of the location is also attached — keep the scene inside this exact place (same architecture, surfaces and lighting); the previous panel remains the base shot to re-frame, do not replace the scene with the location image.'
      : '';
  // Uso por imagen del producto adjunto (usage_description del brand kit): sin
  // esto la vista de canto/perfil viajaba sin función y el grosor se ignoraba.
  const productUsagePointer = productRefInChat
    ? productUsageClause(
        imageRefs.filter((r) => r.role === 'product').map((r) => r.storagePath),
        dirCtx.product?.imageUsages,
      )
    : '';
  // El diálogo del beat (`Dialogue: "..."`) es guion de VIDEO: en el panel Nano
  // lo quema como subtítulo (bug 2026-07-02). Se elimina en AMBAS ramas; el
  // video lo conserva (viene del scene_prompt original, no de aquí).
  const panelScene = stripDialogueForPanel(item.scene_prompt);
  const panelPromptBody = prevRef
    ? `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and in the same position in the scene), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${panelScene}.${chainedProductFidelity(dirCtx)}${describeProductScale(dirCtx.product)}${describeProductWeight(dirCtx.product)}${creativeGuidelineClauses(baseDirCtx.guidelines, { isOpeningBeat: (item.scene_index ?? 0) === 0 })}${characterFidelityText}${productRefPointer}${productUsagePointer}${characterRefPointer}${locationRefPointer}${physicsClause(dirCtx)}${SINGLE_FRAME_CLAUSE}${noText}`
    : `${compiled.compiled.prompt}${humanRealismDirective(dirCtx, panelScene)}${expressionDirective(dirCtx, panelScene)}${sceneStyleDirective(dirCtx, panelScene)}${describeProductScale(dirCtx.product)}${describeProductWeight(dirCtx.product)}${SINGLE_FRAME_CLAUSE}${noText}`;
  const panelPrompt = panelPromptBody;

  const referencePaths = imageRefs.map((r) => r.storagePath);
  const chatRefPaths = chatRefPathsFor(imageRefs, {
    product: productRefInChat,
    character: characterRefInChat,
    location: locationRefInChat,
  });

  const payload = buildStoryboardJobPayload({
    campaignItemId: itemId,
    campaignId: item.campaign_id,
    genAspect,
    strict: strictSafe,
    referencePaths,
    chatRefPaths,
    prevTurn: prevRef
      ? { imagePath: prevRef.imagePath, sourceGenerationId: prevRef.sourceGenerationId, prompt: prevRef.prompt }
      : null,
    // Ancla de escenografia para las bandas del expand 9:16 (sin locacion queda neutro).
    expandHint: resolvedLoc ? [resolvedLoc.name, resolvedLoc.description].filter(Boolean).join(': ') : undefined,
  });

  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: Boolean(prevRef), passes: strictSafe ? 2 : 1 },
  });
  const cost = breakdown.total;

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
        conversational: Boolean(prevRef),
        has_text_in_image: false,
        use_grounding: false,
        storyboard: payload,
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

  const reserved = await reserveCredits(user.id, cost, generationId);
  if (!reserved) {
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    return { ok: false, error: 'insufficient_credits' };
  }

  try {
    await enqueueJob({ generationId, action: 'submit' });
  } catch (err) {
    // Rollback: si no se pudo encolar, no dejar creditos colgados ni la fila en processing.
    try {
      await failGeneration(user.id, generationId, cost, `enqueue fallo: ${(err as Error)?.message ?? 'unknown'}`);
    } catch (failErr) {
      console.error('[storyboard:enqueue_rollback:generate]', { generationId, failErr });
    }
    return { ok: false, error: 'internal_error', message: 'no se pudo encolar la generacion' };
  }

  // Limpia el aviso del intento fallido anterior: ya hay una generación nueva en
  // vuelo. Best-effort (el cliente supabase no lanza; un error aquí no bloquea).
  await supabase.from('campaign_items').update({ warnings: [] }).eq('id', itemId);

  return { ok: true, data: { generationId } };
}

// ─── acción: asignar la locación del storyboard ──────────────────────────────

// Asigna (o quita con null) la locación a los beats de UN creativo. `creative`
// identifica el creativo: una secuencia (sequenceId) o un item suelto (itemId).
// Sus paneles se anclan a esa locación como referencia de escena. Valida ownership.
export async function setStoryboardLocationAction(
  campaignId: string,
  locationId: string | null,
  creative: { sequenceId: string | null; itemId: string },
): Promise<Result<{ updated: true }>> {
  if (!campaignId) return { ok: false, error: 'validation_error', message: 'campaignId requerido' };
  if (!creative?.itemId) return { ok: false, error: 'validation_error', message: 'creativo requerido' };

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

  // Scope al creativo: por sequence_id (secuencia) o por id (item suelto). El filtro
  // por campaign_id (campaña ya validada por ownership) acota a items de esta campaña.
  let query = supabase
    .from('campaign_items')
    .update({ location_id: locationId })
    .eq('campaign_id', campaignId);
  query = creative.sequenceId
    ? query.eq('sequence_id', creative.sequenceId)
    : query.eq('id', creative.itemId);
  const { error } = await query;
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaignId}/storyboard`);
  return { ok: true, data: { updated: true } };
}

// ─── acción: subir un panel manual ───────────────────────────────────────────

// Reemplaza (o crea) el panel del beat con una imagen del usuario — cierre del
// flujo "descargo el panel, lo edito fuera (ChatGPT/Photoshop), lo subo de
// vuelta". El panel manual es una media_reference sin generación de origen:
// el video (I2V/R2V) y el refinado (single-turn, bucket references) lo usan
// igual que un panel generado.
export async function uploadPanelAction(
  itemId: string,
  formData: FormData,
): Promise<Result<{ uploaded: true }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'validation_error', message: 'archivo requerido' };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { ok: false, error: 'validation_error', message: 'imagen demasiado grande (máx 15MB)' };
  }
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
    return { ok: false, error: 'validation_error', message: 'formato no soportado (JPG, PNG o WebP)' };
  }

  const { user, workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { campaign } = loaded;

  // Normalizar a JPEG con lado largo <= 2048: mismo perfil que los paneles
  // generados (lo esperan el pipeline de video y el refinado).
  let buffer: Buffer;
  try {
    const sharp = (await import('sharp')).default;
    buffer = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return { ok: false, error: 'validation_error', message: 'no se pudo leer la imagen' };
  }

  const key = `storyboard-manual/${crypto.randomUUID()}.jpg`;
  let path: string;
  try {
    path = await uploadReference(workspace.id, key, buffer, 'image/jpeg');
  } catch (err) {
    return { ok: false, error: 'internal_error', message: (err as Error)?.message ?? 'upload fallo' };
  }

  // Admin client: mismo patrón que promoteOutputToReference (insert auditado en
  // media_references); el ownership ya se validó arriba con el cliente RLS.
  const admin = createAdminClient();
  const { data: ref, error: refErr } = await admin
    .from('media_references')
    .insert({
      workspace_id: workspace.id,
      user_id: user.id,
      type: 'image',
      storage_url: path,
      source: 'upload',
      source_generation_id: null,
    })
    .select('id')
    .single();
  if (refErr || !ref) {
    return { ok: false, error: 'internal_error', message: refErr?.message ?? 'no row' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('campaign_items')
    .update({ storyboard_image_id: ref.id as string, storyboard_generation_id: null, warnings: [] })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaign.id}/storyboard`);
  return { ok: true, data: { uploaded: true } };
}

// ─── acción: restaurar una versión anterior del panel ────────────────────────

// Cada generación 'done' de un beat es una versión restaurable: su promote dejó
// una media_reference en storage. Restaurar = re-enlazar el beat a esa versión
// (link swap, sin regenerar ni cobrar). Existe porque iterar el refinado degrada
// (generation-loss) y sin esto la única salida era regenerar pagando.
export async function restorePanelVersionAction(
  itemId: string,
  generationId: string,
): Promise<Result<{ restored: true }>> {
  if (!itemId || !generationId) {
    return { ok: false, error: 'validation_error', message: 'itemId y generationId requeridos' };
  }

  const { workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  const supabase = await createClient();
  const { data: gen } = await supabase
    .from('generations')
    .select('id, workspace_id, status, params')
    .eq('id', generationId)
    .single();
  const g = gen as
    | { id: string; workspace_id: string; status: string; params: { storyboard?: { campaignItemId?: string } } | null }
    | null;
  if (!g || g.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };
  // La versión debe ser de ESTE beat y estar terminada.
  if (g.status !== 'done' || g.params?.storyboard?.campaignItemId !== itemId) {
    return { ok: false, error: 'forbidden', message: 'Esa generación no es una versión de este panel' };
  }

  const { data: refs } = await supabase
    .from('media_references')
    .select('id')
    .eq('source_generation_id', generationId)
    .limit(1);
  const refId = (refs?.[0] as { id: string } | undefined)?.id;
  if (!refId) {
    // Promote perdido para esa versión (raro): sin media_reference no hay imagen
    // que enlazar. Mejor decirlo que fabricar el promote aquí (el heal lo repara).
    return { ok: false, error: 'not_found', message: 'Esa versión no tiene imagen promovida; usa otra' };
  }

  const { error } = await supabase
    .from('campaign_items')
    .update({ storyboard_image_id: refId, storyboard_generation_id: generationId })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaign.id}/storyboard`);
  return { ok: true, data: { restored: true } };
}

// Refinamiento de audio por beat: reescribe el diálogo dentro de scene_prompt y
// ajusta la duración del clip para que la voz (lip-sync de Seedance) no se apresure.
// No genera nada (texto + duración); el resultado se oye al regenerar el video.
export async function setBeatAudioAction(
  itemId: string,
  dialogue: string,
  durationS: number,
  voiceTone: string | null = null,
): Promise<Result<{ updated: true }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };
  if (typeof dialogue !== 'string' || dialogue.length > 600) {
    return { ok: false, error: 'validation_error', message: 'diálogo inválido (máx 600 caracteres)' };
  }
  if (!Number.isInteger(durationS) || durationS < 4 || durationS > 15) {
    return { ok: false, error: 'validation_error', message: 'duración fuera del rango 4-15s' };
  }
  const tone = typeof voiceTone === 'string' ? voiceTone.trim() : '';
  if (tone.length > 80) {
    return { ok: false, error: 'validation_error', message: 'tono inválido (máx 80 caracteres)' };
  }
  const cleanTone = tone.length > 0 ? tone : null;

  const { workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  const nextPrompt = replaceDialogue(item.scene_prompt, dialogue);

  const supabase = await createClient();
  const { error } = await supabase
    .from('campaign_items')
    .update({ scene_prompt: nextPrompt, duration_s: durationS, voice_tone: cleanTone })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaign.id}/storyboard`);
  revalidatePath(`/app/campaigns/${campaign.id}`);
  return { ok: true, data: { updated: true } };
}

// ─── acción: usar un resultado del estudio como panel del beat ────────────────

// El estudio de panel produce turnos normales (generations con studio_session_id).
// "Usar como panel" toma el turno elegido, promueve su output a media_references y
// ancla el beat (storyboard_image_id/_generation_id) — igual que promoteStoryboardPanel.
// Además ESTAMPA la generación (campaign_id + params.storyboard.campaignItemId) para
// que aparezca en el historial de versiones y sea restaurable. Idempotente: si el
// output ya se promovió (media_reference con ese source_generation_id), reusa esa ref.
export async function usePanelFromStudioAction(
  itemId: string,
  generationId: string,
): Promise<Result<{ applied: true }>> {
  if (!itemId || !generationId) {
    return { ok: false, error: 'validation_error', message: 'itemId y generationId requeridos' };
  }

  const { user, workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item } = loaded;

  const supabase = await createClient();
  const { data: gen } = await supabase
    .from('generations')
    .select('id, workspace_id, status, output_url, studio_session_id')
    .eq('id', generationId)
    .single();
  const g = gen as
    | { id: string; workspace_id: string; status: string; output_url: string | null; studio_session_id: string | null }
    | null;
  if (!g || g.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };
  if (g.status !== 'done' || !g.output_url) {
    return { ok: false, error: 'forbidden', message: 'La generación no está lista' };
  }

  // Defensa: el turno debe venir del estudio de ESTE panel (sesión panel + asset_id).
  if (!g.studio_session_id) {
    return { ok: false, error: 'forbidden', message: 'La generación no es un turno del estudio' };
  }
  const { data: sess } = await supabase
    .from('studio_sessions')
    .select('id')
    .eq('id', g.studio_session_id)
    .eq('workspace_id', workspace.id)
    .eq('asset_type', 'panel')
    .eq('asset_id', itemId)
    .maybeSingle();
  if (!sess) {
    return { ok: false, error: 'forbidden', message: 'La generación no pertenece al estudio de este panel' };
  }

  // Promote idempotente: reusar la media_reference existente de esta gen si ya
  // fue aplicada antes (evita duplicar objeto en storage al reaplicar).
  const { data: existingRefs } = await supabase
    .from('media_references')
    .select('id')
    .eq('source_generation_id', generationId)
    .limit(1);
  let refId = (existingRefs?.[0] as { id: string } | undefined)?.id ?? null;
  if (!refId) {
    try {
      refId = await promoteOutputToReference(workspace.id, user.id, g.output_url, generationId);
    } catch (err) {
      return { ok: false, error: 'internal_error', message: (err as Error)?.message ?? 'promote fallo' };
    }
  }

  // Estampar la gen para el historial de versiones (merge preservando params del
  // turno). Admin: mismo criterio que promote (ownership ya validado arriba).
  const admin = createAdminClient();
  const { data: cur } = await admin
    .from('generations')
    .select('params')
    .eq('id', generationId)
    .single();
  const curParams = ((cur as { params?: Record<string, unknown> | null } | null)?.params ?? {}) as Record<string, unknown>;
  const nextParams = { ...curParams, storyboard: { campaignItemId: itemId } };
  const { error: stampErr } = await admin
    .from('generations')
    .update({ campaign_id: item.campaign_id, params: nextParams })
    .eq('id', generationId);
  if (stampErr) {
    return { ok: false, error: 'internal_error', message: stampErr.message };
  }

  const { error } = await supabase
    .from('campaign_items')
    .update({ storyboard_image_id: refId, storyboard_generation_id: generationId, warnings: [] })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${item.campaign_id}/storyboard`);
  return { ok: true, data: { applied: true } };
}
