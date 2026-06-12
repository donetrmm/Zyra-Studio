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
    .select('id, workspace_id, product_brief, language, brand_kit_id')
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

function buildSystemPrompt(args: {
  format: FormatDirection | null;
  productName: string;
  stage: Stage;
  characters: Array<{ id: string; name: string }>;
}): string {
  const shots = SHOTS.map((s) => `- ${s.slug}: ${s.name} (${s.whenToUse})`).join('\n');
  const cast = args.characters.map((c) => `- id=${c.id} ${c.name}`).join('\n') || '(vacío)';
  return `Eres director creativo senior guiando a un usuario SIN experiencia para
definir un creativo de video publicitario. Producto: "${args.productName}".
Formato: ${args.format ? `${args.format.name} — registro ${args.format.register}, cámara ${args.format.cameraStyle}` : 'aún sin formato'}.
Etapa actual: ${args.stage} (${STAGE_LABEL[args.stage]}). Etapas: what → shot → refs → review.

Reglas duras:
- UNA pregunta por turno, en español, máximo 2 frases. Máximo 2-3 aclaraciones por etapa, luego avanza.
- chips: 2-4 respuestas sugeridas cortas y clicables.
- draftPatch: actualiza el borrador con lo que el usuario ya decidió
  (scenePrompt en inglés cinematográfico, una acción y un movimiento de cámara).
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
    if (!['planned', 'skipped', 'failed'].includes(item.status as string)) {
      return { ok: false, error: 'forbidden', message: 'El creativo ya está en producción' };
    }
    existingCharacterIds = (item.character_ids as string[] | null) ?? [];
  }

  // Formato custom: nace aquí, del workspace, visible en /app/formats.
  let formatId = parsed.data.draft.formatId;
  let createdCustomFormat = false;
  if (!formatId && parsed.data.draft.customFormat) {
    const cf = parsed.data.draft.customFormat;
    const { data: created, error } = await supabase
      .from('formats')
      .insert({
        slug: cf.slug,
        name: cf.name,
        description: cf.description,
        register: cf.register,
        camera_style: cf.cameraStyle,
        pacing: cf.pacing,
        required_refs: cf.requiredRefs,
        default_duration_s: cf.defaultDurationS,
        default_audio: cf.defaultAudio,
        is_system: false,
        workspace_id: workspace.id,
      })
      .select('id')
      .single();
    if (error && error.code !== '23505') return { ok: false, error: 'internal_error', message: error.message };
    if (created) {
      formatId = created.id as string;
      createdCustomFormat = true;
    } else {
      // 23505: slug ya existe globalmente. Intentar recuperar si pertenece a este workspace.
      const { data: existing } = await supabase
        .from('formats')
        .select('id')
        .eq('slug', cf.slug)
        .eq('workspace_id', workspace.id)
        .single();
      formatId = (existing?.id as string) ?? null;
      if (!formatId) {
        // El slug pertenece al sistema u otro workspace — colisión irrecuperable.
        return {
          ok: false,
          error: 'conflict',
          message: 'Ya existe un formato con ese nombre; renómbralo en la conversación',
        };
      }
    }
  }
  if (!formatId) return { ok: false, error: 'validation_error', message: 'El creativo no tiene formato' };

  // Cobro atómico de la sesión: una sola vez, al aceptar.
  const cost = await loadRefineCost();
  const charged = await chargeCredits(user.id, cost, 'refine_session', {
    campaign_id: parsed.data.campaignId,
  });
  if (!charged) return { ok: false, error: 'insufficient_credits' };

  const row = {
    format_id: formatId,
    scene: parsed.data.draft.scene,
    scene_prompt: parsed.data.draft.scenePrompt.trim(),
    shot: parsed.data.draft.shot,
    character_id: parsed.data.draft.characterId,
    // Sync principal/elenco: el principal del refinado encabeza y el resto
    // del elenco existente se conserva (máx 3).
    character_ids: parsed.data.draft.characterId
      ? [
          parsed.data.draft.characterId,
          ...existingCharacterIds.filter((id) => id !== parsed.data.draft.characterId),
        ].slice(0, 3)
      : [],
    reference_ids: parsed.data.draft.referenceIds,
    caption: parsed.data.draft.caption,
    duration_s: parsed.data.draft.durationS ?? ctx.format?.defaultDurationS ?? 8,
    aspect_ratio: parsed.data.draft.aspectRatio ?? '9:16',
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
    return { ok: false, error: 'internal_error', message: persisted.error?.message };
  }

  if (createdCustomFormat) revalidatePath('/app/formats');
  revalidatePath(`/app/campaigns/${parsed.data.campaignId}`);
  return { ok: true, data: { itemId: persisted.data.id as string } };
}
