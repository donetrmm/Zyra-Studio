import 'server-only';
import { z } from 'zod';
import {
  FLUX_MAX_REFS,
  type FluxParams,
  type GenerationResult,
  ProviderError,
} from './types';

const ENDPOINT = 'https://api.bfl.ai/v1/flux-2-pro-preview';

const SubmitResponseSchema = z.object({
  id: z.string(),
  polling_url: z.string().url(),
});

const PollResponseSchema = z.object({
  status: z.enum([
    'Pending',
    'Ready',
    'Error',
    'Failed',
    'Request Moderated',
    'Content Moderated',
    'Task not found',
  ]),
  result: z
    .object({
      sample: z.string().url().optional(),
    })
    .nullish(),
});

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

async function submit(params: FluxParams, apiKey: string): Promise<string> {
  const refs = (params.references ?? []).slice(0, FLUX_MAX_REFS);
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    width: params.width,
    height: params.height,
    safety_tolerance: params.safetyTolerance ?? 2,
  };
  if (params.promptUpsampling !== undefined) body.prompt_upsampling = params.promptUpsampling;
  if (params.seed !== undefined) body.seed = params.seed;
  // BFL espera base64 raw (sin prefix data:...;base64,). El data URL lo ignora
  // o lo rechaza silenciosamente, lo que termina generando como text-to-image.
  if (refs.length === 1) {
    body.image_prompt = refs[0].buffer.toString('base64');
  } else if (refs.length > 1) {
    body.image_prompt = refs.map((r) => r.buffer.toString('base64'));
  }
  // Cuando hay refs, ancla más fuerte. Default 0.85; el caller puede subir/bajar.
  if (refs.length > 0) {
    body.image_prompt_strength = params.imagePromptStrength ?? 0.85;
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'x-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new ProviderError('Rate limit FLUX', 'rate_limit', true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con BFL API', 'auth', false);
  }
  if (res.status === 402) {
    throw new ProviderError('Créditos insuficientes en BFL', 'auth', false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `FLUX submit ${res.status}: ${text.slice(0, 200)}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }

  const parsed = SubmitResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada del submit de FLUX: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }
  return parsed.data.polling_url;
}

async function pollUntilReady(pollingUrl: string, apiKey: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(pollingUrl, { headers: { 'x-key': apiKey } });
    if (!res.ok) {
      if (res.status >= 500) continue;
      throw new ProviderError(`FLUX poll ${res.status}`, 'unknown', false);
    }
    const parsed = PollResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new ProviderError(
        `Respuesta inesperada del poll de FLUX: ${parsed.error.message}`,
        'unknown',
        false,
      );
    }
    const status = parsed.data.status;
    if (status === 'Ready' && parsed.data.result?.sample) {
      return parsed.data.result.sample;
    }
    if (status === 'Error' || status === 'Failed') {
      throw new ProviderError('FLUX falló al generar', 'server', true);
    }
    if (status === 'Request Moderated' || status === 'Content Moderated') {
      throw new ProviderError(
        'El proveedor rechazó el contenido por políticas de seguridad.',
        'safety',
        false,
      );
    }
    if (status === 'Task not found') {
      throw new ProviderError('Task FLUX no encontrada', 'unknown', false);
    }
  }
  throw new ProviderError(
    `FLUX timeout tras ${POLL_TIMEOUT_MS / 1000}s`,
    'timeout',
    true,
  );
}

async function download(sampleUrl: string): Promise<GenerationResult> {
  const res = await fetch(sampleUrl);
  if (!res.ok) {
    throw new ProviderError(
      `No se pudo descargar la imagen de FLUX (${res.status})`,
      'server',
      false,
    );
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: contentType };
}

export async function generate(params: FluxParams): Promise<GenerationResult> {
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey) {
    throw new ProviderError('BFL_API_KEY no configurada', 'auth', false);
  }
  const pollingUrl = await submit(params, apiKey);
  const sampleUrl = await pollUntilReady(pollingUrl, apiKey);
  return download(sampleUrl);
}
