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
  type ItemRow,
} from '@/lib/campaigns/orchestrator';
import { compilePanel, compilePanelEdit, compileRefinePrompt, humanRealismDirective, chainedProductFidelity, chainedCharacterFidelity } from '@/lib/campaigns/storyboard';
import { buildStoryboardJobPayload } from '@/lib/campaigns/storyboard-job';
import { enqueueJob } from '@/lib/jobs/queue';
import { describeProductScale } from '@/lib/prompt-director/inventory';
import { creativeGuidelineClauses, guidelinesForSafeBase } from '@/lib/campaigns/guidelines';
import { replaceDialogue } from '@/lib/campaigns/speech-fit';

// Slugs reales del proyecto (mirror de lib/router/model-selector.ts).
// FLUX_MODEL_SLUG: SOLO para compilar el prompt de composición (el compiler FLUX
//   arma escena + producto + personaje). La GENERACIÓN del panel la hace Nano Banana
//   (reference-grounded), porque FLUX no mantenía fieles producto/personaje.
// NANO: Gemini 3 Pro — genera y edita el panel preservando las referencias.
const FLUX_MODEL_SLUG = 'flux-2-pro-preview';

// Tope de refinados por panel (paridad con el refinado conversacional de items).
// NO exportar: este archivo es 'use server' y exportar no-funciones rompe en prod.
const MAX_REFINE_TURNS = 10;

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
};

type CampaignRow = {
  id: string;
  workspace_id: string;
  brand_kit_id: string | null;
  product_brief: Record<string, unknown> | null;
  language: string | null;
  include_packaging: boolean | null;
  creative_guidelines: Record<string, unknown> | null;
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
    .select('id, workspace_id, brand_kit_id, product_brief, language, include_packaging, creative_guidelines')
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
  opts?: { productRefInChat?: boolean; characterRefInChat?: boolean },
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
    character_state_hint: null,
    location_id: item.location_id,
    storyboard_image_id: null,
  };

  const dirCtx = directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation);

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
  const noText = ' Do not render any text, captions, speech bubbles, subtitles, labels or watermark in the image.';
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
  const panelPromptBody = prevRef
    ? `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and in the same position in the scene), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${item.scene_prompt.trim()}.${chainedProductFidelity(dirCtx)}${describeProductScale(dirCtx.product)}${creativeGuidelineClauses(baseDirCtx.guidelines, { isOpeningBeat: (item.scene_index ?? 0) === 0 })}${characterFidelityText}${productRefPointer}${characterRefPointer}${noText}`
    : `${compiled.compiled.prompt}${humanRealismDirective(dirCtx, item.scene_prompt)}${describeProductScale(dirCtx.product)}${noText}`;
  const panelPrompt = panelPromptBody;

  const imageRefs = compiled.compiled.references.filter((r) => r.kind === 'image');
  const referencePaths = imageRefs.map((r) => r.storagePath);
  const chatRefPaths = [
    ...(productRefInChat ? imageRefs.filter((r) => r.role === 'product').map((r) => r.storagePath) : []),
    ...(characterRefInChat ? imageRefs.filter((r) => r.role === 'character').map((r) => r.storagePath) : []),
  ];

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

// ─── acción: refinar panel (Nano Banana Pro conversacional) ──────────────────

export async function refinePanelAction(
  itemId: string,
  instruction: string,
  opts?: { productRefInChat?: boolean; characterRefInChat?: boolean; strongEdit?: boolean },
): Promise<Result<{ generationId: string }>> {
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

  // Mismo guard de concurrencia que generatePanelAction: no refinar mientras
  // otra generación del beat está en vuelo (incluye una regeneración en curso:
  // el refinado encadenaría sobre un panel que está a punto de ser reemplazado).
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

  // Límite de turnos de refinado por sesión de panel (paridad con el refinado
  // de items de campaña). Un refinado se distingue por parent_generation_id
  // (solo el refine lo setea). La sesión arranca en la última generación FRESCA
  // del beat (sin parent): regenerar el panel empieza una sesión nueva y
  // resetea la cuenta — coherente con el mensaje que ve el usuario.
  const { data: lastFresh } = await supabase
    .from('generations')
    .select('created_at')
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .is('parent_generation_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  let turnsQuery = supabase
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .contains('params', { storyboard: { campaignItemId: itemId } })
    .not('parent_generation_id', 'is', null)
    .in('status', ['queued', 'processing', 'done']);
  const lastFreshAt = (lastFresh as { created_at?: string } | null)?.created_at;
  if (lastFreshAt) {
    turnsQuery = turnsQuery.gt('created_at', lastFreshAt);
  }
  const { count: turns } = await turnsQuery;
  // Fail-open: si la query falla, count es null y el guard deja pasar — mejor
  // permitir un turno de más que bloquear el refinado por un error transitorio.
  if ((turns ?? 0) >= MAX_REFINE_TURNS) {
    return { ok: false, error: 'max_turns' };
  }

  const characterIds: string[] = item.character_ids?.length
    ? item.character_ids.slice(0, 3)
    : item.character_id
      ? [item.character_id]
      : [];

  const ctx = await loadCampaignContext(workspace.id, campaign, characterIds);

  // Locación: misma referencia environment que en la generación, para que el
  // refinado no pierda el lugar.
  const locMap = await resolveLocations(supabase, workspace.id, item.location_id ? [item.location_id] : []);
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
    character_state_hint: null,
  };

  const dirCtx = directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation);

  const guidelines = dirCtx.guidelines;
  const strictSafe =
    Boolean(guidelines?.safeAreaExtend) &&
    guidelines?.safeCrop === '4:5' &&
    (item.aspect_ratio ?? '9:16') === '9:16';
  const refineDirCtx = strictSafe ? { ...dirCtx, guidelines: guidelinesForSafeBase(dirCtx.guidelines) } : dirCtx;
  const genAspect = strictSafe ? '4:5' : (item.aspect_ratio ?? '9:16');

  const compiled = compilePanelEdit(instruction, item.aspect_ratio, dirCtx, NANO_MODEL_SLUG);
  if (!compiled.ok) {
    return { ok: false, error: 'compile_error', message: compiled.errors.join('; ') };
  }

  // El prompt de compilePanelEdit ancla producto/personaje/locacion como "as in the
  // reference image", pero al refinar entramos en chat real y el provider descarta esas
  // refs (refSlots=0): esas clausulas apuntan a imagenes que no viajan. compileRefinePrompt
  // ancla producto y personaje por TEXTO (mismas anclas que la rama encadenada de
  // regenerar); la escena y la locacion las preserva el turno previo. Se conserva `compiled`
  // por sus referencias, que SI viajan en el fallback single-turn (sin thought_signature).
  // Los toggles "mantener identico" (mismos que regenerar) re-anclan la ficha del
  // producto/personaje EN el turno de chat: para ediciones de construccion ("haz el
  // borde mas delgado") el texto solo no basta — la ficha multi-vista da los pixeles.
  const refineImageRefs = compiled.compiled.references.filter((r) => r.kind === 'image');
  const refineProductRefInChat = opts?.productRefInChat ?? process.env.STORYBOARD_PRODUCT_REF_IN_CHAT === '1';
  const refineCharacterRefInChat = opts?.characterRefInChat ?? process.env.STORYBOARD_CHARACTER_REF_IN_CHAT === '1';
  const refineChatRefPaths = [
    ...(refineProductRefInChat ? refineImageRefs.filter((r) => r.role === 'product').map((r) => r.storagePath) : []),
    ...(refineCharacterRefInChat ? refineImageRefs.filter((r) => r.role === 'character').map((r) => r.storagePath) : []),
  ];
  const refinePointers = [
    refineProductRefInChat && refineImageRefs.some((r) => r.role === 'product')
      ? ' A reference image of the product is attached — match its real construction and proportions exactly (edge thickness, frame, finish, printed content), while still applying the requested edit.'
      : '',
    refineCharacterRefInChat && refineImageRefs.some((r) => r.role === 'character')
      ? ' A reference image of each character is attached — keep their exact face, hair, build and wardrobe.'
      : '',
  ].join('');
  const refinePrompt = compileRefinePrompt(instruction, refineDirCtx, {
    isOpeningBeat: (item.scene_index ?? 0) === 0,
    extraClauses: refinePointers || undefined,
  });

  // Ref del panel padre para encadenar (sin descargar: el worker baja la imagen).
  // La firma del turno previo NO se embebe en el payload (viaja en params ->
  // broadcast Realtime >1MB + SELECT gigante en el worker): se referencia la gen
  // padre y el worker lee provider_payload.thought_signature al correr el job.
  //
  // EDICION FUERTE (toggle propio en la UI): el refine OMITE la firma a proposito
  // -> single-turn: el panel viaja como imagen adjunta ("Edit the previous image
  // (attached) based on: ...") y las refs de ficha como referencias normales. El
  // chat con firma reconstruye el estado previo con tanta fuerza que ediciones de
  // geometria (grosor del borde) no cedian ni con sandwich + refs; la edicion
  // directa imagen+instruccion (flujo tipo ChatGPT) si obedece. Es un modo aparte
  // de los toggles "mantener identico" (esos solo anclan la ficha).
  const strongEdit = opts?.strongEdit ?? false;
  let prevTurnRef: { imagePath: string; sourceGenerationId?: string; prompt: string } | null = null;
  const parentGenId = item.storyboard_generation_id;
  if (parentGenId) {
    const { data: parent } = await supabase
      .from('generations')
      .select('output_url, workspace_id, status, prompt, model_id, safe_base_path:provider_payload->>safe_base_path')
      .eq('id', parentGenId)
      .single();
    const pg = parent as
      | { output_url: string | null; workspace_id: string; status: string; prompt: string | null; model_id: string; safe_base_path: string | null }
      | null;
    if (pg && pg.workspace_id === workspace.id && pg.output_url && pg.status === 'done') {
      prevTurnRef = {
        imagePath: pg.safe_base_path ?? pg.output_url,
        prompt: pg.prompt ?? '',
        sourceGenerationId:
          !strongEdit && pg.model_id === NANO_MODEL_SLUG ? parentGenId : undefined,
      };
    }
  }

  const referencePaths = refineImageRefs.map((r) => r.storagePath);
  const payload = buildStoryboardJobPayload({
    campaignItemId: itemId,
    campaignId: item.campaign_id,
    genAspect,
    strict: strictSafe,
    referencePaths,
    chatRefPaths: refineChatRefPaths,
    prevTurn: prevTurnRef,
    // Ancla de escenografia para las bandas del expand 9:16 (sin locacion queda neutro).
    expandHint: resolvedLoc ? [resolvedLoc.name, resolvedLoc.description].filter(Boolean).join(': ') : undefined,
  });

  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: true, passes: strictSafe ? 2 : 1 },
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
      prompt: refinePrompt,
      params: {
        aspect_ratio: item.aspect_ratio,
        conversational: true,
        has_text_in_image: false,
        use_grounding: false,
        storyboard: payload,
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

  const reserved = await reserveCredits(user.id, cost, generationId);
  if (!reserved) {
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    return { ok: false, error: 'insufficient_credits' };
  }

  try {
    await enqueueJob({ generationId, action: 'submit' });
  } catch (err) {
    try {
      await failGeneration(user.id, generationId, cost, `enqueue fallo: ${(err as Error)?.message ?? 'unknown'}`);
    } catch (failErr) {
      console.error('[storyboard:enqueue_rollback:refine]', { generationId, failErr });
    }
    return { ok: false, error: 'internal_error', message: 'no se pudo encolar la generacion' };
  }

  // Limpia el aviso del intento fallido anterior: ya hay una generación nueva en
  // vuelo. Best-effort (el cliente supabase no lanza; un error aquí no bloquea).
  await supabase.from('campaign_items').update({ warnings: [] }).eq('id', itemId);

  return { ok: true, data: { generationId } };
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
): Promise<Result<{ updated: true }>> {
  if (!itemId) return { ok: false, error: 'validation_error', message: 'itemId requerido' };
  if (typeof dialogue !== 'string' || dialogue.length > 600) {
    return { ok: false, error: 'validation_error', message: 'diálogo inválido (máx 600 caracteres)' };
  }
  if (!Number.isInteger(durationS) || durationS < 4 || durationS > 15) {
    return { ok: false, error: 'validation_error', message: 'duración fuera del rango 4-15s' };
  }

  const { workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item, campaign } = loaded;

  const nextPrompt = replaceDialogue(item.scene_prompt, dialogue);

  const supabase = await createClient();
  const { error } = await supabase
    .from('campaign_items')
    .update({ scene_prompt: nextPrompt, duration_s: durationS })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${campaign.id}/storyboard`);
  revalidatePath(`/app/campaigns/${campaign.id}`);
  return { ok: true, data: { updated: true } };
}
