import 'server-only';
import { downloadVideo, pollTask, submitTask, type KlingModel, type KlingOperation } from '@/lib/providers/kling';
import { ProviderError } from '@/lib/providers/types';
import { signedReferenceUrlAdmin } from '@/lib/supabase/storage';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';

const MAX_POLLS = 30;

type KlingParams = {
  operation?: KlingOperation;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: number;
  cfgScale?: number;
  imageUrl?: string;
  generateAudio?: boolean;
  referenceStoragePath?: string;
  endReferenceStoragePath?: string;
};

function nextDelay(attempts: number): number {
  return attempts < 6 ? 10 : 20;
}

export const klingHandler: JobHandler = {
  async handle(gen: GenerationRow, action: JobAction): Promise<JobResult> {
    if (gen.type !== 'video') {
      return { kind: 'fail', message: `type=${gen.type}, esperaba video`, code: 'unknown' };
    }
    const params = gen.params as KlingParams;
    const model = gen.model_id as KlingModel;
    try {
      if (action === 'submit') {
        let imageUrl = params.imageUrl;
        if (!imageUrl && params.referenceStoragePath) {
          imageUrl = await signedReferenceUrlAdmin(params.referenceStoragePath);
        }
        let endImageUrl: string | undefined;
        if (params.endReferenceStoragePath) {
          endImageUrl = await signedReferenceUrlAdmin(params.endReferenceStoragePath);
        }
        const startedAt = Date.now();
        const { taskId } = await submitTask({
          operation: params.operation ?? 'text2video',
          model,
          prompt: gen.prompt ?? '',
          imageUrl,
          endImageUrl,
          duration: params.duration ?? 5,
          aspectRatio: params.aspectRatio ?? '16:9',
          cfgScale: params.cfgScale,
          generateAudio: params.generateAudio,
        });
        return {
          kind: 'continue',
          taskId,
          delaySeconds: nextDelay(0),
          providerPayload: { _started_at: startedAt },
        };
      }

      // action === 'poll'
      if (!gen.provider_task_id) {
        return { kind: 'fail', message: 'provider_task_id faltante en poll', code: 'unknown' };
      }
      if (gen.poll_attempts >= MAX_POLLS) {
        return { kind: 'fail', message: `MAX_POLLS=${MAX_POLLS} excedido`, code: 'timeout' };
      }
      const poll = await pollTask(model, gen.provider_task_id);
      if (poll.status === 'processing') {
        return { kind: 'continue', delaySeconds: nextDelay(gen.poll_attempts) };
      }
      if (poll.status === 'failed') {
        return { kind: 'fail', message: poll.error ?? 'Kling falló', code: 'unknown' };
      }
      // completed
      if (!poll.videoUrl) {
        return { kind: 'fail', message: 'completed sin video_url', code: 'unknown' };
      }
      const { buffer, mimeType } = await downloadVideo(poll.videoUrl);
      return { kind: 'finalize', outputBuffer: buffer, mimeType };
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          kind: 'fail',
          message: err.message,
          code:
            err.code === 'safety'
              ? 'safety'
              : err.code === 'rate_limit'
                ? 'rate_limit'
                : err.code === 'timeout'
                  ? 'timeout'
                  : 'unknown',
        };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
};
