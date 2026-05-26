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
} from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import {
  completeGeneration,
  failGeneration,
  reserveCredits,
} from '@/lib/credits/operations';
import {
  fluxDimensions,
  PreviewCostSchema,
  SubmitGenerationSchema,
  type SubmitGenerationInput,
} from '@/lib/schemas/generations';
import { SubmitTtsSchema, type SubmitTtsInput } from '@/lib/schemas/audio';
import {
  SubmitVideoSchema,
  type SubmitKlingInput,
  type SubmitVeoInput,
} from '@/lib/schemas/video';
import { generate as generateNanoBanana } from '@/lib/providers/nano-banana';
import { generate as generateFlux } from '@/lib/providers/flux';
import { ProviderError, type ImageReference } from '@/lib/providers/types';
import { enqueueJob } from '@/lib/jobs/queue';

type ActionError =
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'insufficient_credits'
  | 'provider_error'
  | 'safety'
  | 'internal_error';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError; message?: string };

function megapixelsToVariant(mp: number): number {
  return mp;
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

function paramsForEstimator(input: SubmitGenerationInput) {
  if (input.provider === 'flux') {
    return {
      megapixels: megapixelsToVariant(input.megapixels),
      references: input.references.length,
    };
  }
  return {
    conversational: input.conversational,
    useGrounding: input.useGrounding,
  };
}

export async function previewCostAction(input: unknown): Promise<Result<{ total: number; breakdown: ReturnType<typeof estimateCredits> }>> {
  const parsed = PreviewCostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error' };
  try {
    const pricing = await loadPricing();
    const breakdown = estimateCredits(pricing, {
      provider: parsed.data.provider,
      model: parsed.data.model,
      variant: parsed.data.variant,
      params: paramsForEstimator(parsed.data),
    });
    return { ok: true, data: { total: breakdown.total, breakdown } };
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }
}

async function loadReferences(
  workspaceId: string,
  refs: { id: string; storagePath: string }[],
): Promise<ImageReference[]> {
  if (refs.length === 0) return [];
  const supabase = await createClient();
  const ids = refs.map((r) => r.id);
  const { data: rows, error } = await supabase
    .from('media_references')
    .select('id, workspace_id, storage_url, type')
    .in('id', ids);
  if (error) throw new Error(`load refs: ${error.message}`);
  const validIds = new Set(
    (rows ?? [])
      .filter((r) => r.workspace_id === workspaceId && r.type === 'image')
      .map((r) => r.id as string),
  );
  const safeRefs = refs.filter((r) => validIds.has(r.id));
  const buffers: ImageReference[] = [];
  for (const ref of safeRefs) {
    const { buffer, mimeType } = await downloadReferenceBuffer(ref.storagePath);
    buffers.push({ buffer, mimeType });
  }
  return buffers;
}

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

export async function submitGenerationAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = SubmitGenerationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;

  const { user, workspace } = await requireWorkspace();

  // Costo recalculado server-side
  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: data.provider,
    model: data.model,
    variant: data.variant,
    params: paramsForEstimator(data),
  });
  const cost = breakdown.total;

  // Crear fila en generations con status='queued' antes de reservar (necesitamos el id)
  const supabase = await createClient();
  const aspectRatio = 'aspectRatio' in data ? data.aspectRatio : undefined;
  const insertParams = {
    aspect_ratio: aspectRatio,
    ...(data.provider === 'nano-banana'
      ? {
          has_text_in_image: data.hasTextInImage,
          conversational: data.conversational,
          use_grounding: data.useGrounding,
        }
      : {
          megapixels: data.megapixels,
          photoreal: data.photoreal,
        }),
  };

  // Conversational: si hay un parent del cual continuar, lo guardamos para
  // poder reconstruir el "hilo" en la biblioteca.
  const parentGenerationId =
    data.provider === 'nano-banana' && data.conversational
      ? (data.parentGenerationId ?? null)
      : null;

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'image',
      provider: data.provider,
      model_id: data.model,
      prompt: data.prompt,
      params: insertParams,
      reference_ids: data.references.map((r) => r.id),
      parent_generation_id: parentGenerationId,
      campaign_id: data.campaignId ?? null,
      status: 'processing',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: 'internal_error',
      message: insertErr?.message ?? 'no row',
    };
  }
  const generationId = inserted.id as string;

  // A partir de aquí TODO va dentro del try: si reserveCredits o cualquier paso
  // posterior lanza, el catch limpia la fila huérfana via failGeneration.
  let reserved = false;
  const startedAt = Date.now();
  try {
    // Reservar créditos (atómico, security definer)
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      // borrar la fila ya que no hay reserva
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }

    const references = await loadReferences(workspace.id, data.references);

    // Conversational: traer el output + prompt del parent para inyectarlos como
    // turno previo del chat (NO como ref). Eso es lo que hace que Gemini edite
    // la imagen anterior en lugar de "pegar la cara".
    let previousTurn: {
      prompt: string;
      imageBuffer: Buffer;
      mimeType: string;
      thoughtSignature?: string;
    } | null = null;
    if (
      data.provider === 'nano-banana' &&
      data.conversational &&
      data.parentGenerationId
    ) {
      const { data: parent } = await supabase
        .from('generations')
        .select('output_url, workspace_id, status, prompt, provider_payload, model_id')
        .eq('id', data.parentGenerationId)
        .single();
      if (
        parent &&
        parent.workspace_id === workspace.id &&
        parent.output_url &&
        parent.status === 'done'
      ) {
        const { buffer, mimeType } = await downloadOutputBuffer(parent.output_url);
        const payload = (parent.provider_payload ?? {}) as {
          thought_signature?: string;
        };
        // El thought_signature solo es válido dentro del MISMO modelo Gemini.
        // Si el usuario cambió de Pro a Flash (o viceversa) en medio del hilo,
        // reusar la sig produce 400 'Image part is missing a thought_signature'.
        // En ese caso, omitimos la sig — nano-banana.ts cae a su fallback
        // single-turn que adjunta la imagen previa como ref normal.
        const modelMatches = parent.model_id === data.model;
        previousTurn = {
          prompt: parent.prompt ?? '',
          imageBuffer: buffer,
          mimeType,
          thoughtSignature: modelMatches ? payload.thought_signature : undefined,
        };
      }
    }

    let result: { buffer: Buffer; mimeType: string; thoughtSignature?: string };
    if (data.provider === 'nano-banana') {
      result = await generateNanoBanana({
        model: data.model,
        prompt: data.prompt,
        aspectRatio: data.aspectRatio,
        resolution: nanoVariantToResolution(data.variant),
        references,
        previousTurn,
        useGrounding: data.useGrounding,
        conversational: data.conversational,
        hasTextInImage: data.hasTextInImage,
        noBackground: data.noBackground,
      });
    } else {
      const { width, height } = fluxDimensions(data.aspectRatio, data.megapixels);
      result = await generateFlux({
        prompt: data.prompt,
        width,
        height,
        references,
        photoreal: data.photoreal,
      });
    }

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

    // Atómico: confirma el cargo + marca status='done' + escribe URLs en una
    // sola tx server-side. Si esto falla, el catch hace failGeneration que
    // refundea (idempotentemente — si llegó a confirmar parcialmente, no
    // double-refunda).
    await completeGeneration({
      userId: user.id,
      generationId,
      cost,
      outputUrl: outputPath,
      thumbnailUrl: thumbPath,
      processingMs,
      fileSizeBytes: result.buffer.byteLength,
      providerPayload:
        Object.keys(providerPayload).length > 0 ? providerPayload : null,
    });

    revalidatePath('/app/library');
    revalidatePath('/app/create/image');
    return { ok: true, data: { generationId } };
  } catch (err) {
    const errMsg =
      err instanceof ProviderError ? err.message : (err as Error)?.message ?? 'unknown';
    // failGeneration es idempotente y solo refunda si NO fue confirmada.
    // Si reserveCredits falló antes de reservar (reserved=false), pasamos
    // cost=0 para que el RPC no intente sumar al balance.
    const refundAmount = reserved ? cost : 0;
    try {
      await failGeneration(user.id, generationId, refundAmount, errMsg);
    } catch (failErr) {
      // Loggear pero no propagar — el usuario ya recibe error del provider.
      console.error('[fail_generation]', {
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

function estimateTtsCost(
  pricing: Awaited<ReturnType<typeof loadPricing>>,
  modelId: SubmitTtsInput['modelId'],
  chars: number,
): number {
  const row = pricing.find(
    (p) => p.provider === 'elevenlabs' && p.model_id === modelId && p.variant === 'default',
  );
  if (!row || !row.unit_size) throw new Error(`pricing no encontrado para ${modelId}`);
  const units = Math.max(1, Math.ceil(chars / row.unit_size));
  return units * Number(row.credits_cost);
}

export async function submitAudioGenerationAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = SubmitTtsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { user, workspace } = await requireWorkspace();

  const pricing = await loadPricing();
  const cost = estimateTtsCost(pricing, data.modelId, data.text.length);

  const supabase = await createClient();
  const insertParams = {
    voiceId: data.voiceId,
    voiceSettings: data.voiceSettings,
    languageCode: data.languageCode,
    chars: data.text.length,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'audio',
      provider: 'elevenlabs',
      model_id: data.modelId,
      prompt: data.text,
      params: insertParams,
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      campaign_id: data.campaignId ?? null,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: 'internal_error',
      message: insertErr?.message ?? 'no row',
    };
  }
  const generationId = inserted.id as string;

  // Mismo patrón que submitGenerationAction (imagen): reserveCredits + enqueue
  // dentro del try. Si reserveCredits o enqueueJob throwean, el catch limpia
  // vía failGeneration (idempotente, refund condicional).
  let reserved = false;
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      // No hubo reserva: borrar la fila (no hay nada que auditar).
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }

    await enqueueJob({ generationId, action: 'submit' });

    revalidatePath('/app/library');
    return { ok: true, data: { generationId } };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    // failGeneration es idempotente. Si reserved=false (reserveCredits throw),
    // pasamos refund=0 para no sumar al balance algo que nunca se restó.
    const refundAmount = reserved ? cost : 0;
    try {
      await failGeneration(user.id, generationId, refundAmount, message);
    } catch (failErr) {
      console.error('[fail_generation:audio]', {
        userId: user.id,
        generationId,
        cost: refundAmount,
        originalError: message,
        failError: (failErr as Error)?.message,
      });
    }
    return {
      ok: false,
      error: message.includes('429') ? 'provider_error' : 'internal_error',
      message,
    };
  }
}

function estimateKlingCost(
  pricing: Awaited<ReturnType<typeof loadPricing>>,
  model: SubmitKlingInput['model'],
  duration: number,
): number {
  const row = pricing.find(
    (p) => p.provider === 'kling' && p.model_id === model && p.variant === 'per_second',
  );
  if (!row) throw new Error(`pricing no encontrado para Kling ${model}/per_second`);
  return duration * Number(row.credits_cost);
}

function estimateVeoCost(
  pricing: Awaited<ReturnType<typeof loadPricing>>,
  model: SubmitVeoInput['model'],
  durationSeconds: 4 | 6 | 8,
): number {
  // Pricing seeded por segundo a 1080p; el costo total = segundos * credits_cost.
  const row = pricing.find(
    (p) => p.provider === 'veo' && p.model_id === model && p.variant === '1080p',
  );
  if (!row) throw new Error(`pricing no encontrado para Veo ${model}`);
  return durationSeconds * Number(row.credits_cost);
}

export async function submitVideoGenerationAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = SubmitVideoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { user, workspace } = await requireWorkspace();
  const pricing = await loadPricing();

  const refPath = data.referenceStoragePath;
  const endRefPath = data.kind === 'kling' ? data.endReferenceStoragePath : undefined;
  for (const p of [refPath, endRefPath]) {
    if (p && !p.startsWith(`${workspace.id}/`)) {
      return { ok: false, error: 'forbidden' as const, message: 'Referencia no pertenece al workspace' };
    }
  }

  let cost: number;
  let provider: 'veo' | 'kling';
  let modelId: string;
  let insertParams: Record<string, unknown>;

  if (data.kind === 'kling') {
    provider = 'kling';
    const hasRef = !!data.referenceStoragePath;
    modelId = hasRef
      ? 'fal-ai/kling-video/v3/standard/image-to-video'
      : data.model;
    cost = estimateKlingCost(pricing, data.model, data.duration);
    insertParams = {
      operation: hasRef ? 'image2video' : 'text2video',
      aspectRatio: data.aspectRatio,
      duration: data.duration,
      cfgScale: data.cfgScale,
      generateAudio: data.generateAudio,
      referenceStoragePath: data.referenceStoragePath,
      endReferenceStoragePath: data.endReferenceStoragePath,
    };
  } else {
    provider = 'veo';
    modelId = data.model;
    cost = estimateVeoCost(pricing, data.model, data.durationSeconds);
    insertParams = {
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      durationSeconds: data.durationSeconds,
      referenceStoragePath: data.referenceStoragePath,
    };
  }

  const supabase = await createClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'video',
      provider,
      model_id: modelId,
      prompt: data.prompt,
      params: insertParams,
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      campaign_id: data.campaignId ?? null,
      timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
  const generationId = inserted.id as string;

  // Mismo patrón corregido que image/audio: reserveCredits + enqueue dentro del
  // try. Si reserveCredits o enqueueJob throwean, el catch limpia vía
  // failGeneration (idempotente, refund condicional).
  let reserved = false;
  try {
    reserved = await reserveCredits(user.id, cost, generationId);
    if (!reserved) {
      // Sin reserva, no hay nada que auditar → delete row.
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', generationId);
      return { ok: false, error: 'insufficient_credits' };
    }
    await enqueueJob({ generationId, action: 'submit' });
    revalidatePath('/app/library');
    return { ok: true, data: { generationId } };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    // failGeneration es idempotente. refundAmount=0 si la reserva nunca se hizo.
    const refundAmount = reserved ? cost : 0;
    try {
      await failGeneration(user.id, generationId, refundAmount, `queue_failed: ${message}`);
    } catch (failErr) {
      console.error('[fail_generation:video]', {
        userId: user.id,
        generationId,
        cost: refundAmount,
        originalError: message,
        failError: (failErr as Error)?.message,
      });
    }
    return {
      ok: false,
      error: message.includes('429') ? 'provider_error' : 'internal_error',
      message,
    };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cancelGenerationAction(
  generationId: string,
): Promise<Result<{ canceled: true }>> {
  if (!UUID_RE.test(generationId)) {
    return { ok: false, error: 'validation_error', message: 'ID inválido' };
  }
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('generations')
    .update({ cancel_requested: true })
    .eq('id', generationId)
    .eq('user_id', user.id)
    .in('status', ['queued', 'processing']);
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }
  revalidatePath('/app/library');
  return { ok: true, data: { canceled: true } };
}
