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
  AttachStudioImageSchema,
  type StudioAssetType,
} from '@/lib/schemas/studio';
import { ATTACH_ROLES, mergeRole } from '@/lib/studio/attach-merge';
import { loadStudioAsset } from '@/lib/studio/asset-images';
import type { StudioAssetImages } from '@/components/studio/types';
import { updateLocationAction } from '@/server-actions/locations';
import { updateCharacterAction } from '@/server-actions/cast';
import { setProductImagesAction } from '@/server-actions/products';

type ActionError =
  | 'validation_error'
  | 'not_found'
  | 'insufficient_credits'
  | 'internal_error'
  | 'forbidden';

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
  title: string | null;
  created_at: string;
  default_provider: string;
  default_model_id: string;
};

// El activo referenciado (product/location/character) vive en su propia tabla
// workspace-scoped; un turno del estudio SIEMPRE cuelga de uno de estos tres.
// Los paneles NO son activos independientes (viven bajo storyboard_panels).
const ASSET_TABLE: Record<Exclude<StudioAssetType, 'panel'>, 'products' | 'locations' | 'characters'> = {
  product: 'products',
  location: 'locations',
  character: 'characters',
};

type StudioSupabase = Awaited<ReturnType<typeof createClient>>;

// Ownership del activo: el product/location/character debe pertenecer al
// workspace (RLS es la última línea, no la primera). Compartido por
// createStudioSessionAction y listStudioSessionsAction. Los paneles usan
// ownsStoryboardPanel (Task 3).
async function ownsAsset(
  supabase: StudioSupabase,
  workspaceId: string,
  assetType: Exclude<StudioAssetType, 'panel'>,
  assetId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(ASSET_TABLE[assetType])
    .select('id')
    .eq('id', assetId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return Boolean(data);
}

export async function createStudioSessionAction(
  input: unknown,
): Promise<Result<{ id: string }>> {
  const parsed = CreateStudioSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  // Panels se crean vía la ruta /app/studio/panel (Task 4), no aquí.
  if (data.assetType === 'panel') {
    return { ok: false, error: 'validation_error', message: 'Los paneles se crean desde el storyboard.' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership: el activo debe pertenecer al workspace actual (evita crear una
  // sesión huérfana apuntando a un activo de otro workspace).
  if (!(await ownsAsset(supabase, workspace.id, data.assetType, data.assetId))) {
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

  // Si el turno edita sobre una imagen de trabajo, la generación padre debe ser
  // del workspace: evita apuntar a una generación ajena. El worker igual la
  // ignoraría (resolveBaseImage filtra por workspace), pero acá falla claro en
  // vez de degradar en silencio a texto-a-imagen.
  if (data.parentGenerationId) {
    const { data: parent } = await supabase
      .from('generations')
      .select('id')
      .eq('id', data.parentGenerationId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!parent) {
      return { ok: false, error: 'not_found', message: 'Imagen base no encontrada' };
    }
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
  // Panels se listan vía listStudioPanelSessionsAction (Task 3).
  if (parsedType.data === 'panel') {
    return { ok: false, error: 'validation_error', message: 'Usa listStudioPanelSessionsAction para paneles.' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership del activo (no basta que la sesión sea del workspace: el activo
  // también debe serlo, igual que createStudioSessionAction).
  if (!(await ownsAsset(supabase, workspace.id, parsedType.data, assetId))) {
    return { ok: false, error: 'not_found', message: `${parsedType.data} no pertenece al workspace` };
  }

  const { data: rows, error } = await supabase
    .from('studio_sessions')
    .select('id, title, created_at, default_provider, default_model_id')
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
    title: (r.title as string | null) ?? null,
    created_at: r.created_at as string,
    default_provider: r.default_provider as string,
    default_model_id: r.default_model_id as string,
  }));
  return { ok: true, data: sessions };
}

// Renombra una sesión (title editable por el usuario). Ownership por workspace +
// RLS. El cliente refresca el RSC para reflejar la etiqueta nueva.
export async function renameStudioSessionAction(
  input: unknown,
): Promise<Result<{ title: string }>> {
  const parsed = z
    .object({ sessionId: z.string().uuid(), title: z.string().trim().min(1).max(60) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: 'Nombre inválido (1 a 60 caracteres).' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studio_sessions')
    .update({ title: parsed.data.title })
    .eq('id', parsed.data.sessionId)
    .eq('workspace_id', workspace.id)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  if (!data) return { ok: false, error: 'not_found', message: 'Sesión no encontrada' };
  return { ok: true, data: { title: parsed.data.title } };
}

// Archiva una sesión (soft-delete: archived_at). listStudioSessionsAction ya
// filtra las archivadas; las generaciones se conservan (siguen en la biblioteca).
export async function archiveStudioSessionAction(
  sessionId: string,
): Promise<Result<{ archived: true }>> {
  if (!z.string().uuid().safeParse(sessionId).success) {
    return { ok: false, error: 'validation_error', message: 'ID inválido' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('studio_sessions')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('workspace_id', workspace.id)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  if (!data) return { ok: false, error: 'not_found', message: 'Sesión no encontrada' };
  return { ok: true, data: { archived: true } };
}

// Las update actions de locations/cast/products tienen su propio Result local
// (error: string, sin restringir a un union). Todos los valores que de hecho
// devuelven ('validation_error' | 'forbidden' | 'not_found' | 'internal_error')
// caben en el ActionError de este módulo — se normaliza acá para no filtrar
// un `string` suelto al Result tipado de attachStudioImageAction.
const KNOWN_ACTION_ERRORS: readonly ActionError[] = [
  'validation_error',
  'not_found',
  'insufficient_credits',
  'internal_error',
  'forbidden',
];

function toActionError(error: string): ActionError {
  return (KNOWN_ACTION_ERRORS as readonly string[]).includes(error)
    ? (error as ActionError)
    : 'internal_error';
}

function normalizeResult<T>(
  res: { ok: true; data: T } | { ok: false; error: string; message?: string },
): Result<T> {
  if (res.ok) return { ok: true, data: res.data };
  return { ok: false, error: toActionError(res.error), message: res.message };
}

// Persiste el StudioAssetImages fusionado reusando la update action del tipo
// (NO reimplementa su lógica): preserva light_profile null-on-master-change
// (locación), derivación de reference_image_ids (personaje, la action la
// recalcula sola), describe-on-null y la validación de ownership de cada una.
async function persistStudioAssetImages(
  assetId: string,
  images: StudioAssetImages,
): Promise<Result<{ updated: true }>> {
  if (images.assetType === 'panel') {
    return { ok: false, error: 'validation_error', message: 'Los paneles se aplican vía usePanelFromStudioAction (Task 5).' };
  }
  if (images.assetType === 'product') {
    const res = await setProductImagesAction(assetId, {
      productImageIds: images.productImageIds,
      packagingImageIds: images.packagingImageIds,
    });
    return normalizeResult(res);
  }
  if (images.assetType === 'location') {
    const res = await updateLocationAction(assetId, {
      name: images.name,
      description: images.description ?? undefined,
      masterImageId: images.masterImageId ?? undefined,
      referenceImageIds: images.referenceImageIds,
      scaleMapImageId: images.scaleMapImageId ?? undefined,
      scaleMapNotes: images.scaleMapNotes ?? undefined,
    });
    return normalizeResult(res);
  }
  // character: updateCharacterAction exige masterImageId (schema no-nullable);
  // sin maestra todavía no hay nada que fusionar de forma persistible.
  if (!images.masterImageId) {
    return { ok: false, error: 'validation_error', message: 'El personaje necesita una imagen maestra primero.' };
  }
  const res = await updateCharacterAction(assetId, {
    name: images.name,
    description: images.description ?? undefined,
    masterImageId: images.masterImageId,
    angleImageIds: images.angleImageIds,
    voiceCloneId: images.voiceCloneId ?? null,
    fullBodyImageId: images.fullBodyImageId ?? null,
  });
  return normalizeResult(res);
}

// Adjuntar una imagen del estudio a un rol del activo (locación/personaje/
// producto). Read-modify-write server-side: relee el registro FRESCO de la BD
// antes de fusionar, así un cambio externo (otra pestaña, editor inline) hecho
// mientras el estudio estaba abierto no se revierte por un upsert con snapshot
// viejo (bug del review de Fase 4a).
export async function attachStudioImageAction(
  input: unknown,
): Promise<Result<{ assetImages: StudioAssetImages }>> {
  const parsed = AttachStudioImageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const { assetType, assetId, role, referenceId } = parsed.data;
  // Panels no se adjuntan a roles (se aplican vía usePanelFromStudioAction en Task 5).
  if (assetType === 'panel') {
    return { ok: false, error: 'validation_error', message: 'Los paneles no se adjuntan aquí.' };
  }
  // Widening a readonly string[]: ATTACH_ROLES es tuplas `as const` (literales),
  // y role es el string validado por Zod — comparar sin castear el role.
  if (!(ATTACH_ROLES[assetType] as readonly string[]).includes(role)) {
    return { ok: false, error: 'validation_error', message: 'Rol inválido' };
  }

  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  if (!(await ownsAsset(supabase, workspace.id, assetType as Exclude<StudioAssetType, 'panel'>, assetId))) {
    return { ok: false, error: 'not_found' };
  }

  const loaded = await loadStudioAsset(supabase, workspace.id, assetType, assetId);
  if (!loaded) {
    return { ok: false, error: 'not_found' };
  }

  const merged = mergeRole(loaded.assetImages, role, referenceId);
  if ('error' in merged) {
    return { ok: false, error: 'validation_error', message: merged.error };
  }

  const saved = await persistStudioAssetImages(assetId, merged.next);
  if (!saved.ok) {
    return { ok: false, error: saved.error, message: saved.message };
  }

  return { ok: true, data: { assetImages: merged.next } };
}
