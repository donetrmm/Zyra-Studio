import 'server-only';
import { fal } from '@fal-ai/client';
import { ProviderError } from './types';

// Seedance 2.0 via fal.ai (proveedor oficial). Tres operaciones × dos tiers:
//   bytedance/seedance-2.0/{text-to-video, image-to-video, reference-to-video}
//   bytedance/seedance-2.0/fast/{...}  ← draft (480p/720p, más barato)
// reference-to-video es el endpoint clave de V2: el prompt referencia los
// archivos subidos como @Image1, @Video1, @Audio1 (sistema @ del modelo).
// API specifics y límites en docs/modelos/06-seedance-2.md.

export type SeedanceOperation = 'text2video' | 'image2video' | 'reference2video';
export type SeedanceModel =
  | 'bytedance/seedance-2.0/text-to-video'
  | 'bytedance/seedance-2.0/image-to-video'
  | 'bytedance/seedance-2.0/reference-to-video'
  | 'bytedance/seedance-2.0/fast/text-to-video'
  | 'bytedance/seedance-2.0/fast/image-to-video'
  | 'bytedance/seedance-2.0/fast/reference-to-video';

export type SeedanceAspectRatio = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
export type SeedanceResolution = '480p' | '720p' | '1080p';

// Límites de entrada del modelo (paper + fal.ai): 9 imágenes, 3 videos
// (2-15 s combinados), 3 audios (≤15 s combinados), tope global 12 archivos.
export const SEEDANCE_MAX_IMAGE_REFS = 9;
export const SEEDANCE_MAX_VIDEO_REFS = 3;
export const SEEDANCE_MAX_AUDIO_REFS = 3;
export const SEEDANCE_MAX_TOTAL_REFS = 12;

let configuredFor: string | null = null;
function ensureConfigured(): void {
  const credentials = process.env.FAL_KEY;
  if (!credentials) {
    throw new ProviderError('FAL_KEY no configurada', 'auth', false);
  }
  if (configuredFor === credentials) return;
  fal.config({ credentials });
  configuredFor = credentials;
}

function assertResolutionForModel(model: SeedanceModel, resolution: SeedanceResolution): void {
  const isFast = model.includes('/fast/');
  if (isFast && resolution === '1080p') {
    throw new ProviderError('El tier fast no soporta 1080p (máx 720p)', 'invalid_input', false);
  }
}

function assertReferenceLimits(refs: {
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
}): void {
  const images = refs.imageUrls?.length ?? 0;
  const videos = refs.videoUrls?.length ?? 0;
  const audios = refs.audioUrls?.length ?? 0;
  if (images > SEEDANCE_MAX_IMAGE_REFS) {
    throw new ProviderError(`Máximo ${SEEDANCE_MAX_IMAGE_REFS} imágenes de referencia`, 'invalid_input', false);
  }
  if (videos > SEEDANCE_MAX_VIDEO_REFS) {
    throw new ProviderError(`Máximo ${SEEDANCE_MAX_VIDEO_REFS} videos de referencia`, 'invalid_input', false);
  }
  if (audios > SEEDANCE_MAX_AUDIO_REFS) {
    throw new ProviderError(`Máximo ${SEEDANCE_MAX_AUDIO_REFS} audios de referencia`, 'invalid_input', false);
  }
  if (images + videos + audios > SEEDANCE_MAX_TOTAL_REFS) {
    throw new ProviderError(`Máximo ${SEEDANCE_MAX_TOTAL_REFS} archivos de referencia en total`, 'invalid_input', false);
  }
}

export async function submitTask(params: {
  operation: SeedanceOperation;
  model: SeedanceModel;
  prompt: string;
  // image2video: imagen inicial obligatoria + final opcional
  imageUrl?: string;
  endImageUrl?: string;
  // reference2video: las URLs se citan en el prompt como @Image1, @Video1...
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  // 4-15 s enteros; undefined → 'auto' (el modelo decide)
  duration?: number;
  aspectRatio?: SeedanceAspectRatio;
  resolution?: SeedanceResolution;
  generateAudio?: boolean;
  seed?: number;
}): Promise<{ taskId: string }> {
  ensureConfigured();
  const resolution = params.resolution ?? '720p';
  assertResolutionForModel(params.model, resolution);
  if (params.duration !== undefined && (!Number.isInteger(params.duration) || params.duration < 4 || params.duration > 15)) {
    throw new ProviderError('duration debe ser un entero entre 4 y 15', 'invalid_input', false);
  }

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    resolution,
    duration: params.duration !== undefined ? String(params.duration) : 'auto',
    aspect_ratio: params.aspectRatio ?? 'auto',
    generate_audio: params.generateAudio ?? true,
  };
  if (params.seed !== undefined) input.seed = params.seed;

  if (params.operation === 'image2video') {
    if (!params.imageUrl) {
      throw new ProviderError('image2video requiere imageUrl', 'invalid_input', false);
    }
    input.image_url = params.imageUrl;
    if (params.endImageUrl) input.end_image_url = params.endImageUrl;
  }

  if (params.operation === 'reference2video') {
    assertReferenceLimits(params);
    if (params.imageUrls?.length) input.image_urls = params.imageUrls;
    if (params.videoUrls?.length) input.video_urls = params.videoUrls;
    if (params.audioUrls?.length) input.audio_urls = params.audioUrls;
  }

  try {
    const res = await fal.queue.submit(params.model, { input });
    return { taskId: res.request_id };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    const detail = (err as { body?: { detail?: string } })?.body?.detail;
    if (message.match(/401|403|unauthorized|forbidden/i)) {
      throw new ProviderError(detail ?? 'Auth inválida con fal.ai', 'auth', false);
    }
    if (message.match(/429|rate.?limit/i)) {
      throw new ProviderError('Rate limit fal.ai', 'rate_limit', true);
    }
    if (message.match(/422|validation/i)) {
      throw new ProviderError(`fal.ai input inválido: ${detail ?? message}`, 'invalid_input', false);
    }
    throw new ProviderError(`fal.ai submit: ${detail ?? message}`, 'unknown', false);
  }
}

export async function pollTask(
  model: SeedanceModel,
  taskId: string,
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  seed?: number;
  error?: string;
}> {
  ensureConfigured();
  try {
    const status = await fal.queue.status(model, { requestId: taskId });
    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(model, { requestId: taskId });
      const data = result.data as { video?: { url?: string }; seed?: number } | undefined;
      const videoUrl = data?.video?.url;
      if (!videoUrl) {
        return { status: 'failed', error: 'completed sin video.url' };
      }
      return { status: 'completed', videoUrl, seed: data?.seed };
    }
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
      return { status: 'processing' };
    }
    const unexpected = (status as { status: string }).status;
    return { status: 'failed', error: `fal status: ${unexpected}` };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message.match(/429|rate.?limit/i)) {
      // Reintentar en el próximo tick del worker
      return { status: 'processing' };
    }
    throw new ProviderError(`fal.ai poll: ${message}`, 'unknown', false);
  }
}

// fal.ai queue API no expone cancel remoto (mismo caso que Kling): el job
// sigue en fal pero el output se ignora y los créditos se refundean local.

export async function downloadVideo(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(
      `No se pudo descargar el video de fal.ai (${res.status})`,
      'server',
      false,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
