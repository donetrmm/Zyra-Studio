'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { chargeCredits, refundCharge } from '@/lib/credits/operations';
import { loadPricing } from '@/lib/credits/pricing';
import { requestRefineTurn } from '@/lib/refine/gemini';
import { applyDraftPatch, clampStage, validateDraft } from '@/lib/refine/turn';
import { MAX_TURNS, STAGE_LABEL, type RefineDraft, type Stage } from '@/lib/refine/types';
import { SHOTS } from '@/lib/shots/catalog';
import { AcceptRefineInputSchema, RefineTurnInputSchema } from '@/lib/schemas/refine';
import type { FormatDirection } from '@/lib/prompt-director/types';
import { validateOwnedCharacters } from '@/lib/campaigns/characters';
import { insertOrRecoverCustomFormat } from '@/lib/campaigns/custom-format';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const REFINE_FALLBACK_COST = 8;
// Espejo del literal en server-actions/campaigns.ts (no exportado).
const DRAFT_MODEL = 'bytedance/seedance-2.0/fast/reference-to-video';

async function loadRefineCost(): Promise<number> {
  const pricing = await loadPricing();
  const row = pricing.find((p) => p.provider === 'internal' && p.model_id === 'refine-session');
  return row?.credits_cost ?? REFINE_FALLBACK_COST;
}

// Contexto server-side del turno: formato, brief, Cast. El cliente nunca
// dicta el contexto — solo su historial y su borrador.
async function loadContext(campaignId: string, draft: RefineDraft) {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, product_brief, language, brand_kit_id, aspect_ratio')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return null;

  let format: FormatDirection | null = null;
  if (draft.formatId) {
    const { data: f } = await supabase
      .from('formats')
      .select('slug, name, register, camera_style, pacing, required_refs, default_duration_s, default_audio')
      .eq('id', draft.formatId)
      .single();
    if (f) {
      format = {
        slug: f.slug as string,
        name: f.name as string,
        register: (f.register as string) ?? '',
        cameraStyle: (f.camera_style as string) ?? '',
        pacing: (f.pacing as string) ?? '',
        requiredRefs: ((f.required_refs as string[]) ?? []) as FormatDirection['requiredRefs'],
        defaultDurationS: (f.default_duration_s as number) ?? 8,
        defaultAudio: (f.default_audio as boolean) ?? true,
      };
    }
  } else if (draft.customFormat) {
    format = {
      slug: draft.customFormat.slug,
      name: draft.customFormat.name,
      register: draft.customFormat.register,
      cameraStyle: draft.customFormat.cameraStyle,
      pacing: draft.customFormat.pacing,
      requiredRefs: draft.customFormat.requiredRefs,
      defaultDurationS: draft.customFormat.defaultDurationS,
      defaultAudio: draft.customFormat.defaultAudio,
    };
  }

  const { data: characters } = await supabase
    .from('characters')
    .select('id, name')
    .eq('workspace_id', workspace.id);

  return { user, workspace, supabase, campaign, format, characters: characters ?? [] };
}

// Serializa el borrador para que Gemini SIEMPRE sepa sobre qué creativo está
// trabajando — sin esto, al refinar un item del plan partía a ciegas del
// scene_prompt existente (bug reportado 2026-06-12).
function describeDraft(
  draft: RefineDraft,
  characters: Array<{ id: string; name: string }>,
): string {
  const characterName = draft.characterId
    ? characters.find((c) => c.id === draft.characterId)?.name ?? draft.characterId
    : null;
  const lines = [
    `- scenePrompt actual: ${draft.scenePrompt.trim() || '(vacío — creativo nuevo)'}`,
    draft.sceneSummary ? `- resumen actual: ${draft.sceneSummary}` : null,
    draft.scene ? `- escena: ${draft.scene}` : null,
    draft.shot ? `- toma: ${draft.shot}` : null,
    characterName ? `- personaje: ${characterName}` : null,
    draft.durationS ? `- duración: ${draft.durationS}s` : null,
    draft.referenceIds.length ? `- referencias extra adjuntas: ${draft.referenceIds.length}` : null,
    draft.caption ? `- caption: ${draft.caption}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}

function buildSystemPrompt(args: {
  format: FormatDirection | null;
  productName: string;
  stage: Stage;
  characters: Array<{ id: string; name: string }>;
  draft: RefineDraft;
  language: 'es' | 'en';
}): string {
  const shots = SHOTS.map((s) => `- ${s.slug}: ${s.name} (${s.whenToUse})`).join('\n');
  const cast = args.characters.map((c) => `- id=${c.id} ${c.name}`).join('\n') || '(vacío)';
  const duration = args.format?.defaultDurationS ?? 8;
  return `Eres director creativo senior guiando a un usuario SIN experiencia para
definir un creativo de video publicitario. Producto: "${args.productName}".
Formato: ${args.format ? `${args.format.name} — registro ${args.format.register}, cámara ${args.format.cameraStyle}, ${duration}s` : 'aún sin formato'}.
Etapa actual: ${args.stage} (${STAGE_LABEL[args.stage]}). Etapas: what → shot → refs → review.

Borrador actual (estás MODIFICANDO esto, no partiendo de cero; conserva lo que
el usuario no pida cambiar):
${describeDraft(args.draft, args.characters)}

Reglas duras:
- RESPETA EL ALCANCE DEL USUARIO. Si dice que SOLO quiere un cambio, que ya
  está bien, que no quiere nada más, o responde "no/listo/así está/eso es todo":
  aplica lo pedido en draftPatch y devuelve stage="review". NO preguntes por
  otros aspectos que no mencionó (toma, referencias, etc.). NUNCA repitas una
  pregunta ya respondida ni reabras algo que el usuario dio por bueno. Ante la
  duda, ve a "review" en vez de volver a preguntar.
- Si el usuario pide que la VOZ suene más humana/natural (o menos robótica o de
  locutor): la cadencia natural y anti-locutor YA la aplica el sistema de forma
  automática sobre todo diálogo hablado. NO pegues frases de cadencia en el
  scenePrompt (se duplican y diluyen el énfasis). Solo asegúrate de que la escena
  tenga diálogo hablado marcado (Dialogue: "...") para que esa dirección se
  aplique; no inventes diálogo nuevo si el usuario no lo pidió. Luego stage="review".
- UNA pregunta por turno, en español, máximo 2 frases. Máximo 2-3 aclaraciones por etapa, luego avanza.
- chips: 2-4 respuestas sugeridas cortas y clicables. Incluye siempre una opción
  para cerrar (p. ej. "Así está bien").
- draftPatch: actualiza el borrador con lo que el usuario ya decidió.
  scenePrompt en inglés cinematográfico, una acción y un movimiento de cámara
  por toma. Si la escena tiene varios beats o dura 8s o más, estructura el
  scenePrompt como timeline con marcadores de segundos que cubran la duración
  ("0-3s: ... 3-7s: ..."), una acción por tramo, cierre con el producto.
  Diálogo: SOLO si el usuario pide que alguien hable o da las líneas —
  guionízalo dentro de cada tramo (Dialogue: "...") ${args.language === 'en' ? 'in ENGLISH' : 'en ESPAÑOL'},
  corto y conversacional, como se le habla a un amigo, nunca de locutor.
  Si no pidió diálogo, no lo inventes.
  durationS: elige los segundos que la escena NECESITA (4-15, 1 acción ≈ 4s);
  no uses la duración default si la acción pide otra cosa.
  Cada vez que cambies scenePrompt actualiza también sceneSummary: 1 frase
  ${args.language === 'en' ? 'in ENGLISH' : 'en ESPAÑOL'}, máx 200 caracteres,
  sin marcadores de segundos (es lo que el usuario lee en el panel).
- En etapa shot propone slugs SOLO de este catálogo:\n${shots}
- En etapa refs, characterId solo de este Cast:\n${cast}
- Nunca inventes atributos del producto ni claims.
Devuelve SOLO JSON: {"reply":"...","stage":"what|shot|refs|review","chips":[...],"draftPatch":{...}}`;
}

export async function refineItemTurnAction(input: unknown): Promise<
  Result<{
    reply: string;
    stage: Stage;
    chips: string[];
    draft: RefineDraft;
    validation: { errors: string[]; warnings: string[] };
  }>
> {
  const parsed = RefineTurnInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };

  const ctx = await loadContext(parsed.data.campaignId, parsed.data.draft);
  if (!ctx) return { ok: false, error: 'not_found' };

  const brief = (ctx.campaign.product_brief ?? {}) as { productName?: string };
  const userTurns = parsed.data.history.filter((t) => t.role === 'user').length + 1;
  const currentStage: Stage = userTurns >= MAX_TURNS ? 'review' : parsed.data.stage;

  try {
    const turn = await requestRefineTurn({
      system: buildSystemPrompt({
        format: ctx.format,
        productName: brief.productName ?? 'el producto',
        stage: currentStage,
        characters: ctx.characters as Array<{ id: string; name: string }>,
        draft: parsed.data.draft,
        language: ctx.campaign.language === 'en' ? 'en' : 'es',
      }),
      history: [...parsed.data.history, { role: 'user', text: parsed.data.userMessage }],
    });
    const draft = applyDraftPatch(parsed.data.draft, turn.draftPatch);
    const stage = clampStage(currentStage, turn.stage, userTurns);
    const validation = validateDraft(draft, { format: ctx.format });
    return { ok: true, data: { reply: turn.reply, stage, chips: turn.chips, draft, validation } };
  } catch (e) {
    return { ok: false, error: 'provider_error', message: (e as Error).message };
  }
}

export async function acceptRefinedItemAction(input: unknown): Promise<Result<{ itemId: string }>> {
  const parsed = AcceptRefineInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };

  const ctx = await loadContext(parsed.data.campaignId, parsed.data.draft);
  if (!ctx) return { ok: false, error: 'not_found' };
  const { user, workspace, supabase } = ctx;

  // Re-validación dura server-side: el cliente puede mentir.
  const validation = validateDraft(parsed.data.draft, { format: ctx.format });
  if (validation.errors.length > 0) {
    return { ok: false, error: 'validation_error', message: validation.errors[0] };
  }
  if (!parsed.data.draft.scenePrompt.trim()) {
    return { ok: false, error: 'validation_error', message: 'El creativo no tiene escena' };
  }

  // Si el item existe, debe seguir editable. Su elenco actual se conserva
  // al sincronizar character_ids (el refinado solo decide el principal).
  let existingCharacterIds: string[] = [];
  if (parsed.data.itemId) {
    const { data: item } = await supabase
      .from('campaign_items')
      .select('id, status, campaign_id, character_ids')
      .eq('id', parsed.data.itemId)
      .eq('campaign_id', parsed.data.campaignId)
      .single();
    if (!item) return { ok: false, error: 'not_found' };
    // draft_ready incluido: refinar un borrador y regenerarlo. Solo se bloquea
    // mientras se está generando (sample/queued) o ya es final.
    if (!['planned', 'skipped', 'failed', 'draft_ready'].includes(item.status as string)) {
      return { ok: false, error: 'forbidden', message: 'El creativo está generándose o ya es final' };
    }
    existingCharacterIds = (item.character_ids as string[] | null) ?? [];
  }

  // Ownership del personaje principal: viene del cliente, validar antes de persistir.
  if (parsed.data.draft.characterId) {
    const owned = await validateOwnedCharacters(supabase, workspace.id, [parsed.data.draft.characterId]);
    if (owned === null) {
      return { ok: false, error: 'validation_error', message: 'Personaje no encontrado o sin imagen' };
    }
  }

  // Formato custom: nace aquí, del workspace, visible en /app/formats.
  let formatId = parsed.data.draft.formatId;
  let createdCustomFormat = false;
  if (!formatId && parsed.data.draft.customFormat) {
    // El refinado NO uniquifica: si el slug pertenece a otro workspace, surface
    // un conflicto para que el usuario lo renombre en la conversación.
    const outcome = await insertOrRecoverCustomFormat(
      supabase,
      workspace.id,
      parsed.data.draft.customFormat,
      { uniquifyOnConflict: false },
    );
    if (outcome.status === 'error') return { ok: false, error: 'internal_error', message: outcome.message };
    if (outcome.status === 'conflict') {
      return {
        ok: false,
        error: 'conflict',
        message: 'Ya existe un formato con ese nombre; renómbralo en la conversación',
      };
    }
    formatId = outcome.id;
    createdCustomFormat = outcome.status === 'created';
  }
  if (!formatId) return { ok: false, error: 'validation_error', message: 'El creativo no tiene formato' };

  // Cobro atómico de la sesión: una sola vez, al aceptar.
  const cost = await loadRefineCost();
  const charged = await chargeCredits(user.id, cost, 'refine_session', {
    campaign_id: parsed.data.campaignId,
  });
  if (!charged) {
    // Sin créditos: limpiar el formato custom recién creado para no dejarlo
    // huérfano en /app/formats por un creativo que nunca se persistió.
    if (createdCustomFormat && formatId) {
      await supabase.from('formats').delete().eq('id', formatId);
    }
    return { ok: false, error: 'insufficient_credits' };
  }

  const row = {
    format_id: formatId,
    scene: parsed.data.draft.scene,
    scene_prompt: parsed.data.draft.scenePrompt.trim(),
    scene_summary: parsed.data.draft.sceneSummary,
    shot: parsed.data.draft.shot,
    character_id: parsed.data.draft.characterId,
    // Sync principal/elenco (misma semántica que updateCampaignItemAction): el
    // principal nuevo REEMPLAZA al anterior y conserva a los secundarios (máx 3).
    // Con characterId null el refinado define el creativo SIN personajes (elenco
    // vacío a propósito); el invariante character_id = character_ids[0] ?? null
    // se mantiene.
    character_ids: parsed.data.draft.characterId
      ? [
          parsed.data.draft.characterId,
          ...existingCharacterIds.slice(1).filter((id) => id !== parsed.data.draft.characterId),
        ].slice(0, 3)
      : [],
    reference_ids: parsed.data.draft.referenceIds,
    caption: parsed.data.draft.caption,
    duration_s: parsed.data.draft.durationS ?? ctx.format?.defaultDurationS ?? 8,
    // Sin elección explícita en el refinado, manda el formato de la campaña (034).
    aspect_ratio: parsed.data.draft.aspectRatio ?? (ctx.campaign.aspect_ratio as string | null) ?? '9:16',
    warnings: validation.warnings,
    status: 'planned' as const,
  };

  const persisted = parsed.data.itemId
    ? await supabase.from('campaign_items').update(row).eq('id', parsed.data.itemId).select('id').single()
    : await supabase
        .from('campaign_items')
        .insert({ ...row, campaign_id: parsed.data.campaignId, model_slug: DRAFT_MODEL })
        .select('id')
        .single();

  if (persisted.error || !persisted.data) {
    await refundCharge(user.id, cost, 'refine_session_refund', {
      campaign_id: parsed.data.campaignId,
    }).catch(() => {});
    // Mismo motivo que en el path sin créditos: el formato custom no debe
    // sobrevivir a un creativo que no se persistió.
    if (createdCustomFormat && formatId) {
      await supabase.from('formats').delete().eq('id', formatId);
    }
    return { ok: false, error: 'internal_error', message: persisted.error?.message };
  }

  if (createdCustomFormat) revalidatePath('/app/formats');
  revalidatePath(`/app/campaigns/${parsed.data.campaignId}`);
  return { ok: true, data: { itemId: persisted.data.id as string } };
}
