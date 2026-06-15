import 'server-only';
import { z } from 'zod';
import { ProviderError } from './types';

// Seedance 2.0 con DOS backends seleccionables por env, misma interfaz:
//   SEEDANCE_PROVIDER=atlas → AtlasCloud (ATLASCLOUD_API_KEY). Per-second,
//                             más barato y sin waitlist; el `model` es nuestro
//                             slug interno tal cual.
//   (cualquier otro/unset)  → BytePlus ModelArk (ARK_API_KEY), el default.
// Los 6 slugs internos son la clave lógica en ambos. Specs en
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

function backend(): 'atlas' | 'modelark' {
  return process.env.SEEDANCE_PROVIDER === 'atlas' ? 'atlas' : 'modelark';
}

// ratio: ambos backends usan 'adaptive' donde nosotros usamos 'auto'.
function toRatio(aspect: SeedanceAspectRatio | undefined): string {
  return !aspect || aspect === 'auto' ? 'adaptive' : aspect;
}

// Mapea un error HTTP del proveedor a ProviderError con código adecuado.
// Lee el cuerpo como TEXTO (una sola vez) y, si es JSON, extrae el mensaje de
// las formas conocidas; si no, usa el cuerpo crudo recortado. Así un 4xx con un
// shape inesperado (típico al afinar un payload nuevo) surface el motivo real
// del proveedor en vez de un genérico ciego.
async function httpError(res: Response, label: string, fallback: string): Promise<never> {
  const raw = (await res.text().catch(() => '')).trim();
  let detail = fallback;
  if (raw) {
    try {
      const body = JSON.parse(raw) as {
        error?: { message?: string } | string;
        message?: string;
        data?: { error?: string };
      };
      detail =
        (typeof body.error === 'string' ? body.error : body.error?.message) ??
        body.data?.error ??
        body.message ??
        raw.slice(0, 300);
    } catch {
      // cuerpo no-JSON (HTML de un 404, texto plano): el crudo recortado informa.
      detail = raw.slice(0, 300);
    }
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError(detail, 'auth', false);
  if (res.status === 429) throw new ProviderError(`Rate limit ${label}`, 'rate_limit', true);
  if (/sensitive|moderation|safety|content.?policy|disallowed/i.test(detail)) {
    throw new ProviderError('El proveedor rechazó el contenido por políticas de seguridad', 'safety', false);
  }
  if (res.status >= 400 && res.status < 500) {
    throw new ProviderError(`${label} ${res.status}: ${detail}`, 'invalid_input', false);
  }
  throw new ProviderError(`${label} error ${res.status}: ${detail}`, 'server', res.status >= 500);
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

const ARK_BASE_URL = process.env.ARK_API_BASE_URL ?? 'https://ark.ap-southeast.bytepluses.com/api/v3';
const ARK_MODEL_STANDARD = 'dreamina-seedance-2-0-260128';
const ARK_MODEL_FAST = 'dreamina-seedance-2-0-fast-260128';

function arkModelId(model: SeedanceModel): string {
  return model.includes('/fast/') ? ARK_MODEL_FAST : ARK_MODEL_STANDARD;
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

const ArkCreateResponse = z.object({ id: z.string().min(1) });
const ArkPollResponse = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled']),
  content: z.object({ video_url: z.string().optional() }).nullish(),
  seed: z.number().optional(),
  error: z.object({ message: z.string().optional() }).nullish(),
});

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
    ratio: toRatio(params.aspectRatio),
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
  if (!res.ok) await httpError(res, 'ModelArk', 'submit falló');
  const parsed = ArkCreateResponse.safeParse(await res.json());
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
  if (!res.ok) await httpError(res, 'ModelArk', 'poll falló');
  const parsed = ArkPollResponse.safeParse(await res.json());
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

// ============ Backend: AtlasCloud (SEEDANCE_PROVIDER=atlas) ============

const ATLAS_BASE_URL = process.env.ATLASCLOUD_API_BASE_URL ?? 'https://api.atlascloud.ai/api/v1/model';

// AtlasCloud no expone el tier 'fast' (es un id propio de ModelArk:
// dreamina-seedance-2-0-fast-260128). Su catálogo usa el slug por operación sin
// tier; el draft corre en el mismo modelo (es per-second, no por tier).
// Confirmado en smoke: 'bytedance/seedance-2.0/text-to-video' genera OK, mientras
// 'bytedance/seedance-2.0/fast/reference-to-video' devuelve 400 {"msg":"not found"}.
function atlasModelId(model: SeedanceModel): string {
  return model.replace('/seedance-2.0/fast/', '/seedance-2.0/');
}

function ensureAtlasKey(): string {
  const key = process.env.ATLASCLOUD_API_KEY;
  if (!key) throw new ProviderError('ATLASCLOUD_API_KEY no configurada', 'auth', false);
  return key;
}

const AtlasCreateResponse = z.object({ data: z.object({ id: z.string().min(1) }) });
const AtlasPollResponse = z.object({
  data: z.object({
    status: z.string(),
    outputs: z.array(z.string()).nullish(),
    error: z.string().nullish(),
  }),
});

async function submitAtlas(params: SeedanceSubmitParams, resolution: SeedanceResolution): Promise<{ taskId: string }> {
  const apiKey = ensureAtlasKey();
  // El `model` de AtlasCloud es nuestro slug por operación, sin el tier 'fast'
  // (que no existe en su catálogo — ver atlasModelId).
  const body: Record<string, unknown> = {
    model: atlasModelId(params.model),
    prompt: params.prompt,
    resolution,
    ratio: toRatio(params.aspectRatio),
    generate_audio: params.generateAudio ?? true,
    watermark: false,
  };
  if (params.duration !== undefined) body.duration = params.duration;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.operation === 'image2video') {
    body.image_url = params.imageUrl;
    // end_image_url: nombre inferido (I2V de fotograma final). Confirmar en smoke.
    if (params.endImageUrl) body.end_image_url = params.endImageUrl;
  }
  if (params.operation === 'reference2video') {
    // Campos confirmados con el "view code" oficial de AtlasCloud (2026-06-15):
    // reference_images / reference_videos / reference_audios (arrays de URLs).
    // Antes se enviaban como image_urls/video_urls/audio_urls (inferido) y Atlas
    // los IGNORABA en silencio → el producto de referencia no llegaba al modelo.
    if (params.imageUrls?.length) body.reference_images = params.imageUrls;
    if (params.videoUrls?.length) body.reference_videos = params.videoUrls;
    if (params.audioUrls?.length) body.reference_audios = params.audioUrls;
  }

  let res: Response;
  try {
    res = await fetch(`${ATLAS_BASE_URL}/generateVideo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(`AtlasCloud submit (red): ${(err as Error).message}`, 'server', true);
  }
  if (!res.ok) await httpError(res, 'AtlasCloud', 'submit falló');
  const parsed = AtlasCreateResponse.safeParse(await res.json());
  if (!parsed.success) throw new ProviderError(`AtlasCloud respuesta inesperada: ${parsed.error.message}`, 'unknown', false);
  return { taskId: parsed.data.data.id };
}

async function pollAtlas(taskId: string): Promise<SeedancePollResult> {
  const apiKey = ensureAtlasKey();
  let res: Response;
  try {
    res = await fetch(`${ATLAS_BASE_URL}/prediction/${taskId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { status: 'processing' };
  }
  if (res.status === 429) return { status: 'processing' };
  if (!res.ok) await httpError(res, 'AtlasCloud', 'poll falló');
  const parsed = AtlasPollResponse.safeParse(await res.json());
  if (!parsed.success) throw new ProviderError(`AtlasCloud poll inesperado: ${parsed.error.message}`, 'unknown', false);
  const data = parsed.data.data;
  const status = data.status.toLowerCase();
  if (status === 'completed' || status === 'succeeded') {
    const videoUrl = data.outputs?.[0];
    if (!videoUrl) return { status: 'failed', error: 'completed sin outputs[0]' };
    return { status: 'completed', videoUrl };
  }
  if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
    return { status: 'failed', error: data.error ?? `AtlasCloud status: ${data.status}` };
  }
  return { status: 'processing' };
}

// ============ Dispatch público ============

export async function submitTask(params: SeedanceSubmitParams): Promise<{ taskId: string }> {
  const resolution = params.resolution ?? '720p';
  validateSubmit(params, resolution);
  return backend() === 'atlas' ? submitAtlas(params, resolution) : submitModelArk(params, resolution);
}

// Ambos backends consultan por id (la task es global), así que `model` no se
// necesita en el poll.
export async function pollTask(taskId: string): Promise<SeedancePollResult> {
  return backend() === 'atlas' ? pollAtlas(taskId) : pollModelArk(taskId);
}

export async function downloadVideo(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(`No se pudo descargar el video del proveedor (${res.status})`, 'server', false);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
