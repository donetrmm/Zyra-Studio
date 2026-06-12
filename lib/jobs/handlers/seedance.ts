import 'server-only';
import {
  downloadVideo,
  pollTask,
  submitTask,
  type SeedanceAspectRatio,
  type SeedanceModel,
  type SeedanceOperation,
  type SeedanceResolution,
} from '@/lib/providers/seedance';
import { ProviderError } from '@/lib/providers/types';
import { signedReferenceUrlAdmin } from '@/lib/supabase/storage';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';

// Un clip de hasta 15 s con referencias puede tardar varios minutos.
// 40 polls con delays 15→30 s ≈ 17 min de techo; timeout_at corta antes si aplica.
const MAX_POLLS = 40;

type SeedanceParams = {
  operation?: SeedanceOperation;
  aspectRatio?: SeedanceAspectRatio;
  resolution?: SeedanceResolution;
  duration?: number;
  generateAudio?: boolean;
  seed?: number;
  // image2video
  imageUrl?: string;
  referenceStoragePath?: string;
  endReferenceStoragePath?: string;
  // reference2video: paths en el bucket references, en el MISMO orden en que
  // el prompt los cita como @Image1.., @Video1.., @Audio1..
  referenceImagePaths?: string[];
  referenceVideoPaths?: string[];
  referenceAudioPaths?: string[];
};

function nextDelay(attempts: number): number {
  return attempts < 8 ? 15 : 30;
}

async function signAll(paths: string[] | undefined): Promise<string[] | undefined> {
  if (!paths?.length) return undefined;
  return Promise.all(paths.map((p) => signedReferenceUrlAdmin(p)));
}

export const seedanceHandler: JobHandler = {
  async handle(gen: GenerationRow, action: JobAction): Promise<JobResult> {
    if (gen.type !== 'video') {
      return { kind: 'fail', message: `type=${gen.type}, esperaba video`, code: 'unknown' };
    }
    const params = gen.params as SeedanceParams;
    const model = gen.model_id as SeedanceModel;
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
        const [imageUrls, videoUrls, audioUrls] = await Promise.all([
          signAll(params.referenceImagePaths),
          signAll(params.referenceVideoPaths),
          signAll(params.referenceAudioPaths),
        ]);
        const startedAt = Date.now();
        const { taskId } = await submitTask({
          operation: params.operation ?? 'text2video',
          model,
          prompt: gen.prompt ?? '',
          imageUrl,
          endImageUrl,
          imageUrls,
          videoUrls,
          audioUrls,
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          generateAudio: params.generateAudio,
          seed: params.seed,
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
        return { kind: 'fail', message: poll.error ?? 'Seedance falló', code: 'unknown' };
      }
      if (!poll.videoUrl) {
        return { kind: 'fail', message: 'completed sin video_url', code: 'unknown' };
      }
      const { buffer, mimeType } = await downloadVideo(poll.videoUrl);
      // El seed real vuelve en metadata: fijarlo permite re-renderizar la
      // misma composición en otro tier (draft → final, doc V2 §4.6).
      return {
        kind: 'finalize',
        outputBuffer: buffer,
        mimeType,
        metadata: poll.seed !== undefined ? { seed: poll.seed } : undefined,
      };
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
