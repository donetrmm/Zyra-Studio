// Adapter BFL FLUX.1 Expand (outpaint con mascara): /v1/flux-pro-1.0-expand.
// Mismo patron submit + poll + download que flux.ts (mismo host, misma key x-key,
// mismos timeouts). Recibe una imagen base (4:5) y cuantos pixeles agregar arriba y
// abajo; preserva los pixeles originales y genera bandas reales hasta 9:16.
import { z } from 'zod';
import { ProviderError, type GenerationResult } from './types';

const BFL_BASE = 'https://api.bfl.ai';
const EXPAND_ENDPOINT = `${BFL_BASE}/v1/flux-pro-1.0-expand`;
const POLL_INTERVAL_MS = 1000;
// El expand corre solo dentro de UNA invocacion del worker (60s). 50s deja margen
// para el submit/download y evita el kill por 60s; 30s disparaba timeouts falsos.
const POLL_TIMEOUT_MS = 50000;

export type ExpandParams = {
  image: Buffer;
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  prompt: string;
  safetyTolerance?: number;
};

// Arma el body JSON del expand. Exportada para test determinista (no llama a red).
export function buildExpandBody(params: ExpandParams): Record<string, unknown> {
  return {
    image: params.image.toString('base64'),
    top: params.top,
    bottom: params.bottom,
    left: params.left ?? 0,
    right: params.right ?? 0,
    prompt: params.prompt,
    output_format: 'jpeg',
    safety_tolerance: params.safetyTolerance ?? 2,
  };
}

const SubmitResponseSchema = z.object({ id: z.string(), polling_url: z.string().url() });
const PollResponseSchema = z.object({
  status: z.enum(['Pending', 'Ready', 'Error', 'Failed', 'Request Moderated', 'Content Moderated', 'Task not found']),
  result: z.object({ sample: z.string().url() }).nullish(),
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function submit(params: ExpandParams, apiKey: string): Promise<string> {
  const res = await fetch(EXPAND_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
    body: JSON.stringify(buildExpandBody(params)),
  });
  if (res.status === 429) {
    throw new ProviderError('FLUX expand rate limited', 'rate_limit', true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('FLUX expand auth error', 'auth', false);
  }
  if (res.status === 402) {
    throw new ProviderError('Creditos insuficientes en BFL', 'auth', false);
  }
  if (res.status === 404) {
    throw new ProviderError('FLUX expand endpoint no disponible', 'invalid_input', false);
  }
  if (!res.ok) {
    throw new ProviderError(
      `FLUX expand submit ${res.status}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }
  const parsed = SubmitResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError('FLUX expand respuesta invalida', 'unknown', false);
  }
  return parsed.data.polling_url;
}

async function pollUntilReady(pollingUrl: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(pollingUrl, { headers: { 'x-key': apiKey } });
    if (!res.ok) {
      throw new ProviderError(
        `FLUX expand poll ${res.status}`,
        res.status >= 500 ? 'server' : 'unknown',
        res.status >= 500,
      );
    }
    const parsed = PollResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new ProviderError('FLUX expand poll invalido', 'unknown', false);
    }
    if (parsed.data.status === 'Ready' && parsed.data.result?.sample) return parsed.data.result.sample;
    if (parsed.data.status === 'Error' || parsed.data.status === 'Failed') {
      throw new ProviderError(`FLUX expand ${parsed.data.status}`, 'server', true);
    }
    if (parsed.data.status === 'Request Moderated' || parsed.data.status === 'Content Moderated') {
      throw new ProviderError('FLUX expand moderado', 'safety', false);
    }
    if (parsed.data.status === 'Task not found') {
      throw new ProviderError('FLUX expand task not found', 'unknown', false);
    }
  }
  throw new ProviderError('FLUX expand timeout', 'timeout', true);
}

async function download(sampleUrl: string): Promise<GenerationResult> {
  const res = await fetch(sampleUrl);
  if (!res.ok) {
    throw new ProviderError(`FLUX expand download ${res.status}`, 'server', res.status >= 500);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  return { buffer, mimeType };
}

export async function expand(params: ExpandParams, apiKey?: string): Promise<GenerationResult> {
  const key = apiKey ?? process.env.BFL_API_KEY;
  if (!key) throw new ProviderError('Falta BFL_API_KEY', 'auth', false);
  const pollingUrl = await submit(params, key);
  const sampleUrl = await pollUntilReady(pollingUrl, key);
  return download(sampleUrl);
}
