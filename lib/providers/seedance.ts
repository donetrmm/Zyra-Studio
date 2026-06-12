import 'server-only';
import { z } from 'zod';
import { ProviderError } from './types';

// Seedance 2.0 vía BytePlus ModelArk (Ark v3 REST). Reemplaza al wrapper de
// fal.ai. Async: POST crea la task → GET poll hasta succeeded.
//   POST /contents/generations/tasks            → { id }
//   GET  /contents/generations/tasks/{id}       → { status, content:{ video_url } }
// A diferencia de fal, hay UN solo endpoint y un campo `model`: la operación
// (t2v / i2v / r2v) y los archivos se expresan con los `role` del array
// `content`, y el tier (standard/fast) con el model id. Los slugs internos de
// abajo siguen siendo la clave lógica (DB, model_pricing, router); el adapter
// los traduce. API specifics y límites en docs/modelos/06-seedance-2.md.

const ARK_BASE_URL =
  process.env.ARK_API_BASE_URL ?? 'https://ark.ap-southeast.bytepluses.com/api/v3';

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

// Límites de entrada del modelo (paper + ModelArk): 9 imágenes, 3 videos
// (2-15 s combinados), 3 audios (≤15 s combinados), tope global 12 archivos.
export const SEEDANCE_MAX_IMAGE_REFS = 9;
export const SEEDANCE_MAX_VIDEO_REFS = 3;
export const SEEDANCE_MAX_AUDIO_REFS = 3;
export const SEEDANCE_MAX_TOTAL_REFS = 12;

// Model ids reales de ModelArk (BytePlus global). Solo standard/fast: la
// operación va en los roles del content, no en el id.
const ARK_MODEL_STANDARD = 'dreamina-seedance-2-0-260128';
const ARK_MODEL_FAST = 'dreamina-seedance-2-0-fast-260128';

function arkModelId(model: SeedanceModel): string {
  return model.includes('/fast/') ? ARK_MODEL_FAST : ARK_MODEL_STANDARD;
}

// ModelArk usa 'adaptive' donde fal usaba 'auto'; el resto pasa igual.
function arkRatio(aspect: SeedanceAspectRatio | undefined): string {
  return !aspect || aspect === 'auto' ? 'adaptive' : aspect;
}

function ensureApiKey(): string {
  const key = process.env.ARK_API_KEY;
  if (!key) {
    throw new ProviderError('ARK_API_KEY no configurada', 'auth', false);
  }
  return key;
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

// Items del array `content` de ModelArk. El orden de los media items define la
// numeración del sistema @ del prompt (@Image1 = primer reference_image, etc.).
type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: string }
  | { type: 'video_url'; video_url: { url: string }; role: string }
  | { type: 'audio_url'; audio_url: { url: string }; role: string };

const CreateTaskResponse = z.object({ id: z.string().min(1) });

async function arkError(res: Response, fallback: string): Promise<never> {
  let detail = fallback;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string }; message?: string };
    detail = body.error?.message ?? body.message ?? fallback;
  } catch {
    // cuerpo no-JSON: nos quedamos con el fallback
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError(detail, 'auth', false);
  }
  if (res.status === 429) {
    throw new ProviderError('Rate limit ModelArk', 'rate_limit', true);
  }
  if (/sensitive|moderation|safety|content.?policy/i.test(detail)) {
    throw new ProviderError('El proveedor rechazó el contenido por políticas de seguridad', 'safety', false);
  }
  if (res.status >= 400 && res.status < 500) {
    throw new ProviderError(`ModelArk input inválido: ${detail}`, 'invalid_input', false);
  }
  throw new ProviderError(`ModelArk error ${res.status}: ${detail}`, 'server', res.status >= 500);
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
  // 4-15 s enteros; undefined → ModelArk usa su default (5)
  duration?: number;
  aspectRatio?: SeedanceAspectRatio;
  resolution?: SeedanceResolution;
  generateAudio?: boolean;
  seed?: number;
}): Promise<{ taskId: string }> {
  const apiKey = ensureApiKey();
  const resolution = params.resolution ?? '720p';
  assertResolutionForModel(params.model, resolution);
  if (params.duration !== undefined && (!Number.isInteger(params.duration) || params.duration < 4 || params.duration > 15)) {
    throw new ProviderError('duration debe ser un entero entre 4 y 15', 'invalid_input', false);
  }

  const content: ContentItem[] = [{ type: 'text', text: params.prompt }];

  if (params.operation === 'image2video') {
    if (!params.imageUrl) {
      throw new ProviderError('image2video requiere imageUrl', 'invalid_input', false);
    }
    content.push({ type: 'image_url', image_url: { url: params.imageUrl }, role: 'first_frame' });
    if (params.endImageUrl) {
      content.push({ type: 'image_url', image_url: { url: params.endImageUrl }, role: 'last_frame' });
    }
  }

  if (params.operation === 'reference2video') {
    assertReferenceLimits(params);
    // Orden preservado: define @Image1.., @Video1.., @Audio1.. del prompt.
    for (const url of params.imageUrls ?? []) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
    }
    for (const url of params.videoUrls ?? []) {
      content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
    }
    for (const url of params.audioUrls ?? []) {
      content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
    }
  }

  const body: Record<string, unknown> = {
    model: arkModelId(params.model),
    content,
    resolution,
    ratio: arkRatio(params.aspectRatio),
    generate_audio: params.generateAudio ?? true,
    // El compiler ya emite cláusula negativa de marca de agua; lo reforzamos en la API.
    watermark: false,
  };
  if (params.duration !== undefined) body.duration = params.duration;
  if (params.seed !== undefined) body.seed = params.seed;

  let res: Response;
  try {
    res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(`ModelArk submit (red): ${(err as Error).message}`, 'server', true);
  }
  if (!res.ok) {
    await arkError(res, 'submit falló');
  }
  const parsed = CreateTaskResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(`ModelArk respuesta inesperada: ${parsed.error.message}`, 'unknown', false);
  }
  return { taskId: parsed.data.id };
}

const PollResponse = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled']),
  content: z.object({ video_url: z.string().optional() }).nullish(),
  seed: z.number().optional(),
  error: z.object({ message: z.string().optional() }).nullish(),
});

export async function pollTask(
  taskId: string,
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  seed?: number;
  error?: string;
}> {
  const apiKey = ensureApiKey();
  let res: Response;
  try {
    res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${taskId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Error de red transitorio: reintentar en el próximo tick del worker.
    return { status: 'processing' };
  }
  if (res.status === 429) {
    // Rate limit en el poll: reintentar luego, no fallar la generación.
    return { status: 'processing' };
  }
  if (!res.ok) {
    await arkError(res, 'poll falló');
  }
  const parsed = PollResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(`ModelArk poll inesperado: ${parsed.error.message}`, 'unknown', false);
  }
  const data = parsed.data;
  if (data.status === 'queued' || data.status === 'running') {
    return { status: 'processing' };
  }
  if (data.status === 'succeeded') {
    const videoUrl = data.content?.video_url;
    if (!videoUrl) {
      return { status: 'failed', error: 'succeeded sin content.video_url' };
    }
    return { status: 'completed', videoUrl, seed: data.seed };
  }
  // failed | expired | cancelled
  return { status: 'failed', error: data.error?.message ?? `ModelArk status: ${data.status}` };
}

// ModelArk no expone cancel síncrono útil para nuestro flujo (mismo caso que
// Kling/Veo): el job sigue en el proveedor pero ignoramos el output y los
// créditos se refundean local.

export async function downloadVideo(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(
      `No se pudo descargar el video de ModelArk (${res.status})`,
      'server',
      false,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
