import 'server-only';
import { fal } from '@fal-ai/client';
import { ProviderError } from './types';

// Kling via fal.ai. fal.ai expone los modelos Kling como slugs únicos:
//   - fal-ai/kling-video/v3/standard/text-to-video
//   - fal-ai/kling-video/v3/pro/text-to-video
//   - fal-ai/kling-video/v3/standard/image-to-video
// El "operation" lo decide el modelo, no un parámetro.

export type KlingOperation = 'text2video' | 'image2video';
export type KlingModel =
  | 'fal-ai/kling-video/v3/standard/text-to-video'
  | 'fal-ai/kling-video/v3/pro/text-to-video'
  | 'fal-ai/kling-video/v3/standard/image-to-video';

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

export async function submitTask(params: {
  operation: KlingOperation;
  model: KlingModel;
  prompt?: string;
  imageUrl?: string;
  endImageUrl?: string;
  duration: number;
  aspectRatio: '16:9' | '9:16' | '1:1';
  cfgScale?: number;
  generateAudio?: boolean;
}): Promise<{ taskId: string }> {
  ensureConfigured();
  const input: Record<string, unknown> = {
    duration: String(params.duration),
    aspect_ratio: params.aspectRatio,
  };
  if (params.prompt) input.prompt = params.prompt;
  if (params.imageUrl) input.start_image_url = params.imageUrl;
  if (params.endImageUrl) input.end_image_url = params.endImageUrl;
  if (params.cfgScale !== undefined) input.cfg_scale = params.cfgScale;
  if (params.generateAudio !== undefined) input.generate_audio = params.generateAudio;

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
    throw new ProviderError(`fal.ai submit: ${detail ?? message}`, 'unknown', false);
  }
}

export async function pollTask(
  model: KlingModel,
  taskId: string,
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}> {
  ensureConfigured();
  try {
    const status = await fal.queue.status(model, { requestId: taskId });
    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(model, { requestId: taskId });
      const data = result.data as { video?: { url?: string } } | undefined;
      const videoUrl = data?.video?.url;
      if (!videoUrl) {
        return { status: 'failed', error: 'completed sin video.url' };
      }
      return { status: 'completed', videoUrl };
    }
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
      return { status: 'processing' };
    }
    // Cualquier otro estado lo tratamos como failed (incluye errores).
    // El SDK tipa status.status como unión cerrada (IN_QUEUE|IN_PROGRESS|COMPLETED),
    // pero defendemos en runtime por si fal devuelve algo nuevo (p.ej. FAILED).
    const unexpected = (status as { status: string }).status;
    return { status: 'failed', error: `fal status: ${unexpected}` };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message.match(/429|rate.?limit/i)) {
      // Devolver processing para reintentar en el próximo tick
      return { status: 'processing' };
    }
    throw new ProviderError(`fal.ai poll: ${message}`, 'unknown', false);
  }
}

// fal.ai queue API no expone cancel remoto. El handler no implementa cancel
// (similar a Veo). El job sigue corriendo en fal pero el output se ignora
// y los créditos se refundean local.

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
