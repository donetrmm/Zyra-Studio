import 'server-only';
import { downloadVideo, pollOperation, submitOperation, type VeoModel } from '@/lib/providers/veo';
import { ProviderError } from '@/lib/providers/types';
import { downloadReferenceBuffer } from '@/lib/supabase/storage';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';
import { mapProviderCode } from './fail';

const MAX_POLLS = 24;

type VeoParams = {
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p';
  durationSeconds?: 4 | 6 | 8;
  negativePrompt?: string;
  imageReference?: { mimeType: string; data: string };
  referenceStoragePath?: string;
};

function nextDelay(attempts: number): number {
  return attempts < 4 ? 15 : 30;
}

export const veoHandler: JobHandler = {
  async handle(gen: GenerationRow, action: JobAction): Promise<JobResult> {
    if (gen.type !== 'video') {
      return { kind: 'fail', message: `type=${gen.type}, esperaba video`, code: 'unknown' };
    }
    const params = gen.params as VeoParams;
    try {
      if (action === 'submit') {
        let imageReference = params.imageReference;
        if (!imageReference && params.referenceStoragePath) {
          const { buffer, mimeType } = await downloadReferenceBuffer(params.referenceStoragePath);
          imageReference = { mimeType, data: buffer.toString('base64') };
        }
        const startedAt = Date.now();
        const { operationName } = await submitOperation({
          model: gen.model_id as VeoModel,
          prompt: gen.prompt ?? '',
          negativePrompt: params.negativePrompt,
          aspectRatio: params.aspectRatio ?? '16:9',
          resolution: params.resolution ?? '1080p',
          durationSeconds: params.durationSeconds ?? 8,
          imageReference,
        });
        return {
          kind: 'continue',
          taskId: operationName,
          delaySeconds: nextDelay(0),
          providerPayload: { _started_at: startedAt },
        };
      }

      // poll
      if (!gen.provider_task_id) {
        return { kind: 'fail', message: 'provider_task_id (operationName) faltante', code: 'unknown' };
      }
      if (gen.poll_attempts >= MAX_POLLS) {
        return { kind: 'fail', message: `MAX_POLLS=${MAX_POLLS} excedido`, code: 'timeout' };
      }
      const poll = await pollOperation(gen.provider_task_id);
      if (!poll.done) {
        return { kind: 'continue', delaySeconds: nextDelay(gen.poll_attempts) };
      }
      if (poll.error) {
        return {
          kind: 'fail',
          message: poll.error.message,
          code: poll.error.code === 403 ? 'safety' : 'unknown',
        };
      }
      if (!poll.videoUri) {
        return { kind: 'fail', message: 'Veo done sin videoUri', code: 'unknown' };
      }
      const { buffer, mimeType } = await downloadVideo(poll.videoUri);
      return { kind: 'finalize', outputBuffer: buffer, mimeType };
    } catch (err) {
      if (err instanceof ProviderError) {
        return { kind: 'fail', message: err.message, code: mapProviderCode(err) };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
  // No cancel — Veo no soporta cancelación remota
};
