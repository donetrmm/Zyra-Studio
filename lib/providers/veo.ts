import 'server-only';
import { z } from 'zod';
import { ProviderError } from './types';

// Veo es el ÚNICO consumidor de GEMINI_API_KEY: queda en la API nativa porque
// AI Gateway solo ofrece video bloqueante sin operation name (incompatible con
// el polling re-encolado por QStash). Ver docs/superpowers/specs/2026-07-08-
// migracion-ai-gateway-design.md.
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export type VeoModel =
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-lite-generate-preview';

const SubmitResponseSchema = z.object({
  name: z.string(),
});

const PollResponseSchema = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
  response: z
    .object({
      generateVideoResponse: z
        .object({
          generatedSamples: z
            .array(
              z.object({
                video: z.object({ uri: z.string() }),
              }),
            )
            .optional(),
          raiMediaFilteredCount: z.number().optional(),
          raiMediaFilteredReasons: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);
  return key;
}

export async function submitOperation(params: {
  model: VeoModel;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p';
  durationSeconds: 4 | 6 | 8;
  imageReference?: { mimeType: string; data: string };
}): Promise<{ operationName: string }> {
  const apiKey = getApiKey();
  const body: Record<string, unknown> = {
    instances: [
      {
        prompt: params.prompt,
        ...(params.imageReference && {
          image: {
            bytesBase64Encoded: params.imageReference.data,
            mimeType: params.imageReference.mimeType,
          },
        }),
      },
    ],
    parameters: {
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      durationSeconds: params.durationSeconds,
      personGeneration: 'allow_all',
      ...(params.negativePrompt && { negativePrompt: params.negativePrompt }),
    },
  };

  const res = await fetch(`${BASE_URL}/models/${params.model}:predictLongRunning`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (res.status === 429) {
    throw new ProviderError('Rate limit Veo', 'rate_limit', true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `Veo submit ${res.status}: ${text.slice(0, 200)}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }
  const parsed = SubmitResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada de Veo submit: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }
  return { operationName: parsed.data.name };
}

export async function pollOperation(operationName: string): Promise<{
  done: boolean;
  videoUri?: string;
  error?: { code: number; message: string };
}> {
  const apiKey = getApiKey();
  const res = await fetch(`${BASE_URL}/${operationName}`, {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) return { done: false };
    throw new ProviderError(`Veo poll ${res.status}`, 'unknown', false);
  }
  const raw = await res.json();
  const parsed = PollResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada de Veo poll: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }
  const data = parsed.data;
  const vr = data.response?.generateVideoResponse;
  const uri = vr?.generatedSamples?.[0]?.video?.uri;
  if (vr?.raiMediaFilteredCount && vr.raiMediaFilteredCount > 0) {
    const reason = vr.raiMediaFilteredReasons?.[0] ?? 'Contenido bloqueado por filtro de seguridad de Google';
    return { done: true, error: { code: 403, message: reason } };
  }
  return { done: data.done === true, videoUri: uri, error: data.error };
}

export async function downloadVideo(uri: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = getApiKey();
  const res = await fetch(uri, {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    throw new ProviderError(
      `No se pudo descargar el video de Veo (${res.status})`,
      'server',
      false,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
