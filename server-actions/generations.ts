'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  downloadReferenceBuffer,
  uploadOutput,
  uploadThumbnail,
} from '@/lib/supabase/storage';
import { loadPricing } from '@/lib/credits/pricing';
import { estimateCredits } from '@/lib/credits/estimator';
import {
  confirmCredits,
  refundCredits,
  reserveCredits,
} from '@/lib/credits/operations';
import {
  fluxDimensions,
  PreviewCostSchema,
  SubmitGenerationSchema,
  type SubmitGenerationInput,
} from '@/lib/schemas/generations';
import { generate as generateNanoBanana } from '@/lib/providers/nano-banana';
import { generate as generateFlux } from '@/lib/providers/flux';
import { ProviderError, type ImageReference } from '@/lib/providers/types';

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

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'image',
      provider: data.provider,
      model_id: data.model,
      prompt: data.prompt,
      negative_prompt: data.negativePrompt ?? null,
      params: insertParams,
      reference_ids: data.references.map((r) => r.id),
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

  // Reservar créditos (atómico, security definer)
  const reserved = await reserveCredits(user.id, cost, generationId);
  if (!reserved) {
    // borrar la fila ya que no hay reserva
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    return { ok: false, error: 'insufficient_credits' };
  }

  const startedAt = Date.now();
  try {
    const references = await loadReferences(workspace.id, data.references);

    let result: { buffer: Buffer; mimeType: string };
    if (data.provider === 'nano-banana') {
      result = await generateNanoBanana({
        model: data.model,
        prompt: data.prompt,
        aspectRatio: data.aspectRatio,
        resolution: nanoVariantToResolution(data.variant),
        references,
        useGrounding: data.useGrounding,
        conversational: data.conversational,
        hasTextInImage: data.hasTextInImage,
      });
    } else {
      const { width, height } = fluxDimensions(data.aspectRatio, data.megapixels);
      result = await generateFlux({
        prompt: data.prompt,
        width,
        height,
        references,
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
    await confirmCredits(user.id, cost, generationId);

    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from('generations')
      .update({
        status: 'done',
        output_url: outputPath,
        thumbnail_url: thumbPath,
        credits_charged: cost,
        processing_ms: processingMs,
        completed_at: new Date().toISOString(),
        file_size_bytes: result.buffer.byteLength,
      })
      .eq('id', generationId);
    if (updateErr) {
      // No revertimos: la imagen ya subió. Pero log.
      console.error('generations update failed', updateErr.message);
    }

    revalidatePath('/app/library');
    revalidatePath('/app/create/image');
    return { ok: true, data: { generationId } };
  } catch (err) {
    await refundCredits(user.id, cost, generationId).catch(() => {});
    const admin = createAdminClient();
    const errMsg =
      err instanceof ProviderError ? err.message : (err as Error)?.message ?? 'unknown';
    await admin
      .from('generations')
      .update({
        status: 'failed',
        error_message: errMsg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generationId);
    if (err instanceof ProviderError && err.code === 'safety') {
      return { ok: false, error: 'safety', message: errMsg };
    }
    return { ok: false, error: 'provider_error', message: errMsg };
  }
}
