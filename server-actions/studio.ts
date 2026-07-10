'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import { reserveCredits, failGeneration } from '@/lib/credits/operations';
import { enqueueJob } from '@/lib/jobs/queue';
import {
  CreateStudioSessionSchema,
  SubmitStudioTurnSchema,
  StudioAssetTypeSchema,
  type StudioAssetType,
} from '@/lib/schemas/studio';

type ActionError =
  | 'validation_error'
  | 'not_found'
  | 'insufficient_credits'
  | 'internal_error';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError; message?: string };

export type StudioGeneration = {
  id: string;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  output_url: string | null;
  thumbnail_url: string | null;
  prompt: string | null;
  provider: string;
  model_id: string;
  params: Record<string, unknown>;
  created_at: string;
};

export type StudioSessionSummary = {
  id: string;
  created_at: string;
  default_provider: string;
  default_model_id: string;
};

// El activo referenciado (product/location/character) vive en su propia tabla
// workspace-scoped; un turno del estudio SIEMPRE cuelga de uno de estos tres.
const ASSET_TABLE: Record<StudioAssetType, 'products' | 'locations' | 'characters'> = {
  product: 'products',
  location: 'locations',
  character: 'characters',
};

export async function createStudioSessionAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = CreateStudioSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership: el activo debe pertenecer al workspace actual (RLS es la última
  // línea, no la primera — esta verificación evita crear una sesión huérfana
  // apuntando a un activo de otro workspace).
  const table = ASSET_TABLE[data.assetType];
  const { data: asset } = await supabase
    .from(table)
    .select('id')
    .eq('id', data.assetId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!asset) {
    return { ok: false, error: 'not_found', message: `${data.assetType} no pertenece al workspace` };
  }

  const { data: inserted, error } = await supabase
    .from('studio_sessions')
    .insert({
      workspace_id: workspace.id,
      asset_type: data.assetType,
      asset_id: data.assetId,
      default_provider: data.provider,
      default_model_id: data.modelId,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
  }

  return { ok: true, data: { id: inserted.id as string } };
}

export async function submitStudioTurnAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = SubmitStudioTurnSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership de la sesión (no solo que exista: que sea del workspace actual).
  const { data: session } = await supabase
    .from('studio_sessions')
    .select('id')
    .eq('id', data.sessionId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!session) {
    return { ok: false, error: 'not_found', message: 'Sesión no encontrada' };
  }

  // Costo recalculado server-side (gpt-image es pricing plano sin unit_size;
  // nano-banana usa el mismo estimador que el resto de la app).
  const pricing = await loadPricing();
  let cost: number;
  try {
    cost = estimateCredits(pricing, {
      provider: data.provider,
      model: data.model,
      variant: data.variant,
    }).total;
  } catch (e) {
    const msg = (e as Error).message;
    // Un combo model×variant sin fila de pricing (p. ej. flash + 4k) es una
    // entrada inválida del cliente, no un fallo interno → validation_error.
    if (msg.includes('Pricing no encontrado')) {
      return { ok: false, error: 'validation_error', message: 'Combinación de modelo y calidad no soportada' };
    }
    return { ok: false, error: 'internal_error', message: msg };
  }

  const generationId = crypto.randomUUID();

  // Insertar la fila 'queued' antes de reservar (mismo patrón que
  // submitAudioGenerationAction/submitVideoGenerationAction): si algo falla
  // después de este punto, el catch limpia vía failGeneration/delete.
  const { error: insertErr } = await supabase.from('generations').insert({
    id: generationId,
    user_id: user.id,
    workspace_id: workspace.id,
    type: 'image',
    provider: data.provider,
    model_id: data.model,
    prompt: data.prompt,
    // El handler (lib/jobs/handlers/image-turn.ts) interpreta variant por
    // proveedor: quality para gpt-image-2, nanoVariantToResolution para nano.
    params: {
      studioTurn: true,
      variant: data.variant,
      aspectRatio: data.aspectRatio,
      keepIdentical: data.keepIdentical,
      assetType: data.assetType ?? null,
    },
    reference_ids: data.referenceIds ?? [],
    parent_generation_id: data.parentGenerationId ?? null,
    studio_session_id: data.sessionId,
    status: 'queued',
    credits_estimated: cost,
    timeout_at: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
  });
  if (insertErr) {
    return { ok: false, error: 'internal_error', message: insertErr.message };
  }

  // A partir de aquí TODO va dentro del try: si reserveCredits o el enqueue
  // lanzan, el catch limpia la fila vía failGeneration (idempotente, refund
  // condicional a si la reserva llegó a hacerse).
  let reserved = false;
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }

    // SIEMPRE se encola — el estudio no tiene camino inline. timeoutSeconds:300
    // porque gpt-image-2 puede bloquear hasta ~280s (worker a maxDuration=300).
    await enqueueJob({ generationId, action: 'submit', timeoutSeconds: 300 });
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    const refundAmount = reserved ? cost : 0;
    try {
      await failGeneration(user.id, generationId, refundAmount, `queue_failed: ${message}`);
    } catch (failErr) {
      console.error('[fail_generation:studio]', {
        userId: user.id,
        generationId,
        cost: refundAmount,
        originalError: message,
        failError: (failErr as Error)?.message,
      });
    }
    return { ok: false, error: 'internal_error', message };
  }

  // Fuera del try: el job ya está encolado. Un fallo de revalidatePath (muy
  // improbable) NO debe disparar el catch de arriba y reembolsar un job vivo.
  revalidatePath('/app/library');
  return { ok: true, data: { generationId } };
}

export async function listStudioSessionGenerationsAction(
  sessionId: string,
): Promise<Result<StudioGeneration[]>> {
  if (!z.string().uuid().safeParse(sessionId).success) {
    return { ok: false, error: 'validation_error', message: 'ID inválido' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from('studio_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!session) {
    return { ok: false, error: 'not_found', message: 'Sesión no encontrada' };
  }

  const { data: rows, error } = await supabase
    .from('generations')
    .select('id, status, output_url, thumbnail_url, prompt, provider, model_id, params, created_at')
    .eq('studio_session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }

  const generations: StudioGeneration[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    status: r.status as StudioGeneration['status'],
    output_url: (r.output_url as string | null) ?? null,
    thumbnail_url: (r.thumbnail_url as string | null) ?? null,
    prompt: (r.prompt as string | null) ?? null,
    provider: r.provider as string,
    model_id: r.model_id as string,
    params: (r.params ?? {}) as Record<string, unknown>,
    created_at: r.created_at as string,
  }));

  return { ok: true, data: generations };
}

export async function listStudioSessionsAction(
  assetType: string,
  assetId: string,
): Promise<Result<StudioSessionSummary[]>> {
  const parsedType = StudioAssetTypeSchema.safeParse(assetType);
  if (!parsedType.success || !z.string().uuid().safeParse(assetId).success) {
    return { ok: false, error: 'validation_error', message: 'Parámetros inválidos' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership del activo (no basta que la sesión sea del workspace: el activo
  // también debe serlo, igual que createStudioSessionAction).
  const table = ASSET_TABLE[parsedType.data];
  const { data: asset } = await supabase
    .from(table)
    .select('id')
    .eq('id', assetId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!asset) {
    return { ok: false, error: 'not_found', message: `${parsedType.data} no pertenece al workspace` };
  }

  const { data: rows, error } = await supabase
    .from('studio_sessions')
    .select('id, created_at, default_provider, default_model_id')
    .eq('workspace_id', workspace.id)
    .eq('asset_type', parsedType.data)
    .eq('asset_id', assetId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }

  const sessions: StudioSessionSummary[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    created_at: r.created_at as string,
    default_provider: r.default_provider as string,
    default_model_id: r.default_model_id as string,
  }));
  return { ok: true, data: sessions };
}
