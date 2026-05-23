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

// FLUX 2 Pro se comporta como editor: si el prompt no menciona "image 1" / "imagen"
// / "referencia" / "ref", trata las refs como contexto opcional y se va a
// text-to-image. Anteponemos una directiva en inglés (el modelo es multilingüe pero
// responde mejor a instrucciones operativas en EN) solo cuando detectamos que el
// usuario no lo nombró ya. Mantener corto: el prompt original sigue siendo el
// "cuerpo" de la instrucción.
const REF_MENTION_RE =
  /\b(image|imagen|images|im[áa]genes|reference|referencia|ref|photo|foto|picture|retrato|portrait)\b/i;

function buildPromptWithRefs(prompt: string, refCount: number): string {
  if (refCount === 0) return prompt;
  if (REF_MENTION_RE.test(prompt)) return prompt;
  const trimmed = prompt.trim();
  if (refCount === 1) {
    return `Use image 1 as the main reference for subject, identity and composition. ${trimmed}`;
  }
  const ids = Array.from({ length: refCount }, (_, i) => `image ${i + 1}`).join(', ');
  return `Use ${ids} as references; combine them as instructed. ${trimmed}`;
}

async function submit(params: FluxParams, apiKey: string): Promise<string> {
  const refs = (params.references ?? []).slice(0, FLUX_MAX_REFS);
  const body: Record<string, unknown> = {
    prompt: buildPromptWithRefs(params.prompt, refs.length),
    width: params.width,
    height: params.height,
    safety_tolerance: params.safetyTolerance ?? 2,
  };
  if (params.promptUpsampling !== undefined) body.prompt_upsampling = params.promptUpsampling;
  if (params.seed !== undefined) body.seed = params.seed;
  // FLUX 2 Pro Preview usa campos numerados input_image, input_image_2..input_image_8
  // (uno por ref). El nombre image_prompt[] era de FLUX 1.1; en FLUX 2 la API lo
  // ignora en silencio y la generación cae a text-to-image. Acepta base64 raw
  // (sin prefijo data:...;base64,) o URL pública.
  refs.forEach((ref, i) => {
    const key = i === 0 ? 'input_image' : `input_image_${i + 1}`;
    body[key] = ref.buffer.toString('base64');
  });

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
