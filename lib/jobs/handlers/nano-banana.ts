import 'server-only';
import type { GenerationRow, JobHandler, JobResult } from './types';
import type { StoryboardJobPayload } from '@/lib/campaigns/storyboard-job';
import { generate as generateNanoBanana, NANO_VARIANT, nanoVariantToResolution } from '@/lib/providers/nano-banana';
import { ProviderError, type ImageReference, type NanoBananaParams, type NanoBananaTurn } from '@/lib/providers/types';
import { extendPanelTo916 } from '@/lib/campaigns/storyboard-expand';
import { centralSafeCrop } from '@/lib/images/safe-area';
import { downloadOutputBuffer, downloadReferenceBuffer, uploadSafeBase } from '@/lib/supabase/storage';

// inferExtension no vive en un módulo importable (es una función privada
// duplicada en varios archivos); se define local aquí para no acoplar el worker
// a un server action.
function inferExtension(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

function payloadOf(gen: GenerationRow): StoryboardJobPayload {
  const raw = (gen.params as { storyboard?: unknown }).storyboard;
  if (!raw || typeof raw !== 'object') {
    throw new ProviderError('storyboard job sin payload', 'invalid_input', false);
  }
  return raw as StoryboardJobPayload;
}

function toFail(err: unknown): JobResult {
  if (err instanceof ProviderError) {
    const code =
      err.code === 'safety' ? 'safety'
        : err.code === 'rate_limit' ? 'rate_limit'
          : err.code === 'timeout' ? 'timeout'
            : 'unknown';
    return { kind: 'fail', message: err.message, code };
  }
  return { kind: 'fail', message: (err as Error)?.message ?? 'unknown', code: 'unknown' };
}

async function runNano(gen: GenerationRow, p: StoryboardJobPayload) {
  const references: ImageReference[] = await Promise.all(
    p.referencePaths.map(async (path) => {
      const { buffer, mimeType } = await downloadReferenceBuffer(path);
      return { buffer, mimeType };
    }),
  );
  const chatRefs: ImageReference[] = await Promise.all(
    p.chatRefPaths.map(async (path) => {
      const { buffer, mimeType } = await downloadReferenceBuffer(path);
      return { buffer, mimeType };
    }),
  );
  let previousTurn: NanoBananaTurn | null = null;
  if (p.prevTurn) {
    const { buffer, mimeType } = await downloadOutputBuffer(p.prevTurn.imagePath);
    const img = p.strict ? await centralSafeCrop(buffer) : buffer;
    previousTurn = { prompt: p.prevTurn.prompt, imageBuffer: img, mimeType, thoughtSignature: p.prevTurn.thoughtSignature };
  }
  return generateNanoBanana({
    model: gen.model_id as NanoBananaParams['model'],
    prompt: gen.prompt ?? '',
    aspectRatio: p.genAspect,
    resolution: nanoVariantToResolution(NANO_VARIANT),
    references,
    previousTurn,
    conversational: p.conversational,
    useGrounding: false,
    hasTextInImage: false,
    chatReferences: chatRefs.length > 0 ? chatRefs : undefined,
  });
}

export const nanoBananaHandler: JobHandler = {
  async handle(gen: GenerationRow, action): Promise<JobResult> {
    try {
      const p = payloadOf(gen);
      if (action === 'submit') {
        const res = await runNano(gen, p);
        if (!p.strict) {
          const metadata: Record<string, unknown> = {};
          if (res.thoughtSignature) metadata.thought_signature = res.thoughtSignature;
          return { kind: 'finalize', outputBuffer: res.buffer, mimeType: res.mimeType, metadata };
        }
        const baseExt = inferExtension(res.mimeType);
        const safeBasePath = await uploadSafeBase(gen.workspace_id, gen.id, res.buffer, res.mimeType, baseExt);
        const providerPayload: Record<string, unknown> = { safe_base_path: safeBasePath };
        if (res.thoughtSignature) providerPayload.thought_signature = res.thoughtSignature;
        return { kind: 'continue', delaySeconds: 0, providerPayload };
      }
      // action === 'poll' (solo estricto): descargar la base 4:5 y expandir a 9:16.
      // No hay MAX_POLLS aquí a propósito: 'poll' siempre retorna finalize/fail (nunca
      // continue), así que no hay re-encolado infinito; timeout_at cubre el job atascado.
      const pp = (gen.provider_payload ?? {}) as { thought_signature?: string; safe_base_path?: string };
      if (!pp.safe_base_path) throw new ProviderError('poll sin safe_base_path', 'invalid_input', false);
      const { buffer } = await downloadOutputBuffer(pp.safe_base_path);
      const expanded = await extendPanelTo916({ buffer, mimeType: 'image/jpeg' });
      const metadata: Record<string, unknown> = { safe_base_path: pp.safe_base_path };
      if (pp.thought_signature) metadata.thought_signature = pp.thought_signature;
      return { kind: 'finalize', outputBuffer: expanded.buffer, mimeType: expanded.mimeType, metadata };
    } catch (err) {
      return toFail(err);
    }
  },
};
