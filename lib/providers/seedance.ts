import 'server-only';
import { fal } from '@fal-ai/client';
import { z } from 'zod';
import { ProviderError } from './types';

// Seedance 2.0 con DOS backends seleccionables por env:
//   SEEDANCE_PROVIDER=fal  → fal.ai (FAL_KEY). Para pruebas mientras la cuenta
//                            de ModelArk activa el modelo.
//   (cualquier otro/unset) → BytePlus ModelArk (ARK_API_KEY), el default.
// La interfaz pública (submitTask, pollTask, downloadVideo) y los slugs internos
// son idénticos para ambos; cada backend traduce a su API. Specs en
// docs/modelos/06-seedance-2.md.

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

// Límites de entrada del modelo: 9 imágenes, 3 videos (2-15 s combinados),
// 3 audios (≤15 s combinados), tope global 12 archivos.
export const SEEDANCE_MAX_IMAGE_REFS = 9;
export const SEEDANCE_MAX_VIDEO_REFS = 3;
export const SEEDANCE_MAX_AUDIO_REFS = 3;
export const SEEDANCE_MAX_TOTAL_REFS = 12;

export type SeedanceSubmitParams = {
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
  // 4-15 s enteros
  duration?: number;
  aspectRatio?: SeedanceAspectRatio;
  resolution?: SeedanceResolution;
  generateAudio?: boolean;
  seed?: number;
};

export type SeedancePollResult = {
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  seed?: number;
  error?: string;
};

function isFalBackend(): boolean {
  return process.env.SEEDANCE_PROVIDER === 'fal';
}

// ============ Validación compartida ============

function assertResolutionForModel(model: SeedanceModel, resolution: SeedanceResolution): void {
  if (model.includes('/fast/') && resolution === '1080p') {
    throw new ProviderError('El tier fast no soporta 1080p (máx 720p)', 'invalid_input', false);
  }
}

function assertReferenceLimits(refs: { imageUrls?: string[]; videoUrls?: string[]; audioUrls?: string[] }): void {
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

// Validación común a ambos backends, antes de construir el request.
function validateSubmit(params: SeedanceSubmitParams, resolution: SeedanceResolution): void {
  assertResolutionForModel(params.model, resolution);
  if (params.duration !== undefined && (!Number.isInteger(params.duration) || params.duration < 4 || params.duration > 15)) {
    throw new ProviderError('duration debe ser un entero entre 4 y 15', 'invalid_input', false);
  }
  if (params.operation === 'image2video' && !params.imageUrl) {
    throw new ProviderError('image2video requiere imageUrl', 'invalid_input', false);
  }
  if (params.operation === 'reference2video') assertReferenceLimits(params);
}

// ============ Backend: BytePlus ModelArk (default) ============

const ARK_BASE_URL =
  process.env.ARK_API_BASE_URL ?? 'https://ark.ap-southeast.bytepluses.com/api/v3';
const ARK_MODEL_STANDARD = 'dreamina-seedance-2-0-260128';
const ARK_MODEL_FAST = 'dreamina-seedance-2-0-fast-260128';

function arkModelId(model: SeedanceModel): string {
  return model.includes('/fast/') ? ARK_MODEL_FAST : ARK_MODEL_STANDARD;
}
function arkRatio(aspect: SeedanceAspectRatio | undefined): string {
  return !aspect || aspect === 'auto' ? 'adaptive' : aspect;
}
function ensureArkKey(): string {
  const key = process.env.ARK_API_KEY;
  if (!key) throw new ProviderError('ARK_API_KEY no configurada', 'auth', false);
  return key;
}

type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: string }
  | { type: 'video_url'; video_url: { url: string }; role: string }
  | { type: 'audio_url'; audio_url: { url: string }; role: string };

const CreateTaskResponse = z.object({ id: z.string().min(1) });
const PollResponse = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled']),
  content: z.object({ video_url: z.string().optional() }).nullish(),
  seed: z.number().optional(),
  error: z.object({ message: z.string().optional() }).nullish(),
});

async function arkError(res: Response, fallback: string): Promise<never> {
  let detail = fallback;
  try {
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    detail = body.error?.message ?? body.message ?? fallback;
  } catch {
    // cuerpo no-JSON: nos quedamos con el fallback
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError(detail, 'auth', false);
  if (res.status === 429) throw new ProviderError('Rate limit ModelArk', 'rate_limit', true);
  if (/sensitive|moderation|safety|content.?policy/i.test(detail)) {
    throw new ProviderError('El proveedor rechazó el contenido por políticas de seguridad', 'safety', false);
  }
  if (res.status >= 400 && res.status < 500) {
    throw new ProviderError(`ModelArk input inválido: ${detail}`, 'invalid_input', false);
  }
  throw new ProviderError(`ModelArk error ${res.status}: ${detail}`, 'server', res.status >= 500);
}

async function submitModelArk(params: SeedanceSubmitParams, resolution: SeedanceResolution): Promise<{ taskId: string }> {
  const apiKey = ensureArkKey();
  const content: ContentItem[] = [{ type: 'text', text: params.prompt }];

  if (params.operation === 'image2video') {
    content.push({ type: 'image_url', image_url: { url: params.imageUrl! }, role: 'first_frame' });
    if (params.endImageUrl) content.push({ type: 'image_url', image_url: { url: params.endImageUrl }, role: 'last_frame' });
  }
  if (params.operation === 'reference2video') {
    for (const url of params.imageUrls ?? []) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
    for (const url of params.videoUrls ?? []) content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
    for (const url of params.audioUrls ?? []) content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
  }

  const body: Record<string, unknown> = {
    model: arkModelId(params.model),
    content,
    resolution,
    ratio: arkRatio(params.aspectRatio),
    generate_audio: params.generateAudio ?? true,
    watermark: false,
  };
  if (params.duration !== undefined) body.duration = params.duration;
  if (params.seed !== undefined) body.seed = params.seed;

  let res: Response;
  try {
    res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(`ModelArk submit (red): ${(err as Error).message}`, 'server', true);
  }
  if (!res.ok) await arkError(res, 'submit falló');
  const parsed = CreateTaskResponse.safeParse(await res.json());
  if (!parsed.success) throw new ProviderError(`ModelArk respuesta inesperada: ${parsed.error.message}`, 'unknown', false);
  return { taskId: parsed.data.id };
}

async function pollModelArk(taskId: string): Promise<SeedancePollResult> {
  const apiKey = ensureArkKey();
  let res: Response;
  try {
    res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${taskId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { status: 'processing' };
  }
  if (res.status === 429) return { status: 'processing' };
  if (!res.ok) await arkError(res, 'poll falló');
  const parsed = PollResponse.safeParse(await res.json());
  if (!parsed.success) throw new ProviderError(`ModelArk poll inesperado: ${parsed.error.message}`, 'unknown', false);
  const data = parsed.data;
  if (data.status === 'queued' || data.status === 'running') return { status: 'processing' };
  if (data.status === 'succeeded') {
    const videoUrl = data.content?.video_url;
    if (!videoUrl) return { status: 'failed', error: 'succeeded sin content.video_url' };
    return { status: 'completed', videoUrl, seed: data.seed };
  }
  return { status: 'failed', error: data.error?.message ?? `ModelArk status: ${data.status}` };
}

// ============ Backend: fal.ai (SEEDANCE_PROVIDER=fal) ============

let falConfiguredFor: string | null = null;
function ensureFalConfigured(): void {
  const credentials = process.env.FAL_KEY;
  if (!credentials) throw new ProviderError('FAL_KEY no configurada', 'auth', false);
  if (falConfiguredFor === credentials) return;
  fal.config({ credentials });
  falConfiguredFor = credentials;
}

async function submitFal(params: SeedanceSubmitParams, resolution: SeedanceResolution): Promise<{ taskId: string }> {
  ensureFalConfigured();
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    resolution,
    duration: params.duration !== undefined ? String(params.duration) : 'auto',
    aspect_ratio: params.aspectRatio ?? 'auto',
    generate_audio: params.generateAudio ?? true,
  };
  if (params.seed !== undefined) input.seed = params.seed;
  if (params.operation === 'image2video') {
    input.image_url = params.imageUrl;
    if (params.endImageUrl) input.end_image_url = params.endImageUrl;
  }
  if (params.operation === 'reference2video') {
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
    if (message.match(/401|403|unauthorized|forbidden/i)) throw new ProviderError(detail ?? 'Auth inválida con fal.ai', 'auth', false);
    if (message.match(/429|rate.?limit/i)) throw new ProviderError('Rate limit fal.ai', 'rate_limit', true);
    if (message.match(/422|validation/i)) throw new ProviderError(`fal.ai input inválido: ${detail ?? message}`, 'invalid_input', false);
    throw new ProviderError(`fal.ai submit: ${detail ?? message}`, 'unknown', false);
  }
}

async function pollFal(model: SeedanceModel, taskId: string): Promise<SeedancePollResult> {
  ensureFalConfigured();
  try {
    const status = await fal.queue.status(model, { requestId: taskId });
    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(model, { requestId: taskId });
      const data = result.data as { video?: { url?: string }; seed?: number } | undefined;
      const videoUrl = data?.video?.url;
      if (!videoUrl) return { status: 'failed', error: 'completed sin video.url' };
      return { status: 'completed', videoUrl, seed: data?.seed };
    }
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return { status: 'processing' };
    return { status: 'failed', error: `fal status: ${(status as { status: string }).status}` };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message.match(/429|rate.?limit/i)) return { status: 'processing' };
    throw new ProviderError(`fal.ai poll: ${message}`, 'unknown', false);
  }
}

// ============ Dispatch público ============

export async function submitTask(params: SeedanceSubmitParams): Promise<{ taskId: string }> {
  const resolution = params.resolution ?? '720p';
  validateSubmit(params, resolution);
  return isFalBackend() ? submitFal(params, resolution) : submitModelArk(params, resolution);
}

// `model` solo lo necesita el backend fal (la cola de fal exige el slug en el
// status); ModelArk lo ignora (la task es global por id).
export async function pollTask(model: SeedanceModel, taskId: string): Promise<SeedancePollResult> {
  return isFalBackend() ? pollFal(model, taskId) : pollModelArk(taskId);
}

export async function downloadVideo(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(`No se pudo descargar el video del proveedor (${res.status})`, 'server', false);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
