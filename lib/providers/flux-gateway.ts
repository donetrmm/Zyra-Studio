import 'server-only';
import { APICallError, generateImage } from 'ai';
import { ProviderError, type GenerationResult, type ImageReference } from '@/lib/providers/types';

// FLUX.2 [pro] y [max] de Black Forest Labs por el Vercel AI Gateway (mismo
// AI_GATEWAY_API_KEY que Nano y gpt-image). Como gpt-image, son modelos
// "image-only": se usa generateImage -> result.images[].base64 (no generateText).
// El slug del gateway es `bfl/flux-2-pro` / `bfl/flux-2-max`. El base64 encaja con
// la regla de que el worker sube a Supabase (nunca una URL de proveedor llega al
// cliente).
//
// OJO: el adapter BFL directo (lib/providers/flux.ts, model_id 'flux-2-pro-preview'
// del storyboard/expand) NO se toca — aquel usa BFL_API_KEY + submit/poll. Este va
// 100% por el gateway, sin key nueva, respetando la decisión firme del estudio.

export type FluxGatewayModel = 'flux-2-pro' | 'flux-2-max';

export type FluxGatewayParams = {
  model: FluxGatewayModel;
  prompt: string;
  aspectRatio?: string;
  references?: ImageReference[]; // base + refs para editar (el modelo admite hasta 10)
};

function toGatewayModel(model: FluxGatewayModel): string {
  return `bfl/${model}`;
}

export function buildImageRequest(params: FluxGatewayParams): {
  model: string;
  prompt: string | { text: string; images: Buffer[] };
  aspectRatio?: string;
} {
  const refs = params.references ?? [];
  // Edición: las refs (base primero) viajan como prompt.images, igual que
  // gpt-image. La generación texto->imagen por el gateway está documentada; la
  // EDICIÓN de un image-only por el gateway está sin confirmar end-to-end (misma
  // compuerta que gpt-image). El smoke con API real del usuario la valida.
  const prompt =
    refs.length > 0 ? { text: params.prompt, images: refs.map((r) => r.buffer) } : params.prompt;
  return {
    model: toGatewayModel(params.model),
    prompt,
    ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
  };
}

export function interpretImageResult(result: {
  images: Array<{ base64: string; mediaType?: string }>;
}): GenerationResult {
  const image = result.images[0];
  if (!image) throw new ProviderError('FLUX (gateway) no devolvió imagen', 'unknown', false);
  return { buffer: Buffer.from(image.base64, 'base64'), mimeType: image.mediaType ?? 'image/jpeg' };
}

export async function generate(params: FluxGatewayParams): Promise<GenerationResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const req = buildImageRequest(params);
  try {
    // prompt (string | { text, images }) encaja directo en el tipo público del
    // SDK (mismo patrón que gpt-image.ts). aspectRatio sí necesita cast: el SDK lo
    // tipa como plantilla `${number}:${number}` y lo guardamos como string libre.
    const result = await generateImage({
      model: req.model,
      prompt: req.prompt,
      ...(req.aspectRatio
        ? { aspectRatio: req.aspectRatio as Parameters<typeof generateImage>[0]['aspectRatio'] }
        : {}),
    });
    return interpretImageResult(
      result as unknown as { images: Array<{ base64: string; mediaType?: string }> },
    );
  } catch (err) {
    throw translateError(err);
  }
}

// Espeja translateError de gpt-image.ts / gateway.ts (mismo AI Gateway): 429 ->
// rate_limit, 401/403 -> auth, 5xx -> server (retryable), resto -> unknown.
function translateError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    if (status === 429) return new ProviderError('Rate limit FLUX (gateway)', 'rate_limit', true);
    if (status === 401 || status === 403) {
      return new ProviderError('Auth inválida con AI Gateway (FLUX)', 'auth', false);
    }
    return new ProviderError(
      `FLUX (gateway) ${status}: ${err.message.slice(0, 200)}`,
      'server',
      status >= 500,
    );
  }
  return new ProviderError(
    `FLUX (gateway): ${err instanceof Error ? err.message : 'error desconocido'}`,
    'unknown',
    false,
  );
}
