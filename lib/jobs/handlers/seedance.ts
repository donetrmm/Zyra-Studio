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
import { signedReferenceUrlAdmin, signedVoiceSampleUrlAdmin } from '@/lib/supabase/storage';
import { ensureSeedanceVoiceSamplePath } from '@/lib/jobs/voice-sample';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';
import { mapProviderCode } from './fail';

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
  // reference2video: imagen/video viven en el bucket references, en el MISMO
  // orden en que el prompt los cita como @Image1.., @Video1.., @Audio1..
  referenceImagePaths?: string[];
  referenceVideoPaths?: string[];
  // El audio declara su bucket: la música es un media_reference (references),
  // pero la VOZ del personaje vive en voice-samples. Default: references.
  referenceAudioPaths?: string[];
  referenceAudioBucket?: 'references' | 'voice-samples';
  // Encadenado de secuencias (specs/v2/09): pedir el último fotograma.
  returnLastFrame?: boolean;
};

function nextDelay(attempts: number): number {
  return attempts < 8 ? 15 : 30;
}

async function signAll(
  paths: string[] | undefined,
  signer: (path: string) => Promise<string> = signedReferenceUrlAdmin,
): Promise<string[] | undefined> {
  if (!paths?.length) return undefined;
  return Promise.all(paths.map((p) => signer(p)));
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
        // Muestras de voz (@audio1): Seedance acepta audios de referencia de
        // ≤15s combinados, pero las muestras se suben largas (clonado de
        // ElevenLabs). Se sustituye cada path por su variante recortada
        // (derivada+cacheada en voice-samples); si la derivación falla se
        // degrada al original — con muestras ya cortas es lo correcto, con
        // largas el proveedor rechazará igual que antes pero no peor.
        let audioPaths = params.referenceAudioPaths;
        if (audioPaths?.length && params.referenceAudioBucket === 'voice-samples') {
          audioPaths = await Promise.all(
            audioPaths.map(async (p) => {
              try {
                return await ensureSeedanceVoiceSamplePath(p);
              } catch (err) {
                console.warn('[seedance] variante de muestra de voz falló; se usa el original', {
                  path: p,
                  err: (err as Error)?.message?.slice(0, 200),
                });
                return p;
              }
            }),
          );
        }
        const [imageUrls, videoUrls, audioUrls] = await Promise.all([
          signAll(params.referenceImagePaths),
          signAll(params.referenceVideoPaths),
          signAll(
            audioPaths,
            params.referenceAudioBucket === 'voice-samples'
              ? signedVoiceSampleUrlAdmin
              : signedReferenceUrlAdmin,
          ),
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
          returnLastFrame: params.returnLastFrame,
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
      const poll = await pollTask(gen.provider_task_id);
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
        lastFrameUrl: poll.lastFrameUrl,
      };
    } catch (err) {
      if (err instanceof ProviderError) {
        return { kind: 'fail', message: err.message, code: mapProviderCode(err) };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
};
