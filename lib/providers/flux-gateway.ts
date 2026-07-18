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

// flux-2-pro/max SOLO reconoce un set discreto de aspectRatio (1:1, 4:3, 3:4,
// 16:9, 9:16); '4:5' (el de los canvas) NO está y el provider caía a un default,
// ignorando la proporción del estudio. La API de BFL acepta width/height
// (256–1920 px) por providerOptions y OVERRIDEAN cualquier ratio: mapeamos el
// aspecto elegido a dimensiones exactas para respetar SIEMPRE la proporción.
// Múltiplos de 32 (FLUX los prefiere), ~1.05–1.3 MP.
const FLUX_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '9:16': { width: 864, height: 1536 },
  '16:9': { width: 1536, height: 864 },
};

export function fluxDimensions(aspectRatio?: string): { width: number; height: number } {
  return (aspectRatio ? FLUX_DIMENSIONS[aspectRatio] : undefined) ?? { width: 1024, height: 1024 };
}

export function buildImageRequest(params: FluxGatewayParams): {
  model: string;
  prompt: string | { text: string; images: Buffer[] };
  providerOptions: Record<string, { width: number; height: number }>;
} {
  const refs = params.references ?? [];
  // Edición: las refs (base primero) viajan como prompt.images, igual que
  // gpt-image. La generación texto->imagen por el gateway está documentada; la
  // EDICIÓN de un image-only por el gateway está sin confirmar end-to-end (misma
  // compuerta que gpt-image). El smoke con API real del usuario la valida.
  const prompt =
    refs.length > 0 ? { text: params.prompt, images: refs.map((r) => r.buffer) } : params.prompt;
  const dims = fluxDimensions(params.aspectRatio);
  // El namespace de providerOptions es ambiguo por el gateway (slug 'bfl/…' vs
  // provider 'blackForestLabs'): se manda bajo AMBOS y cada provider lee solo su
  // clave — mismo patrón que gateway.ts con thinkingConfig (google/vertex).
  return {
    model: toGatewayModel(params.model),
    prompt,
    providerOptions: { bfl: dims, blackForestLabs: dims },
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
    // SDK (mismo patrón que gpt-image.ts). providerOptions sí necesita cast: el
    // SDK exige JSONValue, no un objeto tipado.
    const result = await generateImage({
      model: req.model,
      prompt: req.prompt,
      providerOptions: req.providerOptions as Parameters<typeof generateImage>[0]['providerOptions'],
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
